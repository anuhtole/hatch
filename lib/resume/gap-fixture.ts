/**
 * lib/resume/gap-fixture.ts
 *
 * End-to-end Phase-3d runner:
 *   read ~/hatch/test-jd.txt → buildCandidatePool → load out/tailored.json
 *   (or re-run tailorResume) → buildGapReport → write ~/hatch/out/gap-report.json.
 *   Print each requirement + coverage + note, then the open questions.
 *
 * Run with:  npx tsx lib/resume/gap-fixture.ts [--target=<name>]
 * (loads ANTHROPIC_API_KEY from .env.local / .env)
 *
 * Target mode (B-8.1): regenerates ONLY the gap stage for an existing target run —
 * profile text is re-fetched from targets/<name>.json, the tailored résumé is
 * REQUIRED from out/<name>/tailored.json (never rebuilt), research questions are
 * merged from out/<name>/research-brief.json, and the report writes back to
 * out/<name>/gap-report.json.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildCandidatePool } from '@/lib/resume/candidate-pool';
import { tailorResume, type TailoredResume } from '@/lib/resume/tailor';
import { buildGapReport, questionHasNumericToken } from '@/lib/resume/gap-report';
import { loadTargetDef, fetchTarget } from '@/lib/resume/fetch-target';
import { resolveTargetName, outDirFor } from '@/lib/resume/out-dir';
import type { ResearchBrief } from '@/lib/resume/research';

async function loadOrBuildTailored(jdText: string, pool: ReturnType<typeof buildCandidatePool>): Promise<TailoredResume> {
  const jsonPath = join(homedir(), 'hatch', 'out', 'tailored.json');
  if (existsSync(jsonPath)) {
    try {
      const t = JSON.parse(readFileSync(jsonPath, 'utf-8')) as TailoredResume;
      if (t?.provenance?.length) {
        console.log(`[gap-fixture] loaded existing tailored resume: ${jsonPath}`);
        return t;
      }
    } catch { /* fall through to re-run */ }
  }
  console.log('[gap-fixture] no usable tailored.json — re-running tailorResume');
  return tailorResume(pool, jdText);
}

async function main() {
  const target = resolveTargetName();
  const outDir = outDirFor(target);
  let jdText: string;
  let tailored: TailoredResume;
  let researchQuestions: Array<{ question: string; sourceUrl: string }> = [];
  const pool = buildCandidatePool();

  if (target) {
    const profile = await fetchTarget(loadTargetDef(target));
    jdText = profile.text;
    console.log(`[gap-fixture] target "${target}" profile: ${jdText.length} chars`);
    const tailoredPath = join(outDir, 'tailored.json');
    tailored = JSON.parse(readFileSync(tailoredPath, 'utf-8')) as TailoredResume;
    if (!tailored?.provenance?.length) throw new Error(`${tailoredPath} has no provenance — run the e2e for this target first`);
    console.log(`[gap-fixture] tailored résumé: ${tailoredPath} (${tailored.provenance.length} bullets, NOT rebuilt)`);
    const briefPath = join(outDir, 'research-brief.json');
    if (existsSync(briefPath)) {
      const brief = JSON.parse(readFileSync(briefPath, 'utf-8')) as ResearchBrief;
      researchQuestions = brief.openQuestions ?? [];
      console.log(`[gap-fixture] merging ${researchQuestions.length} research question(s) from ${briefPath}`);
    }
  } else {
    const jdPath = join(homedir(), 'hatch', 'test-jd.txt');
    jdText = readFileSync(jdPath, 'utf-8');
    console.log(`[gap-fixture] JD source: ${jdPath} (${jdText.length} chars)`);
    tailored = await loadOrBuildTailored(jdText, pool);
  }

  const report = await buildGapReport(jdText, pool, tailored, researchQuestions);

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'gap-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[gap-fixture] wrote ${outPath}\n`);

  console.log('=== JD COVERAGE ===');
  for (const it of report.items) {
    const ids = it.supportingClaimIds.length ? it.supportingClaimIds.join(', ') : '—';
    console.log(`  [${it.coverage.padEnd(6)}] ${it.requirement}`);
    console.log(`            note: ${it.note}`);
    console.log(`            supporting: ${ids}`);
  }

  console.log('\n=== OPEN QUESTIONS (WEAK/ABSENT) ===');
  for (const q of report.questions) {
    console.log(`  • (${q.requirement}) ${q.question}`);
  }

  // Deterministic anti-anchoring check: NO question may contain a numeric token.
  const offending = report.questions.filter((q) => questionHasNumericToken(q.question));
  console.log('\n=== ANTI-ANCHORING CHECK ===');
  console.log(`  questions: ${report.questions.length}`);
  console.log(`  questions with a numeric token: ${offending.length}`);
  for (const q of offending) console.log(`    ✗ ${q.question}`);

  if (offending.length > 0) {
    console.log('\n[gap-fixture] RESULT: NUMERIC QUESTION(S) PRESENT — anti-anchoring violated');
    process.exit(2);
  }
  console.log('\n[gap-fixture] RESULT: all questions open (no numeric tokens) ✓');
}

main().catch((err) => {
  console.error('[gap-fixture] failed:', err);
  process.exit(1);
});
