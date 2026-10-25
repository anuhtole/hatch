import { NextRequest, NextResponse } from 'next/server';
import { readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildCandidatePool } from '@/lib/resume/candidate-pool';
import { loadTargetDef } from '@/lib/resume/fetch-target';
import {
  assertPacing,
  draftOutreach,
  fetchRecipientSources,
  loadLastGreen,
  loadQueue,
  pickAttachment,
  updateQueueEntry,
  writeDraftArtifact,
} from '@/lib/resume/outreach';
import { checkOutreachDraft } from '@/lib/resume/check-outreach';
import { OUTREACH_ATTACHMENT_FORMAT } from '@/lib/resume/outreach-constants';
import { createPendingAction, type EmailSendPayload } from '@/lib/pending-actions';

const LAB_RE = /^[a-z0-9-]+$/;

function allLabs(): string[] {
  try {
    return readdirSync(join(homedir(), 'hatch', 'targets'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

/**
 * POST /api/resume/outreach/draft — draft ONE grounded outreach email for an
 * APPROVED (user-picked) queue entry. Flow:
 *   pacing gate → last-green attachment → fetch recipient sources → draft
 *   (two-regime grounded) → guard:outreach (FAIL ⇒ 422, nothing queued) →
 *   email_send PendingAction carrying the full final bytes.
 * Approval/deny then runs through the pending-actions card — HATCH NEVER SENDS.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { lab?: string; queueId?: string } | null;
  if (!body?.lab || !LAB_RE.test(body.lab) || !body.queueId) {
    return NextResponse.json({ error: 'lab + queueId required' }, { status: 400 });
  }
  const { lab, queueId } = body;

  const entry = loadQueue(lab).find((e) => e.id === queueId);
  if (!entry) return NextResponse.json({ error: 'queue entry not found' }, { status: 404 });
  if (entry.status !== 'queued') {
    return NextResponse.json({ error: `entry is "${entry.status}" — only queued entries can be drafted` }, { status: 400 });
  }
  if (!entry.recipient.email) {
    return NextResponse.json(
      { error: 'no published email for this recipient — contact route is "application page only"; outreach email is not possible' },
      { status: 400 },
    );
  }
  if (!entry.recipient.sourceUrls.length) {
    return NextResponse.json({ error: 'recipient has no published source URLs to ground against' }, { status: 400 });
  }

  try {
    // Pacing limits drafting pressure (MAX_DRAFTS_PER_DAY, MIN_HOURS_BETWEEN_SENDS_SAME_LAB).
    assertPacing(lab, allLabs(), new Date());

    const lastGreen = loadLastGreen(lab); // throws unless a green pipeline run exists w/ matching hash
    const pool = buildCandidatePool();
    const sources = await fetchRecipientSources(entry.recipient);

    let targetProfileText = '';
    try {
      const def = loadTargetDef(lab);
      targetProfileText = `${def.title ?? lab}\n${def.pastedText ?? ''}`;
    } catch { /* target def optional for grounding union */ }

    const draft = await draftOutreach({
      lab,
      recipient: entry.recipient,
      pool,
      sources,
      targetProfileText,
      attachment: lastGreen,
      now: new Date().toISOString(),
    });

    // guard:outreach — a failing draft NEVER becomes a PendingAction.
    const violations = checkOutreachDraft(draft, pool.claims, { lastGreen });
    if (violations.length) {
      return NextResponse.json(
        { error: 'guard:outreach FAILED — draft rejected, nothing queued', violations },
        { status: 422 },
      );
    }

    const draftPath = writeDraftArtifact(draft);

    const att = pickAttachment(lastGreen, OUTREACH_ATTACHMENT_FORMAT);
    const payload: EmailSendPayload = {
      account: 'berkeley',
      to: entry.recipient.email,
      toName: entry.recipient.name,
      subject: draft.subject,
      body: draft.body,
      attachments: [{
        filename: att.filename,
        mimeType: att.mimeType,
        filePath: att.path,
        sha256: att.sha256,
      }],
      lab,
      queueId,
    };
    const { id: pendingActionId, summary } = await createPendingAction('email_send', payload);

    updateQueueEntry(lab, queueId, {
      status: 'pending_send',
      draftPath,
      pendingActionId,
      draftedAt: new Date().toISOString(),
    });

    return NextResponse.json({ draft, draftPath, pendingActionId, summary }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /^pacing:/.test(msg) ? 429 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
