/**
 * lib/resume/interview.ts  (npm run resume:interview [--target=<name>])
 *
 * CLI frontend of the gap-filling interview. The implementation lives in
 * lib/resume/interview-core.ts (B-9) and is shared with the in-app interview
 * cards — same verbatim-capture rules, same claim block, same vault-write
 * payload, same suppressions file. This frontend adds only: readline prompts,
 * the printed exact-block + y/n confirmation, and the optional pipeline re-run.
 *
 * TRUST: no model call anywhere in the interview (core or frontends) — Hatch
 * never proposes, suggests, or pre-fills an answer, a number, or wording.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { spawnSync } from 'child_process';
import type { GapReport } from '@/lib/resume/gap-report';
import { resolveOutDir } from '@/lib/resume/out-dir';
import { executePendingAction } from '@/lib/pending-actions';
import {
  openQuestions, entityTargets, addSuppression, buildVaultWrite, vaultAbs,
} from '@/lib/resume/interview-core';

const GAP_PATH = join(resolveOutDir(), 'gap-report.json');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  if (!existsSync(GAP_PATH)) {
    console.error(`[interview] no gap report at ${GAP_PATH} — run \`npm run resume:e2e\` first.`);
    process.exit(1);
  }
  const gap = JSON.parse(readFileSync(GAP_PATH, 'utf-8')) as GapReport;
  const targets = entityTargets();
  const open = openQuestions(gap);

  console.log(`\nGap-filling interview — ${open.length} open question(s) (${gap.questions.length - open.length} suppressed).`);
  console.log(`Answers are stored VERBATIM in your vault as grounded claims. Hatch never`);
  console.log(`proposes or pre-fills an answer — type your own words. Commands: your answer,`);
  console.log(`"skip" (ask again next time), or "na" (don't ask again).\n`);

  let written = 0;
  for (const [i, q] of open.entries()) {
    console.log(`\n[${i + 1}/${open.length}] (${q.requirement})${q.source ? `  ↳ research: ${q.source}` : ''}`);
    console.log(`  ${q.question}`);
    const answer = await ask('> ');
    if (!answer || answer.toLowerCase() === 'skip') continue;
    if (answer.toLowerCase() === 'na' || answer.toLowerCase() === 'n/a') {
      addSuppression(q.requirement, q.question, today);
      console.log('  recorded: don\'t ask again (suppression, not a claim).');
      continue;
    }

    // Pick the entity this fact belongs to.
    console.log('  Where does this belong?');
    targets.forEach((t, ti) => console.log(`    ${ti + 1}. ${t.name}  (${t.kind} — ${t.sourcePath})`));
    console.log(`    0. general (sections/user-stated.md — context only, never a résumé bullet)`);
    const pick = parseInt(await ask('  target #: '), 10);
    const target = Number.isInteger(pick) && pick >= 1 && pick <= targets.length ? targets[pick - 1] : null;

    const payload = buildVaultWrite(answer, q.question, target?.sourcePath ?? null, today);
    console.log(`\n  WILL WRITE to ${vaultAbs(payload.path)} (${payload.mode}):`);
    console.log(payload.content.split('\n').map((l) => `    │ ${l}`).join('\n'));
    const ok = (await ask('  confirm write? (y/n): ')).toLowerCase();
    if (ok !== 'y' && ok !== 'yes') { console.log('  not written.'); continue; }

    // Same executor as approved PendingActions: path-escape defense + audit log.
    const outcome = await executePendingAction('vault_write', payload);
    written++;
    console.log(`  ✓ ${outcome}`);
  }

  console.log(`\n[interview] done — ${written} claim(s) written.`);
  if (written > 0) {
    const rerun = (await ask('Re-run the full pipeline now so the new claims are used? (y/n): ')).toLowerCase();
    if (rerun === 'y' || rerun === 'yes') {
      rl.close();
      const r = spawnSync('npm', ['run', 'resume:e2e'], { stdio: 'inherit', cwd: join(homedir(), 'hatch') });
      process.exit(r.status ?? 0);
    }
    console.log('New claims flow through ALL existing guards on the next `npm run resume:e2e`.');
  }
  rl.close();
}

main().catch((e) => { console.error('[interview] failed:', e); process.exit(1); });
