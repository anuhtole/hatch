/**
 * lib/resume/gap-report.ts
 *
 * Phase 3d — the JD gap report + open-question asks.
 *
 * Given a job description, the candidate pool, and the tailored resume, this:
 *   STEP A — extracts the JD's concrete requirements (skills/experiences/signals).
 *   STEP B — classifies each requirement STRONG / WEAK / ABSENT against what the
 *            pool ACTUALLY contains, citing supporting claim ids.
 *   STEP C — for WEAK/ABSENT items, asks Anatole OPEN questions.
 *
 * HARD anti-anchoring guardrail: questions must be OPEN — they may NEVER propose
 * a number or a specific accomplishment to confirm. "Do you have a metric for your
 * eval work?" is allowed; "Did you improve accuracy ~20%?" is forbidden. A later
 * deterministic check (and the commit gate) rejects any question containing a digit.
 *
 * Additive only — does not touch the retired career-ops module.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
import { structuredCreate } from '@/lib/resume/structured';
import type { CandidatePool } from '@/lib/resume/candidate-pool';
import type { TailoredResume } from '@/lib/resume/tailor';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Coverage = 'STRONG' | 'WEAK' | 'ABSENT';

export interface GapItem {
  requirement: string;
  coverage: Coverage;
  supportingClaimIds: string[]; // pool claim ids that back this requirement
  note: string;
}

export interface GapQuestion {
  requirement: string;
  question: string;
  source?: string; // attribution: a research source URL when the question is research-derived
}

export interface GapReport {
  items: GapItem[];
  questions: GapQuestion[];
  generatedAt: string;
}

// ── Model plumbing ─────────────────────────────────────────────────────────────

/** Deterministic anti-anchoring guard: a question is open iff it contains no digit. */
export function questionHasNumericToken(question: string): boolean {
  return /\d/.test(question);
}

// ── STEP A — extract JD requirements ───────────────────────────────────────────

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'extract_requirements',
  description: 'Return the concrete requirements this job asks for, each a short label.',
  input_schema: {
    type: 'object',
    properties: {
      requirements: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short labels for concrete skills, experiences, and signals the JD asks for.',
      },
    },
    required: ['requirements'],
  },
};

async function extractRequirements(jdText: string): Promise<string[]> {
  const prompt =
    `Parse this job description into its concrete REQUIREMENTS — the specific skills, experiences, and ` +
    `signals a candidate needs. Each requirement is a short label (a few words), specific and ` +
    `non-overlapping. Cover both hard requirements and strong "nice to have" signals.\n\n` +
    `=== JOB DESCRIPTION ===\n${jdText}\n`;

  const out = await structuredCreate<{ requirements?: string[] }>({
    stage: 'gap-extract',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8192,
    prompt,
    schema: EXTRACT_TOOL.input_schema as Record<string, unknown>,
  });
  const requirements = (out?.requirements ?? []).map((r) => r.trim()).filter(Boolean);
  // No requirements ⇒ the whole coverage table would be silently empty — fail loud.
  if (!out || requirements.length === 0) throw new Error('gap-extract: structured output failed or returned zero requirements (see WARN above)');
  return requirements;
}

// ── STEP B + C — assess coverage and ask open questions ────────────────────────

const ASSESS_TOOL: Anthropic.Tool = {
  name: 'assess_and_ask',
  description: 'Classify coverage of each requirement against the pool, and ask open questions for gaps.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string' },
            coverage: { type: 'string', enum: ['STRONG', 'WEAK', 'ABSENT'] },
            supportingClaimIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'pool claim ids that support this requirement (empty for ABSENT)',
            },
            note: { type: 'string', description: 'one-line justification' },
          },
          required: ['requirement', 'coverage', 'supportingClaimIds', 'note'],
        },
      },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string' },
            question: { type: 'string' },
          },
          required: ['requirement', 'question'],
        },
        description: 'OPEN questions for WEAK/ABSENT requirements only',
      },
    },
    required: ['items', 'questions'],
  },
};

async function assessAndAsk(
  jdText: string,
  requirements: string[],
  pool: CandidatePool,
  tailored: TailoredResume,
): Promise<{ items: GapItem[]; questions: GapQuestion[] }> {
  const catalog = pool.claims
    .map((c) => `${c.id} :: ${c.entity} :: [${c.section}] :: ${c.text}` +
      (c.metrics.length ? `  {metrics: ${c.metrics.join(', ')}}` : ''))
    .join('\n');

  const usedIds = tailored.provenance.map((p) => p.sourceId);

  const prompt =
    `Assess how well the candidate's REAL material (the CLAIM CATALOG — the only evidence that exists) ` +
    `covers each REQUIREMENT of this job. For each requirement, classify coverage and cite supporting ` +
    `claim ids:\n` +
    `  STRONG = the pool clearly demonstrates it (cite ids).\n` +
    `  WEAK   = only thin/tangential support exists (cite the thin ids).\n` +
    `  ABSENT = nothing in the pool supports it (no ids).\n` +
    `Only cite ids that appear verbatim in the catalog. Judge ONLY from the catalog — never assume ` +
    `unstated experience.\n\n` +
    `Then, for WEAK and ABSENT requirements ONLY, write an OPEN question to Anatole that invites him to ` +
    `supply real evidence. HARD RULES for questions:\n` +
    `  - Open-ended only. NEVER propose a number, percentage, or specific accomplishment to confirm.\n` +
    `  - Do NOT include any digit in a question.\n` +
    `  - Good: "Do you have a measurable outcome from your eval work?"  "Have you built agentic evals ` +
    `you can point to?"\n` +
    `  - Bad:  "Did you improve accuracy by ~20%?"  "Did you build 5 eval suites?"\n` +
    `Ask at most one question per WEAK/ABSENT requirement. Do not ask about STRONG requirements.\n\n` +
    `=== JOB DESCRIPTION ===\n${jdText}\n\n` +
    `=== REQUIREMENTS ===\n${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n` +
    `=== CLAIM CATALOG (id :: entity :: [section] :: text {metrics}) ===\n${catalog}\n\n` +
    `(For context, the tailored resume already surfaced these claim ids: ${usedIds.join(', ') || '(none)'}.)\n`;

  const out = await structuredCreate<{
    items?: Array<{ requirement?: string; coverage?: string; supportingClaimIds?: string[]; note?: string }>;
    questions?: Array<{ requirement?: string; question?: string }>;
  }>({
    stage: 'gap-assess',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 16000,
    prompt,
    schema: ASSESS_TOOL.input_schema as Record<string, unknown>,
  });
  // An empty coverage table that looks like a result is worse than a failure.
  if (!out || !(out.items ?? []).length) throw new Error('gap-assess: structured output failed or returned an empty coverage table (see WARN above)');

  const validIds = new Set(pool.claims.map((c) => c.id));
  const isCoverage = (v: unknown): v is Coverage => v === 'STRONG' || v === 'WEAK' || v === 'ABSENT';

  const items: GapItem[] = (out?.items ?? [])
    .filter((it) => it?.requirement && isCoverage(it.coverage))
    .map((it) => ({
      requirement: it.requirement!.trim(),
      coverage: it.coverage as Coverage,
      // keep only ids that really exist in the pool; ABSENT keeps none
      supportingClaimIds:
        it.coverage === 'ABSENT'
          ? []
          : (it.supportingClaimIds ?? []).filter((id) => validIds.has(id)),
      note: (it.note ?? '').trim(),
    }));

  const questions: GapQuestion[] = (out?.questions ?? [])
    .filter((q) => q?.requirement && q?.question)
    .map((q) => ({ requirement: q.requirement!.trim(), question: q.question!.trim() }));

  return { items, questions };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function buildGapReport(
  jdText: string,
  pool: CandidatePool,
  tailored: TailoredResume,
  researchQuestions: Array<{ question: string; sourceUrl: string }> = [],
): Promise<GapReport> {
  const requirements = await extractRequirements(jdText);
  const { items, questions } = await assessAndAsk(jdText, requirements, pool, tailored);

  // Merge research-derived open questions (attributed to their source URL). They still
  // never propose a number/claim — drop any that carry a digit (anti-anchoring).
  const researchQs: GapQuestion[] = researchQuestions
    .filter((q) => q.question && !questionHasNumericToken(q.question))
    .map((q) => ({ requirement: 'research', question: q.question.trim(), source: q.sourceUrl }));

  return {
    items,
    questions: [...questions, ...researchQs],
    generatedAt: pool.generatedAt,
  };
}
