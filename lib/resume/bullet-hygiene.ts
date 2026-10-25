/**
 * lib/resume/bullet-hygiene.ts
 *
 * Structural noise predicate + near-duplicate detection for experience|project
 * claims — the SELECT-catalog analog of the education listItem filter, shared so
 * the catalog and the guards cannot diverge.
 *
 * NOISE (excluded from the SELECT catalog): prose lead-ins, HTML comments,
 * frontmatter-key leak, blockquote/redirect lines, markdown bold-only headers,
 * colon-terminated lead-ins, and role-restatement sections (a claim that just
 * restates the title, e.g. "Product Manager Intern on the Power Apps team").
 *
 * NEAR-DUP: two claims of the SAME role whose token overlap exceeds a threshold
 * (e.g. the two Hatch "30 model-callable tools" bullets) — suppressed at SELECT
 * time, keeping the higher-ranked one.
 */

import type { Claim } from '@/lib/resume/candidate-pool';

// Sections whose claims merely restate the role/title or tag skills — not
// accomplishments. 'Skills Developed'/'Skills Demonstrated' entries are grounded
// noun-phrase tags ("Multi-agent AI product design") that read as fragments when
// rendered as bullets; they stay in the pool (guards may cite them) but are
// excluded from the SELECT catalog.
const NOISE_SECTIONS = new Set([
  'role', 'reflections', 'my role', 'my-role',
  'skills developed', 'skills demonstrated',
]);

// Meta / instructional prose lead-ins (B-16). A flat dump like
// "Spine Shipped Features.md" mixes real feature bullets with chat preamble and
// résumé-writing ADVICE ("Here are the shipped features…", "For a security role:
// lead with…", "If you're picking 8–12 bullets…"). These openers never head a real
// accomplishment, so they are structural noise — excluded from the SELECT catalog.
const ADVICE_LEAD_RE =
  /^(here are\b|here's\b|i've grouped|i have grouped|you can pick|if you'?re\b|for an? .*\brole\b|pick the\b|lead with\b|each bullet is\b|these are written\b)/i;

/** True if a claim is structural NOISE and must not enter the SELECT catalog. */
export function isNoiseClaim(c: Claim): boolean {
  const t = c.text.trim();
  if (!t) return true;
  if (/^<!--/.test(t)) return true;                       // HTML comment
  if (/^>/.test(t)) return true;                          // blockquote / redirect line
  if (/^(title|tags|created|updated|status|stack|aliases|co-founder)\s*:/i.test(t)) return true; // frontmatter leak
  if (/^\*\*.+\*\*$/.test(t)) return true;                // bold-only header ("**Mode 1 —**")
  if (/:\s*$/.test(t)) return true;                       // colon-terminated lead-in ("Use cases:")
  if (/^\[\[.*\]\]$/.test(t)) return true;                // wikilink-only
  if (ADVICE_LEAD_RE.test(t)) return true;                // meta / résumé-writing advice (B-16)
  if (NOISE_SECTIONS.has(c.section.trim().toLowerCase())) return true; // role-restatement section
  if (/^status\b/.test(c.section.trim().toLowerCase())) return true; // B-32: project Status sections are state statements, not accomplishment bullets — excluded from SELECT catalog (drop-only; H3 fix, B-31)
  return false;
}

/** Selectable iff experience|project AND not noise. */
export function isSelectableClaim(c: Claim): boolean {
  if (c.kind !== 'experience' && c.kind !== 'project') return false;
  return !isNoiseClaim(c);
}

// ── Near-duplicate detection ────────────────────────────────────────────────────

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2),
  );
}

/**
 * Overlap coefficient (|A∩B| / min(|A|,|B|)). Guarded by a minimum token count so
 * short claims (where a tiny intersection trivially hits 1.0) don't false-positive.
 */
export function overlap(a: string, b: string, minTokens = 6): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size < minTokens || B.size < minTokens) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

export const NEAR_DUP_THRESHOLD = 0.7;

export function isNearDup(a: string, b: string): boolean {
  return overlap(a, b) >= NEAR_DUP_THRESHOLD;
}

// ── Bullet quality rubric (B-6) ─────────────────────────────────────────────────
// Deterministic, heuristic scoring of a RENDERED bullet — diagnostic only (reported
// in line-fill-report.json), never a content gate. Each criterion is boolean:
//   a strongVerb  — leads with an action verb (past-tense or known strong form)
//   b keptMetric  — if the source claim carries metrics, the bullet keeps a number
//   c oneIdea     — not an over-packed compound (≤30 words, no semicolons)
//   d noSiblingDup— no ≥0.5 overlap with another bullet of the same entity
//   e (JD-rank and f line-fill live with the caller, which has that context)

const STRONG_VERBS = new Set([
  'led', 'built', 'designed', 'architected', 'presented', 'conducted', 'integrated',
  'developed', 'drove', 'created', 'launched', 'shipped', 'implemented', 'exposed',
  'achieved', 'mapped', 'co-founded', 'cofounded', 'refined', 'managed', 'spearheaded',
  'organized', 'cleaned', 'submitted', 'identified', 'worked', 'modeled', 'authored',
  'enforced', 'made', 'established', 'delivered', 'reduced', 'increased', 'improved',
  'optimized', 'owned', 'defined', 'analyzed', 'coordinated', 'secured', 'automated',
  'streamlined', 'redesigned', 'restructured', 'ran', 'won', 'wrote', 'entirely',
]);

// B-15: throat-clearing / filler lead-ins. A bullet that opens with one of these
// buries the substance behind a weak verb ("Responsible for…", "Worked on…",
// "Helped…"). Deterministic, leading-phrase only — the REPHRASE prompt carries the
// generative rule; this scores compliance into the line-fill report.
const FILLER_LEAD_RE =
  /^(responsible for|responsibilities|responsible|worked on|worked with|helped|assisted|involved in|involved|tasked with|duties included|in charge of|participated in|contributed to|successfully|various|several|utilized)\b/i;

export interface BulletRubric {
  strongVerb: boolean;
  keptMetric: boolean;
  oneIdea: boolean;
  noSiblingDup: boolean;
  noFiller: boolean; // B-15: does not open with throat-clearing / filler
}

export function scoreBullet(
  text: string,
  sourceMetricCount: number,
  siblingTexts: string[],
): BulletRubric {
  const trimmed = text.trim();
  const first = (trimmed.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z-]/g, '');
  return {
    strongVerb: STRONG_VERBS.has(first) || /ed$/.test(first),
    keptMetric: sourceMetricCount === 0 || /\d/.test(text),
    oneIdea: text.split(/\s+/).length <= 30 && !/;/.test(text),
    noSiblingDup: !siblingTexts.some((s) => overlap(s, text) >= 0.5),
    noFiller: !FILLER_LEAD_RE.test(trimmed),
  };
}
