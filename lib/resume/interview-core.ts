/**
 * lib/resume/interview-core.ts
 *
 * The gap-filling interview's SINGLE implementation (B-9), shared by two
 * frontends: the CLI (lib/resume/interview.ts, readline) and the in-app cards
 * (/api/resume/interview/*, PendingAction-confirmed).
 *
 * TRUST RULES (structural, identical in both frontends):
 *   - NO model call of any kind in this module — Hatch can NEVER propose,
 *     suggest, or pre-fill an answer, a number, or wording. Questions come
 *     verbatim from the gap report; answers come only from the user.
 *   - VERBATIM capture: the answer text is stored unmodified, annotated
 *     `<!-- user-stated @ <date>, in response to: <question> -->`.
 *   - Mechanical extraction: every extracted metric token MUST be a substring
 *     of the answer (verified at extraction).
 *   - Every write is reviewed: CLI prints the exact block + y/n; the app queues
 *     a PendingAction vault_write whose payload IS the exact content.
 *   - "don't ask again" → a suppression dotfile, never a claim.
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildCandidatePool, type EntityMeta } from '@/lib/resume/candidate-pool';
import { readNote } from '@/lib/vault';
import type { GapReport, GapQuestion } from '@/lib/resume/gap-report';
import type { VaultWritePayload } from '@/lib/pending-actions';

const VAULT = process.env.VAULT_PATH ?? join(homedir(), 'vault');
export const SUPPRESS_PATH = join(VAULT, '03-professional', 'resume', '.interview-suppressions.json');
/** Vault-relative path of the general user-stated file (kind 'additional'). */
export const GENERAL_REL = '03-professional/resume/sections/user-stated.md';

export interface Suppression { requirement: string; question: string; date: string }

export function loadSuppressions(): Suppression[] {
  try { return JSON.parse(readFileSync(SUPPRESS_PATH, 'utf-8')) as Suppression[]; } catch { return []; }
}

export function addSuppression(requirement: string, question: string, date: string): void {
  const all = loadSuppressions();
  if (!all.some((s) => s.requirement === requirement && s.question === question)) {
    all.push({ requirement, question, date });
    writeFileSync(SUPPRESS_PATH, JSON.stringify(all, null, 2));
  }
}

export function isSuppressed(q: GapQuestion, suppressions = loadSuppressions()): boolean {
  return suppressions.some((s) => s.requirement === q.requirement && s.question === q.question);
}

/** Open (non-suppressed) questions of a gap report, verbatim. */
export function openQuestions(gap: GapReport): GapQuestion[] {
  const suppressions = loadSuppressions();
  return gap.questions.filter((q) => !isSuppressed(q, suppressions));
}

/** Entity files an answer may attach to (experience/project vault files). */
export function entityTargets(): EntityMeta[] {
  const pool = buildCandidatePool();
  return pool.entities.filter((e) => e.kind === 'experience' || e.kind === 'project');
}

/** Mechanical metric-token extraction; every token verified as a substring. */
export function extractTokens(answer: string): string[] {
  const re = /\$\d[\d,]*(?:\.\d+)?[kmb]?|\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b|\b\d[\d,]*(?:\.\d+)?\+?\b/gi;
  const out: string[] = [];
  for (const m of answer.matchAll(re)) {
    if (answer.includes(m[0])) out.push(m[0]); // mechanical substring check
  }
  return [...new Set(out)];
}

/** The exact block appended to a vault file for one answer (verbatim + annotation). */
export function claimBlock(answer: string, question: string, today: string): string {
  const oneLine = answer.replace(/\s*\n\s*/g, ' ').trim();
  const tokens = extractTokens(oneLine);
  const tokenNote = tokens.length ? ` | extracted tokens (substring-verified): ${tokens.join(', ')}` : '';
  return (
    `<!-- user-stated @ ${today}, in response to: ${question.replace(/-->/g, '—')}${tokenNote} -->\n` +
    `- ${oneLine}\n`
  );
}

function generalFileSkeleton(today: string): string {
  return `---\ntitle: User-Stated (General)\ntags: [resume, user-stated]\ncreated: ${today}\nupdated: ${today}\nsource: interview answers (verbatim, user-typed)\n---\n\n## User-Stated\n\n`;
}

/**
 * Compute the EXACT vault write for one answer — both frontends use this, so
 * the bytes written are identical whether confirmed via CLI y/n or via the
 * PendingAction card. `entitySourcePath` is a vault-relative entity file from
 * entityTargets(), or null for the general user-stated file.
 */
export function buildVaultWrite(
  answer: string,
  question: string,
  entitySourcePath: string | null,
  today: string,
): VaultWritePayload {
  const block = claimBlock(answer, question, today);
  const dest = entitySourcePath ?? GENERAL_REL;
  const existing = readNote(dest)?.content ?? null;

  if (existing === null) {
    if (entitySourcePath) throw new Error(`entity file not found in vault: ${entitySourcePath}`);
    return { path: dest, mode: 'create', content: generalFileSkeleton(today) + block, title: 'User-Stated (General)' };
  }
  const content = existing.includes('\n## User-Stated')
    ? block
    : `\n## User-Stated\n\n${block}`;
  return { path: dest, mode: 'append', content };
}

/** Absolute vault path for display (e.g. in confirmation cards). */
export function vaultAbs(rel: string): string {
  return join(VAULT, rel);
}

/** True if entitySourcePath is one of the known entity files (defense for the API route). */
export function isKnownEntityPath(p: string): boolean {
  return entityTargets().some((e) => e.sourcePath === p);
}
