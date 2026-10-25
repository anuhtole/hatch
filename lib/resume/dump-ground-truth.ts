/**
 * lib/resume/dump-ground-truth.ts
 *
 * Dev/diagnostic runner: assembles the vault ground truth and prints it as
 * pretty JSON to stdout. Run with:
 *
 *   npx tsx lib/resume/dump-ground-truth.ts
 *
 * Not imported by the app — a manual inspection tool for Phase 1.
 */

import { assembleGroundTruth } from '@/lib/resume/ground-truth';

const gt = assembleGroundTruth();

// Report any missing/errored sources to stderr so stdout stays clean JSON.
const errored = gt.records.filter((r) => r.error);
if (errored.length > 0) {
  console.error(`[dump-ground-truth] ${errored.length} source(s) had problems:`);
  for (const r of errored) console.error(`  - ${r.sourcePath}: ${r.error}`);
} else {
  console.error(`[dump-ground-truth] all ${gt.records.length} sources loaded cleanly.`);
}

console.log(JSON.stringify(gt, null, 2));
