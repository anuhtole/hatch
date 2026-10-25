/**
 * lib/resume/outreach-fixture.ts — B-10 Phase-3b end-to-end outreach test.
 * `npm run resume:outreach-test`
 *
 * NO REAL PERSON, NO REAL SEND:
 *   1. Serves FIXTURE lab pages on 127.0.0.1 (fake recipient "Prof. Test
 *      Fixture"), with the contact email published verbatim on the page.
 *   2. Builds a fake-lab last-green attachment (synthetic docx bytes, hashed).
 *   3. Drafts ONE outreach email against the fixture pages with the REAL
 *      drafting path (model call + two-regime prompt), then runs
 *      guard:outreach on the live draft (must be 0 violations) AND the static
 *      pass/fail fixture suite (engagement violation fails, uncited
 *      recipient-fact fails, clean passes).
 *   4. Proves the PendingAction round-trip with the send executor MOCKED:
 *        - unapproved execute → REFUSED, mock never called;
 *        - denied action → archived w/ reason, mock never called;
 *        - approved execute → mock receives EXACTLY the approved bytes
 *          (to/subject/body equality + attachment sha re-verified).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import http from 'http';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { buildCandidatePool } from '@/lib/resume/candidate-pool';
import {
  draftOutreach,
  fetchRecipientSources,
  saveQueue,
  loadQueue,
  type LastGreen,
  type OutreachRecipient,
} from '@/lib/resume/outreach';
import { checkOutreachDraft, runFixtures } from '@/lib/resume/check-outreach';
import { outDirFor } from '@/lib/resume/out-dir';
import {
  executeEmailSend,
  archiveDeniedEmailSend,
  type EmailSendPayload,
  type SendApproval,
} from '@/lib/pending-actions';

const FAKE_LAB = 'fake-lab';
const FAKE_EMAIL = 'test.fixture@fixture-lab.invalid';

const PAGES: Record<string, string> = {
  '/': `<html><head><title>Fixture Lab</title></head><body>
    <h1>The Fixture Lab</h1>
    <p>The Fixture Lab at Fixture University studies reward modeling, agent evaluation,
    and AI oversight. The lab is led by Prof. Test Fixture.</p>
    <a href="/people">People</a> <a href="/research">Research</a></body></html>`,
  '/people': `<html><head><title>People — Fixture Lab</title></head><body>
    <h1>People</h1>
    <p>Prof. Test Fixture — Principal Investigator. Contact: ${FAKE_EMAIL}</p>
    <p>The lab hosts undergraduate researchers through its open application each fall.</p></body></html>`,
  '/research': `<html><head><title>Research — Fixture Lab</title></head><body>
    <h1>Research</h1>
    <p>Current projects include evaluating agentic systems, building benchmarks for
    AI reviewer agents, and studying product-facing AI workflows. Recent work examines
    how AI assistants integrate with productivity platforms like Power Apps.</p></body></html>`,
};

function serve(): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = PAGES[req.url ?? '/'];
      if (!body) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, base: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function fail(msg: string): never {
  console.error(`✗ FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  let failures = 0;

  // ── Static guard fixture suite ────────────────────────────────────────────────
  console.log('── guard:outreach static fixtures ──');
  if (!runFixtures()) fail('guard:outreach static fixtures failed');

  // ── Fixture lab server + fake last-green attachment ──────────────────────────
  const { server, base } = await serve();
  console.log(`\n── fixture lab serving at ${base} ──`);

  const outDir = outDirFor(FAKE_LAB);
  mkdirSync(join(outDir, 'outreach'), { recursive: true });
  const docxPath = join(outDir, 'tailored-resume.docx');
  writeFileSync(docxPath, `FIXTURE-DOCX-BYTES ${base}`); // synthetic attachment bytes
  const sha256 = createHash('sha256').update(readFileSync(docxPath)).digest('hex');
  const pdfPath = join(outDir, 'resume.pdf');
  writeFileSync(pdfPath, `FIXTURE-PDF-BYTES ${base}`);
  const pdfSha256 = createHash('sha256').update(readFileSync(pdfPath)).digest('hex');
  const lastGreen: LastGreen = { docxPath, sha256, pdfPath, pdfSha256, coverLetterPath: '', completedAt: new Date().toISOString() };
  writeFileSync(join(outDir, 'last-green.json'), JSON.stringify(lastGreen, null, 2));

  const recipient: OutreachRecipient = {
    name: 'Prof. Test Fixture',
    group: 'Fixture Lab',
    email: FAKE_EMAIL,
    emailSourceUrl: `${base}/people`,
    sourceUrls: [`${base}/`, `${base}/people`, `${base}/research`],
  };

  try {
    // ── Live draft against fixture pages ────────────────────────────────────────
    console.log('\n── drafting ONE test outreach (fake recipient, real drafting path) ──');
    const pool = buildCandidatePool();
    const sources = await fetchRecipientSources(recipient);
    console.log(`fetched ${sources.length} fixture source(s)`);
    const draft = await draftOutreach({
      lab: FAKE_LAB,
      recipient,
      pool,
      sources,
      targetProfileText: 'Undergraduate research position at Fixture Lab (test fixture).',
      attachment: lastGreen,
      now: new Date().toISOString(),
    });
    console.log(`subject: ${draft.subject}`);
    console.log(`body (${draft.body.split(/\s+/).length} words):\n${draft.body.split('\n').map((l) => '  ' + l).join('\n')}`);

    const violations = checkOutreachDraft(draft, pool.claims, { lastGreen });
    if (violations.length) {
      for (const v of violations) console.error(`  ✗ [${v.check}] ${v.detail}${v.sentence ? ` :: ${v.sentence}` : ''}`);
      fail(`live fixture draft has ${violations.length} guard violation(s)`);
    }
    console.log('✓ live draft passes guard:outreach (0 violations)');

    // ── PendingAction round-trip with the executor MOCKED ───────────────────────
    console.log('\n── send-executor round-trip (MOCKED — nothing real is sent) ──');
    const sent: Array<{ account: string; to: string; subject: string; body: string; attachments?: Array<{ filename: string; filePath: string }> }> = [];
    const mockSend = (async (account: string, to: string, subject: string, body: string, attachments?: Array<{ filename: string; mimeType: string; filePath: string }>) => {
      sent.push({ account, to, subject, body, attachments });
      return { id: 'mock-message-id' };
    }) as Parameters<typeof executeEmailSend>[2];

    const payload: EmailSendPayload = {
      account: 'berkeley',
      to: recipient.email,
      toName: recipient.name,
      subject: draft.subject,
      body: draft.body,
      // The draft carries the default-format attachment (B-11: pdf) — payload
      // mirrors exactly what the draft route would queue.
      attachments: [{ filename: 'Anatole-Seychal-Resume.pdf', mimeType: 'application/pdf', filePath: draft.attachmentPath, sha256: draft.attachmentSha256 }],
      lab: FAKE_LAB,
      queueId: 'fixture-entry',
    };
    saveQueue(FAKE_LAB, [{ id: 'fixture-entry', recipient, status: 'pending_send', createdAt: new Date().toISOString() }]);

    // (i) unapproved → REFUSED, mock untouched
    let threw = false;
    try { await executeEmailSend(payload, undefined, mockSend); } catch (e) {
      threw = true;
      console.log(`✓ unapproved execute REFUSED: ${(e as Error).message.slice(0, 80)}…`);
    }
    if (!threw) { failures++; console.error('✗ unapproved execute DID NOT throw'); }
    // malformed approval also refused
    threw = false;
    try {
      await executeEmailSend(payload, { explicit: false } as unknown as SendApproval, mockSend);
    } catch { threw = true; }
    if (!threw) { failures++; console.error('✗ malformed approval DID NOT throw'); }
    else console.log('✓ malformed approval record REFUSED');
    if (sent.length !== 0) { failures++; console.error(`✗ mock send was reached ${sent.length}× without approval`); }
    else console.log('✓ mock send never reached without approval');

    // (ii) denied → archived with reason, mock untouched
    archiveDeniedEmailSend(payload, 'fixture deny reason — testing only');
    const denied = loadQueue(FAKE_LAB).find((e) => e.id === 'fixture-entry');
    if (denied?.status !== 'denied' || !denied.reason?.includes('fixture deny reason')) {
      failures++; console.error(`✗ deny did not archive with reason (status=${denied?.status})`);
    } else console.log(`✓ denied action archived with reason ("${denied.reason}")`);
    if (sent.length !== 0) { failures++; console.error('✗ mock send reached after deny'); }
    else console.log('✓ denied action never reached the executor send');

    // (iii) approved → mock receives EXACTLY the approved bytes
    saveQueue(FAKE_LAB, [{ id: 'fixture-entry', recipient, status: 'pending_send', createdAt: new Date().toISOString() }]);
    const approval: SendApproval = { explicit: true, actionId: 'fixture-action-1', approvedAt: new Date().toISOString(), via: 'pending-action-approve' };
    const summary = await executeEmailSend(payload, approval, mockSend);
    if (sent.length !== 1) fail(`approved execute reached mock ${sent.length}× (expected exactly 1)`);
    const got = sent[0];
    if (got.account !== payload.account || got.to !== payload.to || got.subject !== payload.subject || got.body !== payload.body) {
      failures++; console.error('✗ mock received bytes ≠ approved payload bytes');
    } else console.log('✓ mock received exactly the approved to/subject/body');
    const gotAtt = got.attachments?.[0];
    const gotSha = gotAtt ? createHash('sha256').update(readFileSync(gotAtt.filePath)).digest('hex') : '';
    if (!gotAtt || gotSha !== draft.attachmentSha256) {
      failures++; console.error(`✗ attachment bytes mismatch (sha ${gotSha.slice(0, 12)}… ≠ ${draft.attachmentSha256.slice(0, 12)}…)`);
    } else console.log('✓ attachment bytes hash-verified against the approved sha256');
    const sentEntry = loadQueue(FAKE_LAB).find((e) => e.id === 'fixture-entry');
    if (sentEntry?.status !== 'sent') { failures++; console.error(`✗ queue not marked sent (status=${sentEntry?.status})`); }
    else console.log(`✓ queue marked sent — executor summary: ${summary}`);

    // (iv) tampered attachment → aborted even WITH approval
    writeFileSync(draft.attachmentPath, 'TAMPERED BYTES AFTER APPROVAL');
    threw = false;
    try { await executeEmailSend(payload, approval, mockSend); } catch (e) {
      threw = true;
      console.log(`✓ tampered attachment aborted post-approval: ${(e as Error).message.slice(0, 80)}…`);
    }
    if (!threw) { failures++; console.error('✗ tampered attachment was NOT caught'); }
    if (sent.length !== 1) { failures++; console.error('✗ tampered send reached the mock'); }
  } finally {
    server.close();
    // Clean the synthetic fixture lab dir (gitignored anyway, but keep out/ tidy).
    try { rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  if (failures > 0) fail(`${failures} round-trip assertion(s) failed`);
  console.log('\nresume:outreach-test: ALL CHECKS PASS (guards + mocked round-trip)');
}

main().catch((e) => { console.error('OUTREACH FIXTURE FAILED:', e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
