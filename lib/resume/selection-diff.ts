/**
 * lib/resume/selection-diff.ts
 *
 * Selection-diff report (B-8): a PURELY DESCRIPTIVE side-by-side of what the
 * grounded selection did differently for two targets — which claims rendered for
 * both / only one, rank movements, coursework + skills differences, each target's
 * research themes, and each target's open gap questions.
 *
 * It reports; it NEVER recommends fabricating differentiation. If two résumés
 * come out near-identical, the diff + gap questions ARE the deliverable: they say
 * what real experience/answers would differentiate the applications.
 *
 * Run standalone:  npx tsx lib/resume/selection-diff.ts <targetA> <targetB>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { outDirFor } from '@/lib/resume/out-dir';
import type { TailoredResume } from '@/lib/resume/tailor';
import type { SectionSelection } from '@/lib/resume/tailor-sections';
import type { ResearchBrief } from '@/lib/resume/research';
import type { GapReport } from '@/lib/resume/gap-report';

interface TargetArtifacts {
  name: string;
  tailored: TailoredResume;
  selection: SectionSelection;
  brief: ResearchBrief | null;
  gap: GapReport | null;
}

function loadArtifacts(name: string): TargetArtifacts {
  const dir = outDirFor(name);
  const read = <T>(file: string): T =>
    JSON.parse(readFileSync(join(dir, file), 'utf-8')) as T;
  const readOpt = <T>(file: string): T | null =>
    existsSync(join(dir, file)) ? read<T>(file) : null;
  return {
    name,
    tailored: read<TailoredResume>('tailored.json'),
    selection: read<SectionSelection>('edu-additional-selection.json'),
    brief: readOpt<ResearchBrief>('research-brief.json'),
    gap: readOpt<GapReport>('gap-report.json'),
  };
}

const setDiff = <T>(a: T[], b: T[]) => {
  const A = new Set(a), B = new Set(b);
  return {
    both: a.filter((x) => B.has(x)),
    onlyA: a.filter((x) => !B.has(x)),
    onlyB: b.filter((x) => !A.has(x)),
  };
};

export function buildSelectionDiff(aName: string, bName: string): string {
  const A = loadArtifacts(aName);
  const B = loadArtifacts(bName);
  const L: string[] = [];
  const h = (s: string) => { L.push(`\n## ${s}\n`); };

  L.push(`# Selection Diff — ${aName} vs ${bName}`);
  L.push('');
  L.push(`> Descriptive only: this reports what the grounded selection did differently per`);
  L.push(`> target and why (which profile themes drove rank). It never proposes content.`);
  L.push(`> Near-identical résumés are an honest result — the gap questions below say what`);
  L.push(`> real experience/answers would differentiate the applications.`);

  // ── Rendered claims (post-trim provenance) ─────────────────────────────────
  const aIds = A.tailored.provenance.map((p) => p.sourceId);
  const bIds = B.tailored.provenance.map((p) => p.sourceId);
  const textOf = (t: TargetArtifacts, id: string) =>
    t.tailored.provenance.find((p) => p.sourceId === id)?.text ?? '';
  const claims = setDiff(aIds, bIds);

  h(`Rendered claims — selected for BOTH (${claims.both.length})`);
  for (const id of claims.both) L.push(`- \`${id}\``);
  h(`Only ${aName} (${claims.onlyA.length})`);
  for (const id of claims.onlyA) L.push(`- \`${id}\` — ${textOf(A, id).slice(0, 90)}`);
  h(`Only ${bName} (${claims.onlyB.length})`);
  for (const id of claims.onlyB) L.push(`- \`${id}\` — ${textOf(B, id).slice(0, 90)}`);

  // ── Rank movements among common claims (SELECT order) ─────────────────────
  h('Rank movements (common claims, SELECT order)');
  const aRank = new Map(A.tailored.selectedOrder.map((id, i) => [id, i + 1]));
  const bRank = new Map(B.tailored.selectedOrder.map((id, i) => [id, i + 1]));
  let moves = 0;
  for (const id of claims.both) {
    const ra = aRank.get(id), rb = bRank.get(id);
    if (ra && rb && ra !== rb) { L.push(`- \`${id}\`: #${ra} (${aName}) ↔ #${rb} (${bName})`); moves++; }
  }
  if (!moves) L.push('- (no rank differences among common claims)');

  // ── Education / Additional ─────────────────────────────────────────────────
  const cw = setDiff(A.selection.coursework, B.selection.coursework);
  h('Coursework selection');
  L.push(`- both: ${cw.both.join(', ') || '(none)'}`);
  L.push(`- only ${aName}: ${cw.onlyA.join(', ') || '(none)'}`);
  L.push(`- only ${bName}: ${cw.onlyB.join(', ') || '(none)'}`);
  const sk = setDiff(A.selection.skills, B.selection.skills);
  h('Skills selection');
  L.push(`- both: ${sk.both.join(', ') || '(none)'}`);
  L.push(`- only ${aName}: ${sk.onlyA.join(', ') || '(none)'}`);
  L.push(`- only ${bName}: ${sk.onlyB.join(', ') || '(none)'}`);

  // ── Research themes (what drove the rank differences) ─────────────────────
  for (const t of [A, B]) {
    h(`Top research themes — ${t.name}`);
    if (t.brief?.themes.length) for (const th of t.brief.themes.slice(0, 8)) L.push(`- ${th.theme}   ↳ ${th.sourceUrl}`);
    else L.push('- (no research brief for this run)');
  }

  // ── Open gap questions per target ──────────────────────────────────────────
  for (const t of [A, B]) {
    h(`Open gap questions — ${t.name}`);
    if (t.gap?.questions.length) for (const q of t.gap.questions) L.push(`- ${q.question}${q.source ? `   ↳ ${q.source}` : ''}`);
    else L.push('- (no gap report for this run)');
  }

  return L.join('\n') + '\n';
}

/** Build and write out/selection-diff.md; returns the path. */
export function writeSelectionDiff(aName: string, bName: string): string {
  const md = buildSelectionDiff(aName, bName);
  const path = join(homedir(), 'hatch', 'out', 'selection-diff.md');
  writeFileSync(path, md);
  return path;
}

// ── Runnable ────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes('selection-diff')) {
  const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (!a || !b) { console.error('usage: npx tsx lib/resume/selection-diff.ts <targetA> <targetB>'); process.exit(1); }
  console.log(`wrote ${writeSelectionDiff(a, b)}`);
}
