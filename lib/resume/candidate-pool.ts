/**
 * lib/resume/candidate-pool.ts
 *
 * Phase 3a of the vault-grounded resume builder: the DETERMINISTIC candidate
 * pool — the structural backbone of anti-fabrication.
 *
 * Pure transformation of the Phase-1 ground truth into selectable units:
 *   - one EntityMeta per role/project (header facts from frontmatter)
 *   - one Claim per bullet / substantive line, with VERBATIM text and the
 *     quantitative tokens extracted from it
 *
 * No LLM, no network, no JD, no selection, no UI. The next sub-phase may draw
 * resume content ONLY from this pool, and the extracted `metrics` tokens become
 * the allow-list the verification pass checks generated numbers against. So we
 * index exactly what's literally in the vault — never invent, normalize, or
 * rephrase — and when a metric is ambiguous we OVER-capture (widening the
 * allow-list is safe; narrowing it is not).
 *
 * Additive only — touches no existing code and is not wired into any pipeline.
 */

import { basename } from 'path';
import { assembleGroundTruth, type SourceRecord, type SourceKind } from '@/lib/resume/ground-truth';
import { sectionFor, type ResumeSection } from '@/lib/resume/composition';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EntityMeta {
  sourcePath: string;    // the PRIMARY file's path (header facts come from here)
  /** B-16: entity identity key. Project files in the SAME folder (e.g. both
   *  04-projects/spine/*.md) share one groupKey → one rendered entry; everything
   *  else is per-file. Claims attach to an entity by groupKey, not sourcePath. */
  groupKey: string;
  kind: SourceKind;
  /** B-14 composition contract: which résumé section this entry renders in.
   *  Deterministic — frontmatter `section:` → canonical placement → kind default.
   *  NEVER model-decided. */
  section: ResumeSection;
  name: string;          // frontmatter title, else role, else filename
  role?: string;
  period?: string;
  location?: string;
  type?: string;
}

export interface Claim {
  id: string;            // stable: slug(relative-vault-path)#slug(section)#index
  sourcePath: string;
  groupKey: string;      // B-16: the owning entity's groupKey (folder-merged for projects)
  kind: SourceKind;
  entity: string;        // owning company/project name
  section: string;       // section heading the claim sits under
  text: string;          // VERBATIM bullet/claim text from the vault
  metrics: string[];     // quantitative tokens extracted from text
  listItem: boolean;     // true ⇢ came from a markdown list item ("- "/"* "/"● ").
                         // Structural signal: education/additional NON-list lines are
                         // prose lead-ins / HTML comments (noise), never real members.
}

export interface CandidatePool {
  entities: EntityMeta[];
  claims: Claim[];
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

/**
 * Deterministic quantitative-token extraction. Alternation is ordered
 * most-specific-first so each position is consumed once (JS picks the first
 * matching alternative at a given index, not the longest overall):
 *   1. currency     — $10k, $1.2M, $1,000
 *   2. percentage   — 40%, 24%
 *   3. multiplier   — 3x, 10X
 *   4. magnitude+   — 200+, 10+, 1.5M+, 5000+
 *   5. comma-group  — 200,000, 214,000, 1,000
 *   6. plain number — 6, 4, 10, 1.5, 14 (unit-tied counts/magnitudes)
 * Bare 4-digit years (1900–2099) are dropped — they're dates, not metrics
 * (date ranges like "June 2025 – August 2025" never become metrics).
 */
const METRIC_RE =
  /\$\d[\d,]*(?:\.\d+)?[kmb]?|\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b|\b\d[\d,]*(?:\.\d+)?[kmb]?\+|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?[kmb]?\b/gi;

const MONTH_BEFORE_RE =
  /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+$/i;

/**
 * Strict metric extraction (Phase-4 hardening). Strong metrics — currency,
 * percentage, multiplier, magnitude-with-"+", comma-groups, and k/m/b-suffixed
 * magnitudes — are always kept. A *bare* plain integer/decimal is kept ONLY when
 * it's a real, unit-attached count; the noise classes are dropped so a fabricated
 * bare number can't slip through just because noise widened the allow-list:
 *   - numbers inside [[wikilinks]] (e.g. [[05-people/…]])
 *   - leading-zero integers (05, 04, 007)
 *   - "Mode N" labels
 *   - calendar days (month-preceded, e.g. "May 14") and bare day-counts ("2 days")
 *   - unit-less bare integers (not followed by a unit word)
 * Bare 4-digit years are dropped as before.
 */
function extractMetrics(text: string): string[] {
  // Spans of [[wikilinks]] so we can exclude numbers living inside a link path.
  const linkSpans: Array<[number, number]> = [];
  for (const w of text.matchAll(/\[\[[^\]]*\]\]/g)) {
    linkSpans.push([w.index ?? 0, (w.index ?? 0) + w[0].length]);
  }
  const inLink = (i: number) => linkSpans.some(([s, e]) => i >= s && i < e);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(METRIC_RE)) {
    const tok = m[0];
    const i = m.index ?? 0;

    if (/^(?:19|20)\d{2}$/.test(tok)) continue; // bare year → date, not a metric

    // Strong metric? (carries $ % , + or a k/m/b/x suffix) → always keep.
    const strong = /[$%,+]/.test(tok) || /[kmbx]$/i.test(tok);
    if (!strong) {
      if (inLink(i)) continue;                 // [[05-…]]
      if (/^0\d/.test(tok)) continue;          // leading-zero noise (05, 04, 007)
      const before = text.slice(Math.max(0, i - 12), i);
      if (/mode\s*\**\s*$/i.test(before)) continue;   // "Mode 1", "Mode 2"
      if (MONTH_BEFORE_RE.test(before)) continue;     // calendar day ("May 14")
      const after = text.slice(i + tok.length, i + tok.length + 14);
      if (/^[-\s]?days?\b/i.test(after)) continue;    // bare day-count ("2 days")
      if (!/^[-\s]?[A-Za-z]/.test(after)) continue;   // unit-less (no unit word follows)
    }

    if (!seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

/** True for blank lines and pure table-separator / horizontal-rule lines. */
function isNonSubstantive(line: string): boolean {
  if (!line) return true;
  // e.g. "---", "***", "|---|---|", ":-:" — only rule/separator punctuation
  return /^[|:\-\s*]+$/.test(line) && /[-*|]/.test(line);
}

function extractClaims(record: SourceRecord, entity: string, groupKey: string): Claim[] {
  const claims: Claim[] = [];
  // Path-based (not basename) so files sharing a basename (e.g. two automate.md
  // in different dirs) get distinct ids and can never collide.
  const fileSlug = slug(record.sourcePath.replace(/\.md$/i, ''));

  for (const section of record.sections) {
    const secSlug = slug(section.heading);
    let idx = 0;
    let inFence = false;

    for (const rawLine of section.text.split('\n')) {
      const line = rawLine.trim();

      if (/^(?:```|~~~)/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      if (isNonSubstantive(line)) continue;

      // List item (-, *, ●) → strip the marker; else the whole line is the claim.
      const listMatch = /^[-*●]\s+(.*)$/.exec(line);
      const text = (listMatch ? listMatch[1] : line).trim();
      if (!text) continue;

      claims.push({
        id: `${fileSlug}#${secSlug}#${idx}`,
        sourcePath: record.sourcePath,
        groupKey,
        kind: record.kind,
        entity,
        section: section.heading,
        text,
        metrics: extractMetrics(text),
        listItem: listMatch !== null,
      });
      idx++;
    }
  }

  return claims;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the deterministic, provenance-tagged candidate pool from the vault
 * ground truth. Errored/missing source records contribute nothing (they have
 * no selectable content). Education / Languages / Interests / curated Skills
 * are not in the grounded files yet, so they correctly do NOT appear — the
 * later gap-report surfaces that; we never synthesize them here.
 */
/** B-16 entity identity: project files in the SAME folder merge into one entity
 *  (e.g. 04-projects/spine/spine-overview.md + .../Spine Shipped Features.md →
 *  "04-projects/spine"). Everything else is keyed per-file (its own path). */
function groupKeyOf(record: SourceRecord): string {
  const parts = record.sourcePath.split('/');
  if (record.kind === 'project' && parts.length >= 3 && parts[0] === '04-projects') {
    return `${parts[0]}/${parts[1]}`;
  }
  return record.sourcePath;
}

/** The PRIMARY record of a group supplies the entity header facts: the file with a
 *  frontmatter `title` wins (deterministic by sorted path), else the first file.
 *  So a folder's frontmatter-less feature dump contributes CLAIMS but never the
 *  entry's name/role/dates — those stay grounded in the curated file. */
function primaryOf(group: SourceRecord[]): SourceRecord {
  const sorted = [...group].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return sorted.find((r) => str(r.frontmatter.title)) ?? sorted[0];
}

export function buildCandidatePool(): CandidatePool {
  const gt = assembleGroundTruth();
  const entities: EntityMeta[] = [];
  const claims: Claim[] = [];

  // Group the usable records by entity key (folder-merged for projects), keeping
  // first-seen order so ids and entity order stay deterministic.
  const groups = new Map<string, SourceRecord[]>();
  for (const record of gt.records) {
    if (record.error) continue;
    if (record.kind === 'contact') continue; // header metadata, not selectable claims
    const key = groupKeyOf(record);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(record);
  }

  for (const [groupKey, group] of groups) {
    const primary = primaryOf(group);
    const fm = primary.frontmatter;
    const name = str(fm.title) ?? str(fm.role) ?? basename(primary.sourcePath, '.md');

    entities.push({
      sourcePath: primary.sourcePath,
      groupKey,
      kind: primary.kind,
      section: sectionFor(primary.sourcePath, primary.kind, str(fm.section)),
      name,
      role: str(fm.role),
      period: str(fm.period),
      location: str(fm.location),
      type: str(fm.type),
    });

    // Every file in the group contributes claims, all attributed to the entity
    // name + groupKey (so SELECT can choose the richest across files; assembly
    // matches them to the single entry by groupKey).
    for (const record of group) claims.push(...extractClaims(record, name, groupKey));
  }

  return { entities, claims, generatedAt: gt.generatedAt };
}
