/**
 * lib/resume/cover-fixture.ts
 *
 * End-to-end cover-letter runner:
 *   read ~/hatch/test-jd.txt → load ~/hatch/out/tailored.json + rebuild pool →
 *   generateCoverLetter (per-sentence provenance) → write ~/hatch/out/cover-letter.docx
 *   → run the drift guard + numeric guard → print the letter (with per-sentence
 *   sourceIds) and every flag.
 *
 * Run with:  npx tsx lib/resume/cover-fixture.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildCandidatePool } from '@/lib/resume/candidate-pool';
import { generateCoverLetter, checkCoverLetterNumbers } from '@/lib/resume/cover-letter';
import { checkCoverLetterDrift, companyFromGreeting } from '@/lib/resume/check-cover-letter';
import type { TailoredResume } from '@/lib/resume/tailor';

async function main() {
  const jdText = readFileSync(join(homedir(), 'hatch', 'test-jd.txt'), 'utf-8');
  const tailored = JSON.parse(
    readFileSync(join(homedir(), 'hatch', 'out', 'tailored.json'), 'utf-8'),
  ) as TailoredResume;
  const pool = buildCandidatePool();
  console.log(`[cover-fixture] tailored: ${tailored.provenance.length} verified bullets; pool: ${pool.claims.length} claims`);

  const letter = await generateCoverLetter(tailored, jdText);
  console.log(`[cover-fixture] wrote ${letter.docxPath}\n`);

  console.log('=== COVER LETTER (per-sentence provenance) ===\n');
  console.log(letter.greeting + '\n');
  for (const s of letter.sentences) {
    const cite = s.sourceIds.length ? s.sourceIds.join(', ') : '(connective)';
    console.log(`  • ${s.text}\n      ↳ ${cite}`);
  }
  console.log('\n  Sincerely,\n  Anatole Palmer Seychal');

  // ── Drift guard ──────────────────────────────────────────────────────────────
  const drift = checkCoverLetterDrift(letter.sentences, tailored, pool, jdText, companyFromGreeting(letter.greeting));
  console.log(`\n=== DRIFT GUARD ===`);
  console.log(`  sentences: ${drift.sentenceCount} | flags: ${drift.flags.length} | warnings(exempt): ${drift.warnings.length}`);
  for (const w of drift.warnings) console.log(`    ⚠ WARN (target-naming, exempt) "${w.term}"`);
  for (const f of drift.flags) {
    console.log(`    ✗ [${f.category}] "${f.term}"  (cited: ${f.sourceIds.join(', ') || 'none'})`);
    console.log(`        sentence: ${f.sentence}`);
  }

  // ── Numeric guard ────────────────────────────────────────────────────────────
  const numChk = checkCoverLetterNumbers(letter.text, letter.provenance);
  console.log(`\n=== NUMERIC GUARD ===`);
  console.log(`  body numbers: ${numChk.bodyNumbers.join(', ') || '(none)'} | violations: ${numChk.violations.length}`);
  for (const v of numChk.violations) console.log(`    ✗ ${v}`);

  const ok = drift.flags.length === 0 && numChk.violations.length === 0;
  console.log(`\n[cover-fixture] RESULT: ${ok ? 'CLEAN ✓ (0 drift, 0 numeric)' : 'FLAGS PRESENT — do not commit'}`);
  if (!ok) process.exit(2);
}

main().catch((err) => {
  console.error('[cover-fixture] failed:', err);
  process.exit(1);
});
