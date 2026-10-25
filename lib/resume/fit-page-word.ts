/**
 * lib/resume/fit-page-word.ts — Word-authoritative one-page roster fit (B-14 part 3).
 *
 * The composition contract wants every vault entry on one page, but a 9-entry
 * roster + Skills/Interests exceeds one Word page even at the 2-bullet floor
 * (the canonical CV has 7 entries). So when the full roster overflows, the
 * LOWEST-priority entries are OMITTED (logged, never deleted from the vault),
 * and the page is then re-filled with grounded bullets up to the per-role caps —
 * all measured against the real Word render (the shipped PDF's pagination),
 * never an internal estimate that disagrees with Word.
 *
 * Render ORDER is untouched (professional reverse-chron, research canonical);
 * priority only decides which entries SURVIVE. Bullets only ever come from the
 * grounded pool/reserve — nothing is invented; an omitted entry is reported.
 */

import type { ResumeDoc, Entry } from '@/lib/resume/render-docx';
import type { TailoredBullet, ReserveBullet, CompositionEntity } from '@/lib/resume/tailor';
import { priorityRank } from '@/lib/resume/composition';

const EXPERIENCE_CAP = 6;
const PROJECT_CAP = 6; // B-24: raised 4→6 to let project depth (Spine/Hatch) surface
const MAX_WORD_MEASURES = 40; // safety backstop on Word round-trips

interface PoolItem { text: string; sourceId: string }
interface WorkEntry {
  sourcePath: string;
  entity: string;
  kind: 'experience' | 'project';
  ei: number;
  pool: PoolItem[];   // ordered: rendered (rank) bullets ++ reserve (rank)
  floor: number;
  cap: number;
  kept: number;       // bullets currently shown (>= floor unless pool smaller)
  dropped: boolean;
  frozen: boolean;    // its next bullet overflowed — stop trying to grow it
}

export interface RosterFitReport {
  finalPages: number;
  measures: number;
  kept: Array<{ entity: string; section: string; bullets: number; floor: number }>;
  dropped: Array<{ entity: string; section: string }>;
  filledBack: number;
}

/** Build a doc from the working set: non-dropped entries in original order, each
 *  showing its first `kept` pool bullets; header fields kept from the source doc. */
function buildDoc(base: ResumeDoc, work: WorkEntry[]): ResumeDoc {
  const pick = (kind: 'experience' | 'project', src: Entry[]): Entry[] =>
    work
      .filter((w) => w.kind === kind && !w.dropped)
      .sort((a, b) => a.ei - b.ei)
      .map((w) => ({ ...src[w.ei], bullets: w.pool.slice(0, w.kept).map((p) => p.text) }));
  return { ...base, experience: pick('experience', base.experience), projects: pick('project', base.projects) };
}

export async function fitToOnePageWord(
  doc: ResumeDoc,
  provenance: TailoredBullet[],
  composition: CompositionEntity[],
  reserve: ReserveBullet[],
  render: (d: ResumeDoc) => Promise<Buffer>,
  measurePages: (buf: Buffer) => number,
  log: (s: string) => void,
): Promise<RosterFitReport> {
  // Per-entry ordered bullet pool. The doc's current bullets (in render order)
  // line up 1:1 with `provenance`, so we consume provenance sequentially to tag
  // each rendered bullet with its sourceId, then append this entry's reserve.
  let p = 0;
  const work: WorkEntry[] = [];
  const sections: Array<['experience' | 'project', Entry[]]> = [
    ['experience', doc.experience],
    ['project', doc.projects],
  ];
  for (const [kind, entries] of sections) {
    entries.forEach((e, ei) => {
      const comp = composition.find((c) => c.kind === kind && c.ei === ei);
      const pool: PoolItem[] = [];
      for (let i = 0; i < e.bullets.length; i++) {
        pool.push({ text: e.bullets[i], sourceId: provenance[p]?.sourceId ?? '' });
        p++;
      }
      for (const r of reserve) if (r.kind === kind && r.ei === ei) pool.push({ text: r.text, sourceId: r.sourceId });
      work.push({
        sourcePath: comp?.sourcePath ?? '',
        entity: e.company,
        kind, ei, pool,
        floor: comp?.min ?? 2,
        cap: kind === 'project' ? PROJECT_CAP : EXPERIENCE_CAP,
        kept: Math.min(comp?.min ?? 2, e.bullets.length),
        dropped: false,
        frozen: false,
      });
    });
  }

  let measures = 0;
  const pagesOf = async (): Promise<number> => {
    if (measures >= MAX_WORD_MEASURES) throw new Error('fit-page-word: exceeded Word measure budget — aborting');
    measures++;
    return measurePages(await render(buildDoc(doc, work)));
  };

  // 1. Start at floors. Measure.
  let pages = await pagesOf();
  log(`roster-fit: floors → ${pages} Word page(s) (${work.filter((w) => !w.dropped).length} entries)`);

  // 2. Drop lowest-priority entries until it fits (keep ≥1 entry).
  while (pages > 1) {
    const candidates = work.filter((w) => !w.dropped);
    if (candidates.length <= 1) break;
    const victim = candidates.sort((a, b) => priorityRank(b.sourcePath) - priorityRank(a.sourcePath))[0];
    victim.dropped = true;
    log(`roster-fit: dropping lowest-priority entry "${victim.entity}" (${victim.kind})`);
    pages = await pagesOf();
  }

  // 3. Page-fill: balance-add grounded bullets to kept entries until the next
  //    add would overflow one Word page (each add Word-verified). Prefer the
  //    emptiest growable entry; freeze an entry whose next bullet overflows.
  let filledBack = 0;
  let lastGrown: WorkEntry | null = null;
  if (pages === 1) {
    for (;;) {
      const growable = work.filter((w) => !w.dropped && !w.frozen && w.kept < Math.min(w.cap, w.pool.length));
      if (!growable.length) break;
      const target = growable.sort(
        (a, b) => a.kept - b.kept || priorityRank(a.sourcePath) - priorityRank(b.sourcePath),
      )[0];
      target.kept++;
      const after = await pagesOf();
      if (after > 1) { target.kept--; target.frozen = true; } // would overflow → revert + freeze
      else { filledBack++; pages = after; lastGrown = target; }
    }
    // B-16 bottom-margin reserve: the fill loop packs content to the exact 1-page
    // limit, which can leave the last line flush against the bottom edge (the
    // visual gate flags "no bottom margin / content cut off"). Undo the final
    // fill-back add so a visible margin remains. Floors are untouched — every
    // fill-back add is above the role floor, so backing one off keeps kept ≥ floor.
    if (lastGrown && filledBack > 0) { lastGrown.kept--; filledBack--; }
  }

  // 4. Commit: apply the fitted working set onto `doc`, rebuild provenance in
  //    render order from survivors.
  const fitted = buildDoc(doc, work);
  doc.experience = fitted.experience;
  doc.projects = fitted.projects;
  provenance.length = 0;
  for (const kind of ['experience', 'project'] as const) {
    for (const w of work.filter((x) => x.kind === kind && !x.dropped).sort((a, b) => a.ei - b.ei)) {
      for (const item of w.pool.slice(0, w.kept)) provenance.push({ sourceId: item.sourceId, text: item.text });
    }
  }

  return {
    finalPages: pages,
    measures,
    kept: work.filter((w) => !w.dropped).map((w) => ({ entity: w.entity, section: w.kind, bullets: w.kept, floor: w.floor })),
    dropped: work.filter((w) => w.dropped).map((w) => ({ entity: w.entity, section: w.kind })),
    filledBack,
  };
}
