/**
 * lib/resume/one-page.ts
 *
 * Deterministic one-page budget. Estimates the rendered height of the full résumé
 * (header + 4 sections) using the B-2 width/line measure, enforces per-role bullet
 * caps from the canonical CV's own density, and — if still over a page — trims the
 * lowest-JD-ranked experience|project bullets first (never header/degrees/dates/
 * education/additional) until it fits.
 *
 * Heights are intentionally CONSERVATIVE (overestimate) so a "fits" verdict is safe.
 */

import { wrapLines, USABLE_TWIPS } from '@/lib/resume/line-width';
import type { Entry, ResumeDoc } from '@/lib/resume/render-docx';
import type { TailoredBullet, ReserveBullet, CompositionEntity } from '@/lib/resume/tailor';
import { isNearDup } from '@/lib/resume/bullet-hygiene';
import { PAGE_FILL_MIN } from '@/lib/resume/composition';

// ── Tunables ─── EDIT TO RETAILOR ───────────────────────────────────────────────
export const MAX_PAGES = 1;
const EXPERIENCE_BULLET_CAP = 6;  // canonical density: top roles ~5, older ~3
const PROJECT_BULLET_CAP = 4;     // canonical projects ~3-4
const MIN_BULLETS_PER_ENTITY = 1; // absolute floor when no composition mins given
// PAGE_FILL_MIN (0.90, composition.ts) — minimum fill as a fraction of PAGE_BUDGET.
// B-14: the page budget is calibrated to the CANONICAL CV's own measured height.
// The composition contract's role floors mandate canonical density, and the
// canonical CV — which IS exactly one physical page — sums to ≈14700tw in our
// height units (B-6 calibration; slightly above the geometric 14544tw usable
// height because the measure is deliberately conservative). Anything at or under
// the canonical's measured height therefore fits one real page. This supersedes
// the B-7 PAGE_FILL_SAFETY=0.85 headroom (12362tw), which the floors can never
// satisfy: 9 entries at their floors measure ~14580tw. Cross-renderer fidelity
// (the reason 0.85 existed — Quick Look's looser leading) is now guarded
// EMPIRICALLY by the visual gate (QL render, 0-high required) instead of blanket
// headroom: if QL clips, the run fails loudly there.
const CANONICAL_PAGE_TWIPS = 14700;
// ────────────────────────────────────────────────────────────────────────────────

const PAGE_HEIGHT = 15840;
const MARGIN_V = 720 + 576;
const USABLE_HEIGHT = PAGE_HEIGHT - MARGIN_V; // 14544 twips (geometric; pages-count display)
export const PAGE_BUDGET = CANONICAL_PAGE_TWIPS * MAX_PAGES;

// Line height (twips) for a point size at single spacing. LEADING is CALIBRATED
// against the canonical CV (B-6 audit): summing its paragraphs at leading 1.0 gives
// 14700tw vs the 14544tw usable page — and the canonical IS exactly one full page,
// so Word's effective leading is ≈0.99. The previous 1.15 guess over-estimated by
// 16% and forced a 15-bullet over-trim. We use 1.0; the word-level wrap simulation
// (never splits words) plus per-role caps provide the remaining safety margin.
const LEADING = 1.0;
const lh = (pt: number) => Math.round(pt * 20 * LEADING);
const SPACER = lh(12);
const BODY = 10.5, HEADING = 12, NAME = 28, CONTACT = 11;

function bulletHeight(text: string): number {
  return wrapLines(`● ${text}`, USABLE_TWIPS).length * lh(BODY);
}
function lineHeight(text: string, pt = BODY): number {
  return Math.max(1, wrapLines(text, USABLE_TWIPS).length) * lh(pt);
}

export interface PageEstimate { heightTwips: number; pages: number; fits: boolean; }

/** Estimate the rendered height of the assembled doc. */
export function estimateHeight(doc: ResumeDoc): PageEstimate {
  let h = 0;
  // Header
  h += lh(NAME) + lh(CONTACT) + SPACER;
  const section = (entries: Entry[]) => {
    h += SPACER + lh(HEADING) + SPACER;
    entries.forEach((e, i) => {
      if (i > 0) h += SPACER;
      // company line always; role/dates line only when the renderer emits it
      // (render-docx skips it when BOTH are empty — counting it here would be
      // phantom height, not conservatism).
      h += lh(BODY) * (e.role || e.dates ? 2 : 1);
      for (const b of e.bullets) h += bulletHeight(b);
    });
  };
  // Education
  h += SPACER + lh(HEADING) + SPACER;
  for (const ed of doc.education) {
    h += lh(BODY); // school
    if (ed.degrees) h += lh(BODY);
    if (ed.coursework) h += lineHeight(`Relevant Coursework: ${ed.coursework}`);
  }
  section(doc.experience);
  section(doc.projects);
  // Additional
  h += SPACER + lh(HEADING);
  if (doc.additional.skillsAndLanguages) h += lineHeight(`Skills & Languages: ${doc.additional.skillsAndLanguages}`);
  if (doc.additional.interests) h += lineHeight(`Interests: ${doc.additional.interests}`);

  // Pages count uses the canonical-calibrated budget (same scale as `fits`) so a
  // doc at canonical density reads as the one page it physically is.
  return { heightTwips: h, pages: Math.max(1, Math.ceil(h / PAGE_BUDGET)), fits: h <= PAGE_BUDGET };
}

// ── Trimming ────────────────────────────────────────────────────────────────────

export interface OnePageReport {
  before: PageEstimate;
  after: PageEstimate;
  trimmed: TailoredBullet[];   // bullets removed to fit (lowest-ranked first)
  perRole: Array<{ entity: string; kept: number; cap: number }>;
  // ── B-14 page-fill floor ──
  fillFraction: number;        // final height / PAGE_BUDGET
  fillFloor: number;           // PAGE_FILL_MIN
  added: TailoredBullet[];     // reserve bullets added to reach the floor
  /** Present ONLY when the grounded pool is exhausted and fill < floor — the
   *  truthful-underfull report ("vault needs more grounded claims"; never padded). */
  underfull?: {
    fillFraction: number;
    perRole: Array<{ entity: string; kept: number; cap: number; headroom: number }>;
  };
}

interface Flat { kind: 'experience' | 'project'; ei: number; text: string; sourceId: string; rank: number; }

/**
 * Enforce the one-page budget in place on `doc`, keeping `provenance` consistent.
 * `selectedOrder` (claim-id rank) decides which bullets are trimmed first. Returns
 * the trimmed bullets + per-role counts. Education/Additional/header are untouched.
 */
export function enforceOnePage(
  doc: ResumeDoc,
  provenance: TailoredBullet[],
  selectedOrder: string[],
  // B-14: composition mins protect role floors from budget trim; reserve feeds
  // the page-fill floor. Optional for legacy fixtures (falls back to B-5 behavior).
  opts: { reserve?: ReserveBullet[]; composition?: CompositionEntity[] } = {},
): OnePageReport {
  const before = estimateHeight(doc);
  const rankOf = (id: string) => {
    const i = selectedOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  // Per-entry trim floor: the composition contract's ROLE_MIN_BULLETS when
  // provided, else the legacy 1-bullet minimum.
  const minByKey = new Map<string, number>();
  for (const ce of opts.composition ?? []) minByKey.set(`${ce.kind}#${ce.ei}`, ce.min);
  const minFor = (key: string) => minByKey.get(key) ?? MIN_BULLETS_PER_ENTITY;

  // Flatten bullets in render order, zipped with provenance (same order).
  const flat: Flat[] = [];
  let p = 0;
  const collect = (entries: Entry[], kind: 'experience' | 'project') => {
    entries.forEach((e, ei) => {
      for (let bi = 0; bi < e.bullets.length; bi++) {
        const prov = provenance[p++];
        flat.push({ kind, ei, text: e.bullets[bi], sourceId: prov?.sourceId ?? '', rank: rankOf(prov?.sourceId ?? '') });
      }
    });
  };
  collect(doc.experience, 'experience');
  collect(doc.projects, 'project');

  const cap = (kind: 'experience' | 'project') => (kind === 'experience' ? EXPERIENCE_BULLET_CAP : PROJECT_BULLET_CAP);
  const keyOf = (f: Flat) => `${f.kind}#${f.ei}`;
  const removed = new Set<Flat>();
  const countLeft = (k: string) => flat.filter((f) => keyOf(f) === k && !removed.has(f)).length;

  // (1) per-role cap: drop lowest-ranked beyond the cap.
  const byRole = new Map<string, Flat[]>();
  for (const f of flat) { const k = keyOf(f); if (!byRole.has(k)) byRole.set(k, []); byRole.get(k)!.push(f); }
  for (const [, arr] of byRole) {
    const over = arr.length - cap(arr[0].kind);
    if (over > 0) {
      [...arr].sort((a, b) => b.rank - a.rank).slice(0, over).forEach((f) => removed.add(f));
    }
  }

  // (2) still over budget → trim BALANCED: take from the entity with the MOST kept
  // bullets first (its lowest-ranked one), so one strong role can't survive intact
  // while every other role is gutted to the minimum (the B-5 degenerate page:
  // 6/1/1/1/1/1/1). Ties resolve to the globally lower-ranked bullet.
  const rebuild = () => buildDoc(doc, flat, removed);
  let est = estimateHeight(rebuild());
  while (!est.fits) {
    const eligible = flat.filter((f) => !removed.has(f) && countLeft(keyOf(f)) > minFor(keyOf(f)));
    if (!eligible.length) break; // can't trim further without violating a role floor
    const maxKept = Math.max(...eligible.map((f) => countLeft(keyOf(f))));
    const candidate = eligible
      .filter((f) => countLeft(keyOf(f)) === maxKept)
      .sort((a, b) => b.rank - a.rank)[0];
    removed.add(candidate);
    est = estimateHeight(rebuild());
  }

  // (3) B-14 page-fill FLOOR: under PAGE_FILL_MIN × PAGE_BUDGET → add next
  // grounded reserve bullets (respecting per-role caps, near-dup checked, and
  // never overshooting the budget) until ≥ floor or the pool is exhausted.
  // Reserve items append at their entry's end, round-robin from the emptiest
  // eligible entry so the fill doesn't pile onto one role.
  const floorTwips = Math.round(PAGE_BUDGET * PAGE_FILL_MIN);
  const added: TailoredBullet[] = [];
  const reservePool = [...(opts.reserve ?? [])];
  est = estimateHeight(rebuild());
  while (est.heightTwips < floorTwips && reservePool.length) {
    const keptTexts = (r: ReserveBullet) =>
      flat.filter((f) => f.kind === r.kind && f.ei === r.ei && !removed.has(f)).map((f) => f.text);
    const eligible = reservePool.filter(
      (r) =>
        keptTexts(r).length < cap(r.kind) &&
        !keptTexts(r).some((t) => isNearDup(t, r.text)),
    );
    if (!eligible.length) break;
    const minKept = Math.min(...eligible.map((r) => keptTexts(r).length));
    const pick = eligible.find((r) => keptTexts(r).length === minKept)!;
    reservePool.splice(reservePool.indexOf(pick), 1);
    const f: Flat = { kind: pick.kind, ei: pick.ei, text: pick.text, sourceId: pick.sourceId, rank: Number.MAX_SAFE_INTEGER };
    flat.push(f);
    const withPick = estimateHeight(rebuild());
    if (!withPick.fits) {
      // would overshoot the budget — undo and stop (floor < budget by design)
      flat.pop();
      break;
    }
    added.push({ sourceId: pick.sourceId, text: pick.text });
    est = withPick;
  }

  // Commit: rewrite entries + provenance to survivors — in RENDER order (floor
  // fill appends to `flat` out of order, so re-walk entries deterministically).
  applyDoc(doc, flat, removed);
  provenance.length = 0;
  for (const kind of ['experience', 'project'] as const) {
    const entries = kind === 'experience' ? doc.experience : doc.projects;
    entries.forEach((_, ei) => {
      for (const f of flat) {
        if (f.kind === kind && f.ei === ei && !removed.has(f)) {
          provenance.push({ sourceId: f.sourceId, text: f.text });
        }
      }
    });
  }

  const trimmed = flat.filter((f) => removed.has(f)).map((f) => ({ sourceId: f.sourceId, text: f.text }));
  const perRoleAll = (withHeadroom: boolean) =>
    [...byRole.entries()].map(([k, arr]) => {
      const entries = arr[0].kind === 'project' ? doc.projects : doc.experience;
      const base = { entity: `${arr[0].kind}:${entries[arr[0].ei]?.company ?? k}`, kept: countLeft(k), cap: cap(arr[0].kind) };
      return withHeadroom ? { ...base, headroom: Math.max(0, base.cap - base.kept) } : base;
    });

  const after = estimateHeight(doc);
  const fillFraction = after.heightTwips / PAGE_BUDGET;
  const report: OnePageReport = {
    before,
    after,
    trimmed,
    perRole: perRoleAll(false),
    fillFraction,
    fillFloor: PAGE_FILL_MIN,
    added,
  };
  if (fillFraction < PAGE_FILL_MIN) {
    report.underfull = {
      fillFraction,
      perRole: perRoleAll(true) as Array<{ entity: string; kept: number; cap: number; headroom: number }>,
    };
  }
  return report;
}

/** Build a shallow doc copy with `removed` bullets filtered out (for estimation). */
function buildDoc(doc: ResumeDoc, flat: Flat[], removed: Set<Flat>): ResumeDoc {
  const filterEntries = (entries: Entry[], kind: 'experience' | 'project'): Entry[] =>
    entries.map((e, ei) => ({
      ...e,
      bullets: flat.filter((f) => f.kind === kind && f.ei === ei && !removed.has(f)).map((f) => f.text),
    }));
  return { ...doc, experience: filterEntries(doc.experience, 'experience'), projects: filterEntries(doc.projects, 'project') };
}

/** Apply the survivors back onto the real doc's entries in place. */
function applyDoc(doc: ResumeDoc, flat: Flat[], removed: Set<Flat>): void {
  const apply = (entries: Entry[], kind: 'experience' | 'project') =>
    entries.forEach((e, ei) => {
      e.bullets = flat.filter((f) => f.kind === kind && f.ei === ei && !removed.has(f)).map((f) => f.text);
    });
  apply(doc.experience, 'experience');
  apply(doc.projects, 'project');
}
