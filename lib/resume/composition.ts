/**
 * lib/resume/composition.ts — the COMPOSITION CONTRACT (B-14).
 *
 * Tailoring = bullet selection WITHIN a fixed structural skeleton. The skeleton
 * — which entries exist, which section each lives in, entry order, per-entry
 * bullet floors — is DETERMINISTIC, derived from vault metadata and the
 * canonical CV. The model's SELECT ranking only ever decides WHICH grounded
 * bullets fill an entry's slots; it can never delete a role, move an entry
 * across sections, or strip an entry header.
 *
 * Everything here is data + pure functions (no model, no fs beyond what callers
 * pass in) so candidate-pool, tailor, one-page, and the guards can all share it.
 */

// ── Tunables ─── EDIT TO RETAILOR ───────────────────────────────────────────────

/** Where an entry renders. Frontmatter `section:` wins; else canonical placement;
 *  else the kind default (experience → professional, project → research-project). */
export type ResumeSection = 'professional' | 'research-project' | 'education' | 'additional';

/** Canonical CV placements that differ from the kind default, keyed by entity
 *  file basename. UCSC lives under 03-professional/resume/experience/ (kind
 *  'experience') but the canonical CV renders it in Research & Project. */
export const CANONICAL_PLACEMENT: Record<string, ResumeSection> = {
  'ucsc-velasco-lab': 'research-project',
};

/** Per-entry bullet FLOORS, keyed off the canonical CV's own per-entry density
 *  (B-5 manifest: Microsoft 3, PitchBook 3, Nielsen 2, Dialpad 2, Warner Bros 2,
 *  AutoMate 2, UCSC ~2). Recent/top roles 3; older/short roles and projects 2.
 *  SELECT ranking decides WHICH grounded bullets fill the slots — never whether
 *  the slots exist. Below-floor is only ever truthful pool exhaustion (reported,
 *  never padded). */
export const ROLE_MIN_BULLETS: Record<string, number> = {
  microsoft: 3,
  pitchbook: 3,
  'spine-overview': 4, // B-24: surface banked Spine technical depth
  hatch: 3,            // B-24: surface banked Hatch technical depth
};
export const ROLE_MIN_DEFAULT = 2;

/** Research & Project entry order (canonical-first convention: active projects
 *  newest-first, then canonical projects/research). Entities not listed render
 *  after these, alphabetically. */
export const RESEARCH_PROJECT_ORDER: string[] = [
  'spine-overview',
  'hatch',
  'automate',
  'ucsc-velasco-lab',
];

/** Entry RETENTION priority (keep-first) for the one-page roster fit (B-14 part 3).
 *  When the full roster exceeds one Word page, the LOWEST-priority entries are
 *  omitted (logged, never deleted from the vault) until it fits. Render ORDER is
 *  unchanged (professional reverse-chron, research canonical) — this only decides
 *  WHICH entries survive. Keyed by entity file basename. Flagship current projects
 *  (Spine, Hatch) and the strongest/most-recent roles rank highest; oldest/weakest
 *  professional roles drop first. Entities not listed rank last (alpha). */
export const ENTRY_PRIORITY: string[] = [
  'microsoft',         // flagship PM role (AI Reviewer Agent)
  'spine-overview',    // flagship current startup (YC)
  'hatch',             // flagship current project
  'pitchbook',         // strong recent PM/consulting
  'ucsc-velasco-lab',  // research — high value for research-lab targets
  'automate',          // AI startup project
  'dialpad',           // PM internship
  'nielsen',           // PM internship (older)
  'warner-bros',       // consulting (oldest) — drops first
];

/** Retention rank (lower = keep longer). Unlisted entities sort last. */
export function priorityRank(sourcePath: string): number {
  const i = ENTRY_PRIORITY.indexOf(entityKey(sourcePath));
  return i === -1 ? ENTRY_PRIORITY.length : i;
}

/** Page-fill floor, as a fraction of the one-page BUDGET (PAGE_BUDGET — i.e. the
 *  usable page height AFTER the B-7 cross-renderer safety factor; a floor above
 *  the trim ceiling would be unsatisfiable). Under the floor → next-ranked
 *  grounded bullets are added (respecting per-role caps) until ≥ floor or the
 *  grounded pool is exhausted; exhaustion prints a truthful-underfull report —
 *  never padding, never invention. */
export const PAGE_FILL_MIN = 0.9;

// ────────────────────────────────────────────────────────────────────────────────

/** Entity key = vault file basename without .md (e.g. "microsoft", "spine-overview"). */
export function entityKey(sourcePath: string): string {
  const base = sourcePath.split('/').pop() ?? sourcePath;
  return base.replace(/\.md$/, '');
}

export function minBulletsFor(sourcePath: string): number {
  return ROLE_MIN_BULLETS[entityKey(sourcePath)] ?? ROLE_MIN_DEFAULT;
}

const VALID_SECTIONS = new Set<ResumeSection>(['professional', 'research-project', 'education', 'additional']);

/** Deterministic section assignment: frontmatter → canonical placement → kind default. */
export function sectionFor(
  sourcePath: string,
  kind: string,
  frontmatterSection?: string,
): ResumeSection {
  if (frontmatterSection && VALID_SECTIONS.has(frontmatterSection as ResumeSection)) {
    return frontmatterSection as ResumeSection;
  }
  const canonical = CANONICAL_PLACEMENT[entityKey(sourcePath)];
  if (canonical) return canonical;
  if (kind === 'experience') return 'professional';
  if (kind === 'project') return 'research-project';
  if (kind === 'education') return 'education';
  return 'additional';
}

// ── Reverse-chronological ordering for Professional Experience ─────────────────
// Periods in the vault are human strings ("Summer 2025", "Fall 2024",
// "July 2022 – August 2022", "Mar–Jun 2024"). Sort key = end of the period:
// latest year mentioned, then the latest month/season token of that year.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  // Seasons → representative end month.
  winter: 2, spring: 5, summer: 8, fall: 11, autumn: 11,
};

/** Numeric sort key for a period string (bigger = more recent). 0 = unparseable. */
export function periodSortKey(period?: string): number {
  if (!period) return 0;
  const lower = period.toLowerCase();
  const years = [...lower.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (!years.length) return 0;
  const year = Math.max(...years);
  let month = 0;
  for (const [tok, m] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${tok}\\b`).test(lower)) month = Math.max(month, m);
  }
  if (/present|current|now/.test(lower)) return (year + 1) * 100; // ongoing sorts first
  return year * 100 + month;
}

/** Order professional entries reverse-chronologically (unparseable periods last,
 *  alphabetical among themselves for determinism). */
export function compareProfessional(
  a: { sourcePath: string; period?: string },
  b: { sourcePath: string; period?: string },
): number {
  const ka = periodSortKey(a.period);
  const kb = periodSortKey(b.period);
  if (ka !== kb) return kb - ka;
  return entityKey(a.sourcePath).localeCompare(entityKey(b.sourcePath));
}

/** Order research-project entries per RESEARCH_PROJECT_ORDER (unlisted last, alpha). */
export function compareResearchProject(
  a: { sourcePath: string },
  b: { sourcePath: string },
): number {
  const ia = RESEARCH_PROJECT_ORDER.indexOf(entityKey(a.sourcePath));
  const ib = RESEARCH_PROJECT_ORDER.indexOf(entityKey(b.sourcePath));
  const ra = ia === -1 ? RESEARCH_PROJECT_ORDER.length : ia;
  const rb = ib === -1 ? RESEARCH_PROJECT_ORDER.length : ib;
  if (ra !== rb) return ra - rb;
  return entityKey(a.sourcePath).localeCompare(entityKey(b.sourcePath));
}

/** Header fields every rendered entry should carry (canonical layout). Missing
 *  fields are an ACTION-LIST item for the vault owner — the entry still renders
 *  with what exists; we never invent a role, date, or location. */
export const REQUIRED_HEADER_FIELDS = ['name', 'role', 'period', 'location'] as const;

export function missingHeaderFields(meta: {
  name?: string; role?: string; period?: string; location?: string;
}): string[] {
  return REQUIRED_HEADER_FIELDS.filter((f) => !(meta as Record<string, string | undefined>)[f]?.trim());
}
