/**
 * scripts/check-models.ts — guard:models (B-8, joins the gate).
 *
 * Asserts lib/models.ts is the ONLY file containing a hardcoded Anthropic model
 * string. Every call site must import its route (ROUTES.* / legacy MODELS.*) from
 * lib/models.ts, so rerouting is a one-file edit and no stale model id can hide
 * in a call site. Non-zero exit on any violation.
 *
 * Run: npx tsx scripts/check-models.ts  (npm run guard:models)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const REPO = join(process.env.HOME ?? '', 'hatch');
const SCAN_DIRS = ['lib', 'app', 'scripts'];
const ALLOWED = new Set(['lib/models.ts']);

// A model id inside a string literal (claude-opus-..., claude-fable-..., etc.).
// Family-anchored so product labels like claude-vision (a metadata tag in
// file-extractor) don't false-positive.
const MODEL_RE = /['"`]claude-(?:fable|opus|sonnet|haiku|instant|2|3)[a-z0-9.\-[\]]*['"`]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function main(): void {
  const violations: Array<{ file: string; line: number; match: string }> = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(REPO, dir))) {
      const rel = relative(REPO, file);
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((l, i) => {
        for (const m of l.matchAll(MODEL_RE)) {
          violations.push({ file: rel, line: i + 1, match: m[0] });
        }
      });
    }
  }
  console.log('=== MODEL ROUTING GUARD ===');
  console.log(`  hardcoded model strings outside lib/models.ts: ${violations.length}`);
  for (const v of violations) console.log(`    ✗ ${v.file}:${v.line} ${v.match}`);
  if (violations.length) { console.log('[check-models] RESULT: FAIL'); process.exit(2); }
  console.log('[check-models] RESULT: ROUTED ✓');
}

main();
