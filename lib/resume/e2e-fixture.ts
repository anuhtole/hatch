/**
 * lib/resume/e2e-fixture.ts — CLI frontend for the résumé pipeline.
 *
 * The pipeline itself lives in lib/resume/run-pipeline.ts (B-9): one
 * implementation shared with the in-app flow (/api/resume/run). This wrapper
 * resolves the target(s), prints every emitted line, prints the full rendered
 * artifacts after a run, and exits non-zero on the first failed stage.
 *
 * TARGET resolution (B-8):
 *   --all            → run every targets/*.json sequentially (out/<name>/ each),
 *                      then write out/selection-diff.md comparing the runs.
 *   --target=<name>  → run targets/<name>.json into out/<name>/.
 *   (neither)        → legacy single-JD mode: env ANTHROPIC_JD_URL (else the
 *                      fetch-job constant) into out/. On fetch failure for an
 *                      explicit URL: STOP — NEVER silently fall back to test-jd.txt.
 *
 * Run:  npx tsx lib/resume/e2e-fixture.ts [--all | --target=<name>] [--no-research]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  runTarget, resolveLegacyCtx, resolveTargetCtx, StageError,
  type PipelineEmit, type RunCtx,
} from '@/lib/resume/run-pipeline';
import { writeSelectionDiff } from '@/lib/resume/selection-diff';
import type { TailoredResume } from '@/lib/resume/tailor';
import type { SectionSelection } from '@/lib/resume/tailor-sections';
import type { GapReport } from '@/lib/resume/gap-report';

const emit: PipelineEmit = {
  log: (line) => console.log(`  ${line}`),
  stage: (name, status, detail) =>
    console.log(`${status === 'fail' ? '✗' : status === 'pass' ? '✓' : '…'} [${name}] ${detail ?? ''}`),
};

/** Print the full rendered artifacts (résumé text, cover letter, gap report) from out/. */
function printRunDetail(outDir: string): void {
  const tailored = JSON.parse(readFileSync(join(outDir, 'tailored.json'), 'utf-8')) as TailoredResume;
  const selection = JSON.parse(readFileSync(join(outDir, 'edu-additional-selection.json'), 'utf-8')) as SectionSelection;
  const gap = JSON.parse(readFileSync(join(outDir, 'gap-report.json'), 'utf-8')) as GapReport;
  const doc = tailored.resumeDoc;

  console.log(`\n=== RENDERED RÉSUMÉ ===`);
  const ed = doc.education[0];
  if (ed) {
    console.log(`[Education]`);
    console.log(`  ${ed.school}${ed.right ? `    ${ed.right}` : ''}`);
    console.log(`  ${ed.degrees}`);
    console.log(`  Relevant Coursework: ${ed.coursework}`);
  }
  console.log(`[Professional Experience]`);
  for (const e of doc.experience) {
    console.log(`  ${e.company} — ${e.role} (${e.dates})`);
    for (const b of e.bullets) console.log(`    ● ${b}`);
  }
  console.log(`[Research & Project Experience]`);
  for (const e of doc.projects) {
    console.log(`  ${e.company} — ${e.role} (${e.dates})`);
    for (const b of e.bullets) console.log(`    ● ${b}`);
  }
  console.log(`[Additional Information]`);
  console.log(`  Skills & Languages: ${doc.additional.skillsAndLanguages}`);
  console.log(`  Interests: ${doc.additional.interests}`);
  console.log(`  (selection: ${selection.coursework.length} courses, ${selection.skills.length} skills)`);

  console.log(`\n=== GAP REPORT ===`);
  for (const it of gap.items) console.log(`  [${it.coverage}] ${it.requirement}`);
  console.log(`  open questions:`);
  for (const q of gap.questions) console.log(`    ? ${q.question}${q.source ? `   ↳ research: ${q.source}` : ''}`);
}

async function runOne(ctx: RunCtx): Promise<void> {
  console.log(`\n${'█'.repeat(70)}\n█ TARGET: ${ctx.targetName ?? '(legacy single-JD)'} → ${ctx.outDir}\n${'█'.repeat(70)}`);
  const result = await runTarget(ctx, emit);
  printRunDetail(result.outDir);
  console.log(`\n[e2e] TARGET ${ctx.targetName ?? '(legacy)'} RESULT: CLEAN ✓ — all stages passed, all guards 0.`);
  console.log(`[e2e] docx: ${result.docxPath} (${result.docxBytes} bytes) · png: ${result.pngPath}`);
}

async function main() {
  if (process.argv.includes('--all')) {
    const targetsDir = join(homedir(), 'hatch', 'targets');
    const names = readdirSync(targetsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    if (names.length === 0) throw new StageError('targets', 'no targets/*.json found');
    console.log(`[e2e] --all: running targets in sequence: ${names.join(', ')}`);
    for (const name of names) await runOne(await resolveTargetCtx(name));
    if (names.length >= 2) {
      const diffPath = writeSelectionDiff(names[0], names[1]);
      console.log(`\n[e2e] selection-diff (${names[0]} vs ${names[1]}): ${diffPath}`);
      console.log(readFileSync(diffPath, 'utf-8'));
    }
    console.log(`\n[e2e] ALL TARGETS CLEAN ✓`);
    return;
  }
  const targetFlag = process.argv.find((a) => a.startsWith('--target='));
  const target = targetFlag ? targetFlag.slice('--target='.length) : process.env.RESUME_TARGET || null;
  if (target) {
    await runOne(await resolveTargetCtx(target));
    return;
  }
  await runOne(await resolveLegacyCtx());
}

main().catch((err) => {
  if (err instanceof StageError) {
    console.error(`\n[e2e] STAGE FAILED: ${err.stage}\n${err.detail}`);
  } else {
    console.error('[e2e] UNCAUGHT failure:', err);
  }
  process.exit(1);
});
