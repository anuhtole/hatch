/**
 * lib/resume/tailor.ts
 *
 * Phase 3b — the tailoring engine. Given the deterministic candidate pool and a
 * job-description text, it produces a TailoredResume whose every bullet traces
 * to a pool claim id and introduces NO fact/number absent from that source.
 *
 * Two model passes (Opus), both via forced tool-calls for structured output:
 *   STEP A — SELECT: model returns ordered claim *ids* (grouped experience /
 *            projects), by JD relevance. We validate against the pool and drop
 *            any unknown id → droppedUnknownIds. The model never invents text here.
 *   STEP B — REPHRASE: per selected claim, the model rephrases the source text
 *            toward the JD — wording/emphasis only, no new fact/entity/tool, and
 *            any number must come from the source claim's text/metrics. Output is
 *            {sourceId, text}; a missing rephrase falls back to the verbatim source.
 *
 * Header facts per entry (company/role/period/location) come from EntityMeta —
 * NEVER the model. education/additional are intentionally left EMPTY (no grounded
 * source yet — surfaced by the later gap report, not synthesized here).
 *
 * Additive only — does not touch the retired career-ops module.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
import type { CandidatePool, Claim, EntityMeta } from '@/lib/resume/candidate-pool';
import type { ResumeDoc, Entry } from '@/lib/resume/render-docx';
import { measureLineFill, FILL_TARGET } from '@/lib/resume/line-width';
import { TECH_LEXICON, namedSpecifics } from '@/lib/resume/check-cover-letter';
import { isSelectableClaim, isNearDup, scoreBullet, type BulletRubric } from '@/lib/resume/bullet-hygiene';
import { structuredCreate } from '@/lib/resume/structured';
import { diversifySelection, type DiversityReport } from '@/lib/resume/diversity';
import {
  compareProfessional,
  compareResearchProject,
  entityKey,
  minBulletsFor,
  missingHeaderFields,
  type ResumeSection,
} from '@/lib/resume/composition';

// ── B-17 diagnostic seam (additive; NO-OP by default) ───────────────────────────
// When a sink is installed via setTailorTraceSink(), SELECT and REPHRASE emit the
// LITERAL prompt they send plus their inputs/outputs, for read-only pipeline
// tracing. These calls are pure observers — they NEVER alter the prompt, the
// selection, the rephrasing, or any control flow. Default sink is null (no effect).
export interface TailorTraceEvent {
  stage: 'select' | 'rephrase';
  prompt: string;
  data: Record<string, unknown>;
}
let __tailorTraceSink: ((e: TailorTraceEvent) => void) | null = null;
export function setTailorTraceSink(fn: ((e: TailorTraceEvent) => void) | null): void {
  __tailorTraceSink = fn;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TailoredBullet {
  sourceId: string;
  text: string;
}

/** Per-bullet line-fill + quality diagnostic (out/line-fill-report.json). */
export interface LineFillEntry {
  sourceId: string;
  lineCount: number;
  lastLineFill: number; // 0..1
  orphan: boolean;
  reRolled: boolean;    // a longer/shorter re-roll candidate replaced the original
  short: boolean;       // still under-full after the (kept) attempt — truthfully short
  rubric: BulletRubric; // B-6/B-15 quality rubric (diagnostic, not a gate)
  rubricScore: number;  // count of passed rubric criteria (0–5)
  disposition: 'single' | 'split'; // B-15: 'split' ⇒ the source's two ideas render as two bullets
  splitInto: number;    // B-15: rendered bullet count for this claim (1, or 2 when split)
}

/** A grounded, hygiene-passing claim NOT yet rendered — the page-fill floor's
 *  backfill material (B-14). kind/ei address the doc entry it belongs to. */
export interface ReserveBullet {
  sourceId: string;
  text: string;                    // VERBATIM vault claim text (no rephrase → provenance intact)
  kind: 'experience' | 'project';  // doc array (professional ↔ experience, research-project ↔ projects)
  ei: number;                      // entry index within that array
}

/** Per-entry composition accounting (B-14 contract). */
export interface CompositionEntity {
  entity: string;
  sourcePath: string;
  section: ResumeSection;
  kind: 'experience' | 'project';  // doc array
  ei: number;
  min: number;                     // ROLE_MIN_BULLETS floor
  selected: number;                // bullets from SELECT ranking
  backfilled: number;              // verbatim grounded bullets added to reach the floor
  rendered: number;                // total bullets at assembly (pre one-page trim)
  deficit: number;                 // floor shortfall after exhausting the grounded pool
  missingHeaderFields: string[];   // vault frontmatter gaps (action list, never invented)
}

export interface CompositionReport {
  entities: CompositionEntity[];
  actionList: string[];            // loud, human-readable vault to-dos
}

export interface TailoredResume {
  resumeDoc: ResumeDoc;
  provenance: TailoredBullet[];   // every rendered bullet, in render order
  droppedUnknownIds: string[];    // ids the model returned that aren't in the pool
  lineFill: LineFillEntry[];      // per-bullet last-line fill (experience+projects)
  selectedOrder: string[];        // ordered claim ids from SELECT (for before/after diffs)
  suppressedDuplicates: TailoredBullet[]; // near-dup bullets dropped at assembly
  reserve: ReserveBullet[];       // grounded bullets available to the page-fill floor
  composition: CompositionReport; // B-14 skeleton accounting + action list
  diversity: DiversityReport;     // B-27 post-SELECT dedup verdicts + reselection decisions
  generatedAt: string;
}

// ── Per-bullet anti-fabrication gate (mirrors check-provenance + check-resume-drift) ──
// Used to validate a line-fill re-roll candidate BEFORE accepting it; the full guards
// still run at the end. A candidate that fails here is rejected (original kept).

function numericCores(s: string): string[] {
  return [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));
}

function bulletPasses(candidate: string, claim: Claim, jdLower: string): boolean {
  // (a) numeric provenance — every number must be in the source claim.
  const allowedNums = new Set(numericCores(`${claim.text} ${claim.metrics.join(' ')}`));
  if (numericCores(candidate).some((n) => !allowedNums.has(n))) return false;
  // (b) drift — no JD term / named specific grafted in that isn't in the source.
  const source = `${claim.text} ${claim.entity ?? ''}`.toLowerCase();
  const cand = candidate.toLowerCase();
  for (const term of TECH_LEXICON) {
    if (cand.includes(term) && jdLower.includes(term) && !source.includes(term)) return false;
  }
  for (const pn of namedSpecifics(candidate)) {
    const low = pn.toLowerCase();
    if (cand.includes(low) && jdLower.includes(low) && !source.includes(low)) return false;
  }
  return true;
}

// ── B-39 DELETE-ONLY condense guard ──────────────────────────────────────────────
// A condensed bullet must be a strict DELETE of the ORIGINAL RENDERED bullet: it may
// drop words/clauses (and stopwords), but may NOT introduce any content word or number
// absent from the original. This operates on the ORIGINAL BULLET (not the source claim),
// so — unlike bulletPasses — it structurally blocks re-authoring-from-source. Pure,
// order-independent subset test.
const CONDENSE_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'to', 'in', 'for', 'with', 'that', 'on', 'at', 'by',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'their', 'this', 'these',
  'those', 'or', 'but', 'into', 'via', 'per', 'than', 'then', 'so', 'up', 'out', 'over',
  'under', 'before', 'after', 'each', 'every', 'a', 'an',
]);
/** Content words of a bullet, lowercased, stopwords removed (numbers kept as tokens). */
function condenseTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((w) => !CONDENSE_STOPWORDS.has(w));
}
/** True iff `condensed` introduces NO content word and NO number absent from `original`
 *  (dropping is allowed, adding is not). Delete-only — blocks any new vocabulary. */
export function isDeleteOnlyCondense(original: string, condensed: string): boolean {
  const origWords = new Set(condenseTokens(original));
  for (const w of condenseTokens(condensed)) {
    if (!origWords.has(w)) return false;
  }
  const origNums = new Set(numericCores(original));
  for (const n of numericCores(condensed)) {
    if (!origNums.has(n)) return false;
  }
  return true;
}

/** Goodness of a rendered bullet for line-fill: 1.0 if it needs no fill, else its
 *  last-line fill fraction (orphans already score low via their tiny last line). */
function fillGoodness(text: string): number {
  const m = measureLineFill(text);
  return m.needsFill ? m.lastLineFill : 1.0;
}

// ── Model plumbing ─────────────────────────────────────────────────────────────

// ── STEP A — SELECT (ids only) ─────────────────────────────────────────────────

const SELECT_TOOL: Anthropic.Tool = {
  name: 'select_claims',
  description: 'Return the chosen claim ids, ordered most-JD-relevant first, grouped by section.',
  input_schema: {
    type: 'object',
    properties: {
      experience: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered claim ids for the Professional Experience section.',
      },
      projects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered claim ids for the Research & Project Experience section.',
      },
    },
    required: ['experience', 'projects'],
  },
};

export async function selectClaimIds(
  pool: CandidatePool,
  jdText: string,
  emphasis: string[] = [],
): Promise<{ orderedIds: string[]; droppedUnknownIds: string[] }> {
  // SELECT draws ONLY from SELECTABLE experience|project claims — education/
  // additional are excluded (kind filter), and structural NOISE (prose lead-ins,
  // role-restatements, comments, frontmatter leak) is excluded by the shared
  // bullet-hygiene predicate so it can never reach the catalog or the output.
  const selectable = pool.claims.filter(isSelectableClaim);
  const catalog = selectable
    .map((c) => `${c.id} :: ${c.entity} :: [${c.section}] :: ${c.text}`)
    .join('\n');

  const prompt =
    `You are tailoring a résumé to a specific job. Below is a job description, then a CATALOG of ` +
    `candidate claims (the ONLY material you may use — each is a real, verbatim bullet/line from the ` +
    `candidate's records, tagged with a stable id).\n\n` +
    `Select the claims most relevant to THIS job and order them most-relevant-first. Group them into ` +
    `Professional Experience (real jobs/roles) and Research & Project Experience (projects/research). ` +
    `Return ONLY claim ids — do not write or edit any text in this step. Be selective: choose the ` +
    `strongest, on-point claims; skip filler. Use each id at most once.\n\n` +
    (emphasis.length
      ? `RESEARCH EMPHASIS (ranking guidance ONLY — affects ORDER/priority, never truthfulness): among the ` +
        `grounded claims, prefer those most relevant to these researched priorities: ${emphasis.join('; ')}. ` +
        `Never select an off-point claim just because of a theme; this only re-orders genuinely relevant claims.\n\n`
      : '') +
    `=== JOB DESCRIPTION ===\n${jdText}\n\n` +
    `=== CLAIM CATALOG (id :: entity :: [section] :: text) ===\n${catalog}\n`;

  const out = await structuredCreate<{ experience?: string[]; projects?: string[] }>({
    stage: 'tailor-select',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8192,
    prompt,
    schema: SELECT_TOOL.input_schema as Record<string, unknown>,
  });
  // An empty selection is never a valid result — fail the stage rather than
  // silently rendering an empty résumé.
  if (!out) throw new Error('tailor-select: structured output failed (see WARN above)');
  const raw = [...(out?.experience ?? []), ...(out?.projects ?? [])];

  const validIds = new Set(selectable.map((c) => c.id)); // hygiene: only selectable ids survive
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const droppedUnknownIds: string[] = [];
  for (const id of raw) {
    if (!validIds.has(id)) { droppedUnknownIds.push(id); continue; }
    if (seen.has(id)) continue; // dedupe; keep first (most-relevant) position
    seen.add(id);
    orderedIds.push(id);
  }
  __tailorTraceSink?.({
    stage: 'select',
    prompt,
    data: {
      toolSchema: SELECT_TOOL.input_schema,
      catalogIds: selectable.map((c) => c.id),
      rawReturned: raw,
      orderedIds,
      droppedUnknownIds,
    },
  });
  return { orderedIds, droppedUnknownIds };
}

// ── STEP B — REPHRASE (text per selected claim) ────────────────────────────────

// REPHRASE returns 1–2 bullets per claim. `texts` is normally one rephrased bullet;
// it is TWO ONLY when the source claim genuinely carries two distinct grounded ideas
// that each stand alone (the B-15 one-idea SPLIT). Both children must trace to the
// same source claim and pass provenance+drift; otherwise the model returns one.
const REPHRASE_TOOL: Anthropic.Tool = {
  name: 'submit_bullets',
  description: 'Return the rephrased bullet(s) for each provided claim id.',
  input_schema: {
    type: 'object',
    properties: {
      bullets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sourceId: { type: 'string', description: 'the claim id this bullet rephrases' },
            texts: {
              type: 'array',
              items: { type: 'string' },
              description:
                'AT MOST TWO items. ONE rephrased bullet normally; TWO single-idea bullets ONLY ' +
                'when the source packs two distinct grounded ideas, each strong and complete on ' +
                'its own. Never return more than two.',
            },
          },
          required: ['sourceId', 'texts'],
        },
      },
    },
    required: ['bullets'],
  },
};

// Single-text variant for length-only line-fill re-rolls (no splitting there).
const SINGLE_BULLET_TOOL: Anthropic.Tool = {
  name: 'submit_bullets',
  description: 'Return the restructured bullet text for each provided claim id.',
  input_schema: {
    type: 'object',
    properties: {
      bullets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sourceId: { type: 'string', description: 'the claim id this bullet rephrases' },
            text: { type: 'string', description: 'the restructured bullet, JD-aligned' },
          },
          required: ['sourceId', 'text'],
        },
      },
    },
    required: ['bullets'],
  },
};

async function rephraseClaims(
  selected: Claim[],
  jdText: string,
): Promise<Map<string, string[]>> {
  if (selected.length === 0) return new Map();

  const items = selected
    .map((c) => {
      const nums = c.metrics.length ? c.metrics.join(', ') : '(none)';
      // `entity` is provided so the model can keep bullets of the SAME entity
      // grammatically parallel (the source claim text + entity are the only
      // allowed material — both are already in the per-bullet drift allow-set).
      return `- id: ${c.id}\n  entity: ${c.entity}\n  source_text: ${c.text}\n  allowed_numbers: ${nums}`;
    })
    .join('\n');

  const prompt =
    `Rephrase each résumé bullet below to read crisply and to FOREGROUND the aspects most relevant to the ` +
    `target job — but strictly within each bullet's own facts and wording. This is a HARD anti-fabrication ` +
    `task:\n` +
    `- Rephrase ONLY, using the bullet's OWN substance and terminology. Do NOT introduce any fact, company, ` +
    `product, tool, technology, technique, qualifier, or claim that is not already in that bullet's ` +
    `source_text.\n` +
    `- Do NOT graft the job description's vocabulary onto a bullet. NEVER add a domain/technical term ` +
    `(e.g. "eval", "evals", "agentic", "RAG", "benchmark", "fine-tuned", "multi-agent", "orchestration", ` +
    `"LLM") or a named tool/technique unless that EXACT term already appears in that bullet's source_text. ` +
    `You may reorder and emphasize what the source already says; you may NOT relabel it in the JD's words.\n` +
    `- NUMBERS: you may only use numbers from that bullet's allowed_numbers list (which are exactly the ` +
    `numbers in its source_text). Prefer to keep them. You may OMIT a number, but NEVER add, change, or ` +
    `invent one. If allowed_numbers is "(none)", your rephrase must contain no digits.\n` +
    `- LENGTH: aim each bullet to fill its line well — a bullet that wraps should fill its final line ` +
    `(≈ a full line, not a few dangling words). But adjust length ONLY by restructuring the bullet's OWN ` +
    `grounded content (word order, connective phrasing, expanding or contracting detail already present in ` +
    `source_text). NEVER add a tool, metric, term, or claim to fill space. If a bullet cannot truthfully ` +
    `fill the line, leave it short — short is correct, padding is fabrication.\n` +
    `\n` +
    `QUALITY RUBRIC — every bullet must satisfy ALL of these (they are wording choices over grounded ` +
    `content only, never licence to add content):\n` +
    `  1. STRONG LEAD VERB: open with a specific past-tense action verb the source supports ` +
    `(Built/Led/Designed/Architected/Drove/Shipped…). Never open with throat-clearing or filler ` +
    `("Responsible for", "Worked on", "Helped", "Various", "Successfully").\n` +
    `  2. SURFACE THE OUTCOME: when the source_text contains a concrete result, scope, or impact ` +
    `(a number, a "so that", an adoption/approval/scale fact), foreground it — do not bury it or drop it. ` +
    `If the source has no outcome, do NOT invent one; state the action plainly.\n` +
    `  3. ONE IDEA PER BULLET: each bullet expresses a single idea. If a source_text packs TWO distinct, ` +
    `independently-strong grounded ideas, you MAY return BOTH as two separate single-idea bullets in ` +
    `\`texts\` (each must stand alone, each grounded in this same source_text, each JD-relevant). ` +
    `Otherwise return ONE bullet foregrounding the strongest idea — never chain unrelated clauses, and ` +
    `never split a single idea into two thin halves.\n` +
    `  4. PARALLEL STRUCTURE: bullets that share an \`entity\` should read in parallel — consistent verb-led ` +
    `grammar and tense across that entity's bullets.\n` +
    `  5. NO FILLER: no throat-clearing, no hedging, no empty qualifiers; every word earns its place.\n` +
    `  If allowed_numbers has entries, KEEP at least one (its strongest grounded metric) unless it ` +
    `genuinely doesn't fit the chosen idea.\n` +
    `- Keep it resume-appropriate. Return one entry per id (same sourceId); \`texts\` holds 1 bullet ` +
    `normally, or 2 ONLY for a genuine one-idea split.\n\n` +
    `=== TARGET JOB (for choosing what to foreground — NOT a source of words) ===\n${jdText}\n\n` +
    `=== BULLETS TO REPHRASE ===\n${items}\n`;

  const out = await structuredCreate<{ bullets?: Array<{ sourceId?: string; texts?: string[] }> }>({
    stage: 'tailor-rephrase',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8192,
    prompt,
    schema: REPHRASE_TOOL.input_schema as Record<string, unknown>,
  });
  if (!out) console.warn('⚠ [tailor-rephrase] structured output failed — keeping VERBATIM source text for all selected bullets (provenance-safe fallback)');
  const selectedIds = new Set(selected.map((c) => c.id));
  const map = new Map<string, string[]>();
  for (const b of out?.bullets ?? []) {
    if (!b?.sourceId || !selectedIds.has(b.sourceId) || map.has(b.sourceId)) continue;
    const texts = (Array.isArray(b.texts) ? b.texts : [])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim())
      .slice(0, 2);
    if (texts.length) map.set(b.sourceId, texts);
  }

  // STRUCTURAL ACCEPTANCE GATE (B-7, per child): EACH candidate bullet is accepted
  // ONLY if it passes its OWN claim's numeric + drift check — this catches the model
  // shuffling texts across sourceIds (cross-claim misattribution). For a 2-way split,
  // each child is checked independently and a failing child is dropped; if both fail,
  // the id falls back to the VERBATIM source downstream (provenance-clean). Split
  // children that are near-duplicates of each other collapse to the first (no padding).
  const byId = new Map(selected.map((c) => [c.id, c]));
  const jdLower = jdText.toLowerCase();
  let rejectedChildren = 0;
  let collapsedIds = 0;
  let splitIds = 0;
  for (const [id, texts] of [...map]) {
    const claim = byId.get(id);
    if (!claim) { map.delete(id); continue; }
    const kept: string[] = [];
    for (const t of texts) {
      if (bulletPasses(t, claim, jdLower)) kept.push(t);
      else rejectedChildren++;
    }
    // Drop a second child that merely duplicates the first.
    if (kept.length === 2 && isNearDup(kept[0], kept[1])) { kept.pop(); collapsedIds++; }
    if (kept.length === 0) map.delete(id);
    else { map.set(id, kept); if (kept.length === 2) splitIds++; }
  }
  if (rejectedChildren > 0) console.log(`[tailor] rephrase acceptance gate: ${rejectedChildren} candidate bullet(s) failed their own claim's check → dropped (verbatim fallback where all failed)`);
  if (collapsedIds > 0) console.log(`[tailor] rephrase: ${collapsedIds} split(s) collapsed to one (near-duplicate halves)`);
  if (splitIds > 0) console.log(`[tailor] rephrase: ${splitIds} compound bullet(s) split into two single-idea bullets`);
  __tailorTraceSink?.({
    stage: 'rephrase',
    prompt,
    data: {
      toolSchema: REPHRASE_TOOL.input_schema,
      inputs: selected.map((c) => ({ id: c.id, entity: c.entity, text: c.text, metrics: c.metrics })),
      acceptedOutputs: [...map].map(([id, texts]) => ({ id, texts })),
    },
  });
  return map;
}

// ── STEP B′ — LINE-FILL RE-ROLL (length only, never content) ────────────────────
// For bullets whose rendered text wraps with an under-full / orphaned last line,
// ask once for a restructured candidate of a better length — restructuring grounded
// content ONLY. Caller keeps the candidate only if it passes the per-bullet gate and
// actually improves fill. One batched call for all under-full bullets.

async function reRollUnderfull(
  items: Array<{ claim: Claim; current: string; diag: string }>,
  jdText: string,
): Promise<Map<string, string>> {
  if (items.length === 0) return new Map();

  const body = items
    .map(({ claim, current, diag }) => {
      const nums = claim.metrics.length ? claim.metrics.join(', ') : '(none)';
      return (
        `- id: ${claim.id}\n  source_text: ${claim.text}\n  allowed_numbers: ${nums}\n` +
        `  current_bullet: ${current}\n  fit: ${diag}`
      );
    })
    .join('\n');

  const prompt =
    `Each résumé bullet below wraps to an awkward length (its final line is under-full or a 1–2 word ` +
    `orphan). Restructure EACH so it reads better — EITHER it fits a single full line OR its final wrapped ` +
    `line is ≥80% full. This is a HARD anti-fabrication task:\n` +
    `- Adjust length ONLY by restructuring the bullet's OWN grounded substance: reorder words, change ` +
    `connective phrasing, expand or contract detail that is ALREADY in source_text.\n` +
    `- NEVER add a fact, number, company, product, tool, technology, technique, or JD term that is not ` +
    `already in that bullet's source_text. Do NOT graft the job description's vocabulary.\n` +
    `- NUMBERS: only numbers from allowed_numbers; you may omit but never add/change/invent. "(none)" ⇒ no digits.\n` +
    `- If a bullet cannot truthfully be made fuller, return it unchanged — short is correct.\n` +
    `- Return one entry per id, same sourceId.\n\n` +
    `=== TARGET JOB (for emphasis only — NOT a source of words) ===\n${jdText}\n\n` +
    `=== BULLETS TO RESTRUCTURE ===\n${body}\n`;

  const out = await structuredCreate<{ bullets?: Array<{ sourceId?: string; text?: string }> }>({
    stage: 'line-fill-reroll',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8192,
    prompt,
    schema: SINGLE_BULLET_TOOL.input_schema as Record<string, unknown>,
  });
  if (!out) console.warn('⚠ [line-fill-reroll] structured output failed — keeping the original bullet texts');
  const ids = new Set(items.map((i) => i.claim.id));
  const map = new Map<string, string>();
  for (const b of out?.bullets ?? []) {
    if (b?.sourceId && ids.has(b.sourceId) && typeof b.text === 'string' && b.text.trim()) {
      if (!map.has(b.sourceId)) map.set(b.sourceId, b.text.trim());
    }
  }
  return map;
}

/**
 * Apply line-fill optimization to the selected claims' chosen text (mutates the
 * `rephrased` map in place to the final kept text) and return a per-bullet report.
 * Re-roll candidates must pass the per-bullet anti-fabrication gate AND improve fill,
 * else the original is kept.
 */
async function optimizeLineFill(
  orderedClaims: Claim[],
  rephrased: Map<string, string[]>,
  jdText: string,
): Promise<LineFillEntry[]> {
  const jdLower = jdText.toLowerCase();
  const renderable = orderedClaims.filter((c) => c.kind === 'experience' || c.kind === 'project');

  // Identify under-full / orphaned bullets from their current chosen text. Only
  // SINGLE-bullet claims are re-rolled for length; a SPLIT claim's children are
  // single-idea by construction, and "short" is the correct state for them — a
  // crisp single idea must never be padded back toward a full line.
  const toReroll: Array<{ claim: Claim; current: string; diag: string }> = [];
  for (const c of renderable) {
    const texts = rephrased.get(c.id) ?? [c.text];
    if (texts.length !== 1) continue;
    const current = texts[0];
    const m = measureLineFill(current);
    if (m.needsFill) {
      const diag = m.orphan
        ? `wraps to ${m.lineCount} lines; final line is a ${m.lastWordCount}-word orphan (${Math.round(m.lastLineFill * 100)}% full)`
        : `wraps to ${m.lineCount} lines; final line ${Math.round(m.lastLineFill * 100)}% full (target ≥${Math.round(FILL_TARGET * 100)}%)`;
      toReroll.push({ claim: c, current, diag });
    }
  }

  const candidates = await reRollUnderfull(toReroll, jdText);
  const rerolledIds = new Set<string>();
  for (const { claim, current } of toReroll) {
    const cand = candidates.get(claim.id);
    if (
      cand &&
      cand !== current &&
      bulletPasses(cand, claim, jdLower) &&
      fillGoodness(cand) > fillGoodness(current)
    ) {
      rephrased.set(claim.id, [cand]);
      rerolledIds.add(claim.id);
    }
  }

  // Build the report from the FINAL chosen text(s) (post-reroll), including the
  // B-6/B-15 quality rubric. The report keeps one entry per claim; for a split
  // claim, line metrics + rubric are scored on the FIRST child and `splitInto`
  // records that two bullets render.
  return renderable.map((c) => {
    const texts = rephrased.get(c.id) ?? [c.text];
    const primary = texts[0];
    const m = measureLineFill(primary);
    const siblings = renderable
      .filter((s) => s.id !== c.id && s.groupKey === c.groupKey)
      .flatMap((s) => rephrased.get(s.id) ?? [s.text]);
    const rubric = scoreBullet(primary, c.metrics.length, siblings);
    return {
      sourceId: c.id,
      lineCount: m.lineCount,
      lastLineFill: m.lastLineFill,
      orphan: m.orphan,
      reRolled: rerolledIds.has(c.id),
      short: m.needsFill,
      rubric,
      rubricScore: Object.values(rubric).filter(Boolean).length,
      disposition: texts.length === 2 ? 'split' : 'single',
      splitInto: texts.length,
    };
  });
}

// ── Assembly ────────────────────────────────────────────────────────────────────

function entryFor(meta: EntityMeta, bullets: string[]): Entry {
  return {
    company: meta.name,
    location: meta.location ?? '',
    role: meta.role ?? '',
    dates: meta.period ?? '',
    bullets,
  };
}

/**
 * B-14 COMPOSITION CONTRACT assembly. The section's entry roster + order come
 * from vault metadata (EntityMeta.section, deterministic ordering) — NEVER from
 * the model. SELECT's ranking only decides which grounded bullets fill each
 * entry's slots:
 *   - every roster entity renders (no role deletion);
 *   - selected claims fill an entry in rank order (near-dup suppressed);
 *   - below the ROLE_MIN_BULLETS floor, verbatim grounded claims backfill in
 *     pool order (hygiene-filtered) — truthful deficit reported if exhausted;
 *   - leftover grounded claims become the page-fill floor's reserve.
 * Header facts come from EntityMeta; missing fields are action-listed, never invented.
 */
function buildSectionEntries(
  section: 'professional' | 'research-project',
  pool: CandidatePool,
  orderedClaims: Claim[],
  rephrased: Map<string, string[]>,
  provenance: TailoredBullet[],
  suppressed: TailoredBullet[],
  reserve: ReserveBullet[],
  compEntities: CompositionEntity[],
): Entry[] {
  const docKind = section === 'professional' ? 'experience' : 'project';
  const roster = pool.entities
    .filter((e) => e.section === section && (e.kind === 'experience' || e.kind === 'project'))
    .sort(section === 'professional' ? compareProfessional : compareResearchProject);

  return roster.map((meta, ei) => {
    const bullets: string[] = [];
    const sources: string[] = [];
    const used = new Set<string>();

    // 1. SELECT-ranked claims for THIS entity (the model's only influence here).
    //    A claim renders 1 bullet normally, or 2 when the rephrase split its
    //    source's two grounded ideas — both children trace to the same claim id.
    let selected = 0;
    for (const c of orderedClaims) {
      if (c.groupKey !== meta.groupKey) continue;
      used.add(c.id);
      const texts = rephrased.get(c.id) ?? [c.text]; // verbatim fallback keeps provenance intact
      // Near-dup is judged on the SOURCE claim (one decision per claim); a whole
      // duplicate claim is suppressed, its split children with it.
      if (sources.some((prev) => isNearDup(prev, c.text))) {
        suppressed.push({ sourceId: c.id, text: texts[0] });
        continue;
      }
      for (const text of texts) {
        bullets.push(text);
        provenance.push({ sourceId: c.id, text });
        selected++;
      }
      sources.push(c.text);
    }

    // 2. Floor backfill: verbatim grounded claims, pool order, hygiene-filtered.
    const min = minBulletsFor(meta.sourcePath);
    const unselected = pool.claims.filter(
      (c) => c.groupKey === meta.groupKey && isSelectableClaim(c) && !used.has(c.id),
    );
    let backfilled = 0;
    for (const c of unselected) {
      if (bullets.length >= min) break;
      if (sources.some((prev) => isNearDup(prev, c.text))) continue;
      used.add(c.id);
      bullets.push(c.text);
      sources.push(c.text);
      provenance.push({ sourceId: c.id, text: c.text });
      backfilled++;
    }

    // 3. Whatever grounded material remains → the page-fill floor's reserve.
    for (const c of unselected) {
      if (used.has(c.id)) continue;
      reserve.push({ sourceId: c.id, text: c.text, kind: docKind, ei });
    }

    compEntities.push({
      entity: meta.name,
      sourcePath: meta.sourcePath,
      section,
      kind: docKind,
      ei,
      min,
      selected,
      backfilled,
      rendered: bullets.length,
      deficit: Math.max(0, min - bullets.length),
      missingHeaderFields: missingHeaderFields(meta),
    });

    return entryFor(meta, bullets);
  });
}

// ── COMPACTION (B-14 · relaxed B-16) ────────────────────────────────────────────
// When one-page trim bottoms out at the ROLE_MIN_BULLETS floors and the page is
// still over budget, the only honest lever left is bullet LENGTH. B-16: TWO-LINE
// bullets are allowed (matching the canonical CV's density) — only bullets that
// render across THREE+ lines are compacted, and only down to ≤ two lines. Each is
// re-rolled through the SAME per-bullet anti-fabrication gate as line-fill re-rolls
// (numbers from source only, no JD-term grafting) — dropping detail is truthful,
// adding is impossible. Rejected/failed candidates keep the original (never invented).

const COMPACT_TOOL: Anthropic.Tool = {
  name: 'submit_compact_bullets',
  description: 'Return a shorter (≤ two-line) phrasing for each bullet.',
  input_schema: {
    type: 'object',
    properties: {
      bullets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sourceId: { type: 'string' },
            text: { type: 'string', description: 'the compacted bullet' },
          },
          required: ['sourceId', 'text'],
        },
      },
    },
    required: ['bullets'],
  },
};

export async function compactBullets(
  doc: ResumeDoc,
  provenance: TailoredBullet[],
  pool: CandidatePool,
  jdText: string,
): Promise<{ compacted: number; attempted: number }> {
  const claimById = new Map(pool.claims.map((c) => [c.id, c]));
  const jdLower = jdText.toLowerCase();
  // B-16: two-line bullets are allowed; only THREE+-line bullets are compaction targets.
  const isOverlong = (t: string) => measureLineFill(t).lineCount > 2;

  const targets = provenance.filter((p) => isOverlong(p.text) && claimById.has(p.sourceId));
  if (!targets.length) return { compacted: 0, attempted: 0 };

  const listing = targets
    .map((p) => `${p.sourceId} :: ${p.text}\n   SOURCE: ${claimById.get(p.sourceId)!.text}`)
    .join('\n');
  const prompt =
    `These résumé bullets render across THREE OR MORE lines; the page budget needs each cut to AT MOST ` +
    `TWO lines (≤ ~190 characters). For each, return a compacted phrasing that:\n` +
    `- keeps the strongest fact(s) and the metric if one exists;\n` +
    `- uses ONLY facts/terms present in the bullet or its SOURCE — never add a tool, number, or claim;\n` +
    `- stays a strong, specific résumé bullet (lead verb, one idea).\n` +
    `Cutting detail is fine — inventing is not. Return every id.\n\n${listing}`;

  const out = await structuredCreate<{ bullets?: Array<{ sourceId: string; text: string }> }>({
    stage: 'tailor-compact',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8192,
    prompt,
    schema: COMPACT_TOOL.input_schema as Record<string, unknown>,
  });
  if (!out?.bullets) return { compacted: 0, attempted: targets.length };

  let compacted = 0;
  const usedTargets = new Set<TailoredBullet>(); // split children share a sourceId; never compact one twice
  for (const cand of out.bullets) {
    const orig = targets.find((t) => t.sourceId === cand.sourceId && !usedTargets.has(t));
    const claim = claimById.get(cand.sourceId);
    if (!orig || !claim || !cand.text?.trim()) continue;
    usedTargets.add(orig);
    const text = cand.text.trim();
    // Acceptance: strictly fewer rendered lines + the anti-fabrication gate.
    if (measureLineFill(text).lineCount >= measureLineFill(orig.text).lineCount) continue;
    if (!bulletPasses(text, claim, jdLower)) continue;
    // Apply to provenance AND the doc entry that carries the old text.
    const old = orig.text;
    orig.text = text;
    for (const entries of [doc.experience, doc.projects]) {
      for (const e of entries) {
        const bi = e.bullets.indexOf(old);
        if (bi !== -1) { e.bullets[bi] = text; }
      }
    }
    compacted++;
  }
  return { compacted, attempted: targets.length };
}

// ── ORPHAN-CONDENSE (B-39) ───────────────────────────────────────────────────────
// Kill a TRUE ORPHAN — a multi-line bullet whose last wrapped line is a single word OR
// under ~20% full (the "strategy" dangling-line case) — by DELETING words from the
// rendered bullet so it fits FEWER lines. This is the reclaim opposite of restoreLineFill
// and is gated harder than compaction: besides bulletPasses (numeric provenance + drift),
// the candidate must be a DELETE-ONLY token-subset of the ORIGINAL bullet
// (isDeleteOnlyCondense) — no new vocabulary, no re-authoring-from-source. It targets
// ONLY true orphans, never the 0.20–0.80 prose band (left to restoreLineFill) or ≥0.80.
// Strictly fewer lines on accept ⇒ the page can only shrink (no overflow, no re-measure).
// Returns the accepted condensed TEXTS so the caller can keep restoreLineFill from
// re-lengthening them.
export async function condenseOrphans(
  doc: ResumeDoc,
  provenance: TailoredBullet[],
  pool: CandidatePool,
  jdText: string,
): Promise<{ condensed: number; attempted: number; condensedTexts: string[]; pairs: Array<{ before: string; after: string }> }> {
  const claimById = new Map(pool.claims.map((c) => [c.id, c]));
  const jdLower = jdText.toLowerCase();
  const isTrueOrphan = (t: string): boolean => {
    const m = measureLineFill(t);
    return m.lineCount > 1 && (m.lastWordCount === 1 || m.lastLineFill < 0.20);
  };

  const targets = provenance.filter((p) => isTrueOrphan(p.text) && claimById.has(p.sourceId));
  if (!targets.length) return { condensed: 0, attempted: 0, condensedTexts: [], pairs: [] };

  const listing = targets.map((p) => `${p.sourceId} :: ${p.text}`).join('\n');
  const prompt =
    `Each résumé bullet below wraps so its LAST line is a near-empty ORPHAN — a single dangling word ` +
    `or a tiny fragment — wasting a whole line. SHORTEN each by DELETING words so it fits in FEWER ` +
    `lines with no dangling last line. HARD rules:\n` +
    `- DELETE-ONLY: remove words, clauses, qualifiers, or filler. NEVER add or change a word — EVERY ` +
    `word in your result must already appear verbatim in the original bullet. Do not rephrase, do not ` +
    `reorder into a new claim, do not introduce ANY new term, tool, synonym, or number.\n` +
    `- Keep the strongest fact and any metric, a strong lead verb, and one idea.\n` +
    `- If you cannot shorten it by deletion alone without losing the core claim, return it UNCHANGED. ` +
    `An honest orphan is fine; a reworded bullet is not.\n` +
    `Return every id.\n\n${listing}`;

  const out = await structuredCreate<{ bullets?: Array<{ sourceId: string; text: string }> }>({
    stage: 'tailor-condense-orphan',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8192,
    prompt,
    schema: COMPACT_TOOL.input_schema as Record<string, unknown>,
  });
  if (!out?.bullets) return { condensed: 0, attempted: targets.length, condensedTexts: [], pairs: [] };

  let condensed = 0;
  const condensedTexts: string[] = [];
  const pairs: Array<{ before: string; after: string }> = [];
  const usedTargets = new Set<TailoredBullet>(); // split children share a sourceId; never condense one twice
  for (const cand of out.bullets) {
    const orig = targets.find((t) => t.sourceId === cand.sourceId && !usedTargets.has(t));
    const claim = claimById.get(cand.sourceId);
    if (!orig || !claim || !cand.text?.trim()) continue;
    usedTargets.add(orig);
    const text = cand.text.trim();
    // Acceptance — ALL must hold:
    if (measureLineFill(text).lineCount >= measureLineFill(orig.text).lineCount) continue; // (a) strictly fewer lines
    if (!isDeleteOnlyCondense(orig.text, text)) continue;                                  // (b) delete-only subset of ORIGINAL
    if (!bulletPasses(text, claim, jdLower)) continue;                                     // (c) numeric provenance + drift
    if (condenseTokens(text).length < 3) continue;                                         // (d) still a real bullet, not a stub
    const old = orig.text;
    orig.text = text;
    condensedTexts.push(text);
    pairs.push({ before: old, after: text });
    for (const entries of [doc.experience, doc.projects]) {
      for (const e of entries) {
        const bi = e.bullets.indexOf(old);
        if (bi !== -1) { e.bullets[bi] = text; }
      }
    }
    condensed++;
  }
  return { condensed, attempted: targets.length, condensedTexts, pairs };
}

// ── RESTORE LINE-FILL (B-26) ─────────────────────────────────────────────────────
// A STANDING render-feedback pass that runs AFTER the deterministic render is fixed
// (post roster-fit + post compaction). For each rendered bullet whose LAST wrapped
// line is under-full, ask the model to RESTORE grounded detail the current phrasing
// dropped — a clause/qualifier/specific ALREADY in source_text — to fill that last
// line fuller. The opposite of compaction; the same hard anti-fabrication gate.
// Acceptance: the candidate must (a) pass its own claim's numeric+drift check, (b)
// NOT grow to more wrapped lines than it already has (so total height is unchanged →
// the page CANNOT spill past 1 Word page; no re-measure needed), and (c) actually
// improve the last-line fill. ≤3 passes per run; stops when nothing improves.

export async function restoreLineFill(
  doc: ResumeDoc,
  provenance: TailoredBullet[],
  pool: CandidatePool,
  jdText: string,
  skipTexts: Set<string> = new Set(),
): Promise<{ restored: number; attempted: number; passes: number }> {
  const claimById = new Map(pool.claims.map((c) => [c.id, c]));
  const jdLower = jdText.toLowerCase();
  // A bullet is restorable if its last line is under-full (in the PROSE BAND) AND its
  // source claim has meaningfully more grounded text than the current bullet (dropped
  // detail to re-add).
  const restorable = (p: TailoredBullet): boolean => {
    // B-39: never re-lengthen a bullet condensed this run.
    if (skipTexts.has(p.text)) return false;
    // B-39: PROSE BAND ONLY — a multi-line last line 20–80% full. TRUE ORPHANS
    // (single word OR <20% fill) are reclaimed by condenseOrphans, never lengthened
    // here; a ≥80% (FILL_TARGET) last line needs nothing.
    const m = measureLineFill(p.text);
    if (!(m.lineCount > 1 && m.lastWordCount > 1 && m.lastLineFill >= 0.20 && m.lastLineFill < FILL_TARGET)) return false;
    const c = claimById.get(p.sourceId);
    if (!c) return false;
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    return norm(c.text).length > norm(p.text).length + 10;
  };

  let restored = 0;
  let attempted = 0;
  let passes = 0;
  for (let pass = 0; pass < 3; pass++) {
    const targets = provenance.filter(restorable);
    if (!targets.length) break;
    passes = pass + 1;
    attempted = Math.max(attempted, targets.length);

    const listing = targets
      .map((p) => {
        const c = claimById.get(p.sourceId)!;
        const nums = c.metrics.length ? c.metrics.join(', ') : '(none)';
        return `${p.sourceId} :: current_bullet: ${p.text}\n   current_line_count: ${measureLineFill(p.text).lineCount}\n   allowed_numbers: ${nums}\n   source_text: ${c.text}`;
      })
      .join('\n');
    const prompt =
      `Each résumé bullet below is rendered, but its LAST wrapped line is under-full. Re-express each ` +
      `to fill that last line FULLER by RESTORING grounded detail the current phrasing dropped — a clause, ` +
      `qualifier, or specific that is ALREADY in that bullet's source_text. HARD anti-fabrication rules:\n` +
      `- Use ONLY content present in that bullet's source_text. NEVER add a fact, term, number, tool, or ` +
      `claim not already in source_text, and do NOT graft the job description's vocabulary.\n` +
      `- NUMBERS: only numbers from allowed_numbers (which are exactly the numbers in source_text); never ` +
      `add/change/invent. "(none)" ⇒ no digits.\n` +
      `- LINES: the result must NOT wrap to MORE lines than current_line_count. Restore only as much detail ` +
      `as fits within that many lines — if restoring a clause would add a line, restore LESS.\n` +
      `- If there is nothing left in source_text to truthfully restore within the line budget, return the ` +
      `bullet UNCHANGED. Short is correct; padding is forbidden.\n` +
      `- Keep a strong lead verb and one idea. Return one entry per id, same sourceId.\n\n` +
      `=== TARGET JOB (emphasis only — NOT a source of words) ===\n${jdText}\n\n` +
      `=== BULLETS TO RESTORE ===\n${listing}\n`;

    const out = await structuredCreate<{ bullets?: Array<{ sourceId?: string; text?: string }> }>({
      stage: 'restore-line-fill',
      model: ROUTES.RESUME_PIPELINE,
      maxTokens: 8192,
      prompt,
      schema: SINGLE_BULLET_TOOL.input_schema as Record<string, unknown>,
    });
    if (!out?.bullets) break;

    let changed = 0;
    const usedTargets = new Set<TailoredBullet>();
    for (const cand of out.bullets) {
      const orig = targets.find((t) => t.sourceId === cand.sourceId && !usedTargets.has(t));
      const claim = claimById.get(cand.sourceId ?? '');
      if (!orig || !claim || !cand.text?.trim()) continue;
      usedTargets.add(orig);
      const text = cand.text.trim();
      if (text === orig.text) continue;
      // Acceptance: no new wrapped line + anti-fab gate + improved last-line fill.
      if (measureLineFill(text).lineCount > measureLineFill(orig.text).lineCount) continue;
      if (!bulletPasses(text, claim, jdLower)) continue;
      if (fillGoodness(text) <= fillGoodness(orig.text)) continue;
      const old = orig.text;
      orig.text = text;
      for (const entries of [doc.experience, doc.projects]) {
        for (const e of entries) {
          const bi = e.bullets.indexOf(old);
          if (bi !== -1) { e.bullets[bi] = text; }
        }
      }
      changed++;
      restored++;
    }
    if (changed === 0) break; // converged — nothing improved this pass
  }
  return { restored, attempted, passes };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function tailorResume(
  pool: CandidatePool,
  jdText: string,
  opts: { emphasis?: string[] } = {},
): Promise<TailoredResume> {
  const claimById = new Map(pool.claims.map((c) => [c.id, c]));

  // STEP A — select ids. `emphasis` (research themes, plain strings) is RANKING-ONLY;
  // it never reaches REPHRASE. tailor.ts does not import research.ts (containment).
  const { orderedIds, droppedUnknownIds } = await selectClaimIds(pool, jdText, opts.emphasis ?? []);

  // STEP A′ — DIVERSITY (B-27): drop same-entity redundant claims and RESELECT the next
  // grounded claim for that entity. Selection-level only — never merges or rewrites text.
  const diversity = await diversifySelection(orderedIds, pool, jdText);
  const orderedClaims = diversity.orderedIds.map((id) => claimById.get(id)!).filter(Boolean);

  // STEP B — rephrase the selected claims.
  const rephrased = await rephraseClaims(orderedClaims, jdText);

  // STEP B′ — line-fill optimization (length only; mutates `rephrased` to final text).
  const lineFill = await optimizeLineFill(orderedClaims, rephrased, jdText);

  // Assemble per the B-14 composition contract: fixed skeleton from vault
  // metadata; SELECT ranking fills slots only. Provenance is collected in
  // render order across both sections.
  const provenance: TailoredBullet[] = [];
  const suppressedDuplicates: TailoredBullet[] = [];
  const reserve: ReserveBullet[] = [];
  const compEntities: CompositionEntity[] = [];
  const experience = buildSectionEntries('professional', pool, orderedClaims, rephrased, provenance, suppressedDuplicates, reserve, compEntities);
  const projects = buildSectionEntries('research-project', pool, orderedClaims, rephrased, provenance, suppressedDuplicates, reserve, compEntities);

  // Loud ACTION LIST: vault metadata gaps + truthful floor deficits. Printed by
  // the pipeline runner and persisted in the composition report — never auto-fixed.
  const actionList: string[] = [];
  for (const e of compEntities) {
    if (e.missingHeaderFields.length) {
      actionList.push(
        `ACTION(vault): ${e.sourcePath} — entry "${e.entity}" missing header field(s): ${e.missingHeaderFields.join(', ')} (renders with what exists until the vault provides them)`,
      );
    }
    if (e.deficit > 0) {
      actionList.push(
        `ACTION(vault): ${e.sourcePath} — "${e.entity}" is below its bullet floor (${e.rendered}/${e.min}); vault needs ${e.deficit} more grounded claim(s) for ${entityKey(e.sourcePath)}`,
      );
    }
  }

  const resumeDoc: ResumeDoc = {
    header: { name: '', contact: [] }, // intentionally empty (no grounded source yet)
    education: [],                     // EMPTY — gap report surfaces this later
    experience,
    projects,
    additional: {},                    // EMPTY
  };

  return {
    resumeDoc,
    provenance,
    droppedUnknownIds,
    lineFill,
    selectedOrder: diversity.orderedIds, // post-diversity selection
    suppressedDuplicates,
    reserve,
    composition: { entities: compEntities, actionList },
    diversity,
    generatedAt: pool.generatedAt,
  };
}
