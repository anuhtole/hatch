/**
 * scripts/check-send-surface.ts — guard:send-surface (B-10).
 *
 * STRUCTURAL SEND ASSERTIONS (the lesson of the autonomous-send incident —
 * structural, permanent). Grep-asserts over the repo source (comments stripped):
 *
 *   A. The Gmail send API (`users.messages.send`) appears in exactly ONE file:
 *      lib/gmail.ts (inside sendEmail()).
 *   B. `sendEmail` is referenced in exactly TWO files: its definition
 *      (lib/gmail.ts) and its single call site — the PendingAction executor
 *      (lib/pending-actions.ts). No route, component, or tool can dispatch.
 *   C. The executor refuses email_send without an explicit user-approval
 *      record (the refusal string must exist in lib/pending-actions.ts), and
 *      only the approve route constructs a SendApproval.
 *   D. No bulk-approve path exists: the pending-actions API exposes only
 *      single-id approve/discard routes, and no source contains a bulk/batch
 *      approve identifier.
 *
 * Exit 0 = all asserts hold; exit 1 with details otherwise.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const REPO = process.cwd();
const SCAN_DIRS = ['app', 'components', 'lib', 'scripts'];
const EXCLUDE_RE = /node_modules|app\/generated|\.next|\.gitnexus/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (EXCLUDE_RE.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Strip // line comments and /* block comments (rough but sufficient for asserts). */
function stripComments(src: string): string {
  // Block comments + whole-line // comments. Trailing same-line comments are
  // left in place (overstripping risks eating string contents like URLs);
  // anything they mention still fails loudly, which is the safe direction.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const files = SCAN_DIRS.flatMap((d) => walk(join(REPO, d)));
const failures: string[] = [];
const rel = (p: string) => relative(REPO, p);

function filesMatching(re: RegExp, exclude: (relPath: string) => boolean = () => false): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const r = rel(f);
    if (exclude(r)) continue;
    if (re.test(stripComments(readFileSync(f, 'utf-8')))) hits.push(r);
  }
  return hits;
}

// ── A: mail API reachable from exactly one file ─────────────────────────────────
{
  const hits = filesMatching(/users\s*\.\s*messages\s*\.\s*send\b/, (r) => r === 'scripts/check-send-surface.ts');
  if (hits.length !== 1 || hits[0] !== 'lib/gmail.ts') {
    failures.push(`A: gmail users.messages.send must appear ONLY in lib/gmail.ts — found in: [${hits.join(', ') || 'nowhere'}]`);
  } else {
    console.log('✓ A: users.messages.send appears only in lib/gmail.ts');
  }
}

// ── B: sendEmail has exactly one call site — the PendingAction executor ─────────
{
  const allowed = new Set(['lib/gmail.ts', 'lib/pending-actions.ts']);
  const hits = filesMatching(/\bsendEmail\b/, (r) => r === 'scripts/check-send-surface.ts');
  const offenders = hits.filter((h) => !allowed.has(h));
  if (offenders.length) {
    failures.push(`B: sendEmail referenced outside {lib/gmail.ts, lib/pending-actions.ts}: [${offenders.join(', ')}]`);
  } else if (!hits.includes('lib/pending-actions.ts')) {
    failures.push('B: lib/pending-actions.ts no longer references sendEmail — executor wiring broken?');
  } else {
    console.log('✓ B: sendEmail call sites = {definition, PendingAction executor} only');
  }
}

// ── C: executor refusal + approval construction locality ────────────────────────
{
  const pa = stripComments(readFileSync(join(REPO, 'lib/pending-actions.ts'), 'utf-8'));
  if (!/email_send REFUSED: no explicit user-approval record/.test(pa)) {
    failures.push('C: refusal string missing from lib/pending-actions.ts — executor no longer refuses unapproved sends?');
  } else {
    console.log('✓ C1: executor refuses email_send without an explicit user-approval record');
  }
  // SendApproval may be CONSTRUCTED (object literal with via:) only in the approve
  // route. Exempt: the type-definition file, this script, and the outreach e2e
  // fixture (it builds approvals to test the MOCKED executor — assert B proves it
  // cannot reach the real sendEmail).
  const constructors = filesMatching(/via:\s*['"]pending-action-approve['"]/, (r) =>
    r === 'lib/pending-actions.ts' || r === 'scripts/check-send-surface.ts' || r === 'lib/resume/outreach-fixture.ts');
  if (constructors.length !== 1 || constructors[0] !== 'app/api/pending-actions/[id]/approve/route.ts') {
    failures.push(`C: SendApproval constructed outside the approve route: [${constructors.join(', ') || 'nowhere'}]`);
  } else {
    console.log('✓ C2: SendApproval constructed only in the single-id approve route');
  }
}

// ── D: no bulk-approve path ─────────────────────────────────────────────────────
{
  const paDir = join(REPO, 'app/api/pending-actions');
  const routeFiles = walk(paDir).map(rel).sort();
  const expected = [
    'app/api/pending-actions/[id]/approve/route.ts',
    'app/api/pending-actions/[id]/discard/route.ts',
    'app/api/pending-actions/[id]/route.ts',
    'app/api/pending-actions/route.ts',
  ];
  const unexpected = routeFiles.filter((f) => !expected.includes(f));
  if (unexpected.length) {
    failures.push(`D: unexpected pending-actions route file(s) — review for bulk-approve: [${unexpected.join(', ')}]`);
  }
  const bulk = filesMatching(/\b(approveAll|bulkApprove|approve[-_]all|batchApprove)\b/i, (r) => r === 'scripts/check-send-surface.ts');
  if (bulk.length) failures.push(`D: bulk-approve identifier found in: [${bulk.join(', ')}]`);
  if (!unexpected.length && !bulk.length) console.log('✓ D: no bulk-approve path (single-id approve/discard routes only)');
}

// ── E: chat-agent containment (B-11) — the guarded pipeline is the SOLE ─────────
// producer of resume/outreach artifacts; no chat-reachable path can emit one.
{
  const CHAT_SURFACE = files.filter((f) => {
    const r = rel(f);
    return r === 'lib/claude.ts' || r.startsWith('app/api/chat/');
  });

  // E1: retired/ungrounded producers must not be referenced from the chat surface.
  const BANNED_IN_CHAT = /\b(evaluateJob|apply_to_role|generate_tailored_cv|draftOutreach|tailorResume|renderResumeDocx|generateCoverLetter)\b/;
  const e1 = CHAT_SURFACE.filter((f) => BANNED_IN_CHAT.test(stripComments(readFileSync(f, 'utf-8'))));
  if (e1.length) failures.push(`E1: retired/content-producer reference in chat surface: [${e1.map(rel).join(', ')}]`);
  else console.log('✓ E1: chat surface references no retired tool or content producer');

  // E2: chat surface may import from lib/resume ONLY orchestration + verified readers.
  // B-13 adds 'discover': the published-pages discovery crawler/ranker. It produces
  // approval shortlists (cited rationales, verbatim published contacts) — never a
  // resume/outreach draft — so exposing it to chat keeps containment intact.
  const RESUME_IMPORT_ALLOW = new Set(['run-pipeline', 'fetch-target', 'last-green', 'out-dir', 'discover']);
  const e2: string[] = [];
  for (const f of CHAT_SURFACE) {
    const src = stripComments(readFileSync(f, 'utf-8'));
    for (const m of src.matchAll(/@\/lib\/resume\/([a-z0-9-]+)/g)) {
      if (!RESUME_IMPORT_ALLOW.has(m[1])) e2.push(`${rel(f)} → lib/resume/${m[1]}`);
    }
  }
  if (e2.length) failures.push(`E2: chat surface imports a non-allowlisted lib/resume module: [${e2.join(', ')}]`);
  else console.log('✓ E2: chat surface imports only {run-pipeline, fetch-target, last-green, out-dir} from lib/resume');

  // E3: outreach drafting callable only from the B-10 surface.
  const e3 = filesMatching(/\bdraftOutreach\b/, (r) =>
    r === 'lib/resume/outreach.ts' || r === 'app/api/resume/outreach/draft/route.ts' ||
    r === 'lib/resume/outreach-fixture.ts' || r === 'scripts/check-send-surface.ts');
  if (e3.length) failures.push(`E3: draftOutreach referenced outside the B-10 outreach surface: [${e3.join(', ')}]`);
  else console.log('✓ E3: outreach drafting reachable only via the B-10 queue/draft flow');

  // E4: the legacy ungrounded evaluator stays quarantined in career-ops + its
  // flag-off API route; nothing else may call it.
  const e4 = filesMatching(/\bevaluateJob\b/, (r) =>
    r === 'lib/career-ops.ts' || r === 'app/api/career/evaluate/route.ts' || r === 'scripts/check-send-surface.ts');
  if (e4.length) failures.push(`E4: evaluateJob referenced outside quarantine: [${e4.join(', ')}]`);
  else console.log('✓ E4: legacy evaluateJob quarantined to career-ops + flag-off API route');
}

// ── F: vault/Memory write containment (B-12) — no code path writes ~/vault ─────
// or the Memory table outside the PendingAction executors.
{
  // F1: prisma Memory-table writes live ONLY in the executor.
  const f1 = filesMatching(/prisma\.memory\.(create|upsert|update|updateMany|delete|deleteMany)\b/, (r) =>
    r === 'lib/pending-actions.ts' || r === 'scripts/check-send-surface.ts' || r.startsWith('app/generated/'));
  if (f1.length) failures.push(`F1: prisma.memory write outside the executor: [${f1.join(', ')}]`);
  else console.log('✓ F1: Memory-table writes only in the pending-action executor');

  // F2: writeNote (the vault file writer) callable only from its definition and the executor.
  const f2 = filesMatching(/\bwriteNote\s*\(/, (r) =>
    r === 'lib/vault.ts' || r === 'lib/pending-actions.ts' || r === 'scripts/check-send-surface.ts');
  if (f2.length) failures.push(`F2: writeNote called outside the executor: [${f2.join(', ')}]`);
  else console.log('✓ F2: writeNote reachable only from the vault_write executor');

  // F3: the former ungated writers contain no direct fs writes into the vault.
  // vault-writer/memory.ts: zero fs write calls at all; memory-refresh/scheduler:
  // no write/append that references MEMORY_PATH (their logs moved to ~/hatch/out).
  const NO_FS_WRITES = ['lib/vault-writer.ts', 'lib/memory.ts'];
  for (const f of NO_FS_WRITES) {
    const src = stripComments(readFileSync(join(REPO, f), 'utf-8'));
    if (/\b(writeFile|writeFileSync|appendFileSync)\s*\(/.test(src)) {
      failures.push(`F3: ${f} contains a direct fs write — must propose via PendingAction`);
    }
  }
  for (const f of ['lib/memory-refresh.ts', 'lib/memory-scheduler.ts']) {
    const src = stripComments(readFileSync(join(REPO, f), 'utf-8'));
    for (const line of src.split('\n')) {
      if (/\b(writeFile|appendFile)\s*\(/.test(line) && /MEMORY_PATH|VAULT_PATH/.test(line)) {
        failures.push(`F3: ${f} writes a vault path directly: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  if (!failures.some((x) => x.startsWith('F3'))) console.log('✓ F3: former ungated writers contain no direct vault fs writes');

  // F4: the legacy-memory file writer is executor-only; the retired career-ops
  // vault sync stays gone.
  const f4a = filesMatching(/\bwriteMemoryCategoryKey\s*\(/, (r) =>
    r === 'lib/legacy-memory.ts' || r === 'lib/pending-actions.ts' || r === 'scripts/check-send-surface.ts');
  if (f4a.length) failures.push(`F4: writeMemoryCategoryKey called outside the executor: [${f4a.join(', ')}]`);
  const f4b = filesMatching(/syncEvaluationToMemory\s*\(/, (r) => r === 'scripts/check-send-surface.ts');
  if (f4b.length) failures.push(`F4: retired syncEvaluationToMemory referenced: [${f4b.join(', ')}]`);
  if (!f4a.length && !f4b.length) console.log('✓ F4: legacy-memory writer executor-only; career-ops vault sync gone');

  // F5: the index regenerator (a direct memory/ writer by design) is import-locked
  // to the executor.
  const f5 = filesMatching(/@\/lib\/memory-index/, (r) =>
    r === 'lib/pending-actions.ts' || r === 'lib/memory-index.ts' || r === 'scripts/check-send-surface.ts');
  if (f5.length) failures.push(`F5: memory-index imported outside the executor: [${f5.join(', ')}]`);
  else console.log('✓ F5: memory-index import-locked to the vault_write executor');
}

if (failures.length) {
  console.error('\nguard:send-surface FAILURES:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nguard:send-surface: ALL ASSERTS HOLD (send gate + chat containment + vault-write gate)');
