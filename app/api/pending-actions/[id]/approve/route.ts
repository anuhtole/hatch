import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  executePendingAction,
  summarizeAction,
  type AnyPayload,
  type PendingActionType,
  type SendApproval,
} from '@/lib/pending-actions';

/**
 * POST /api/pending-actions/[id]/approve
 * Executes the queued write. Only valid for rows with status='pending'.
 *
 * Optional JSON body lets the user approve an EDITED version of the proposed
 * content (the pending card exposes the value/content as an editable field):
 *   - memory_write: { value }   → overrides payload.value
 *   - vault_write:  { content } → overrides payload.content
 * Only these content fields are accepted — the target location (category/key,
 * path/mode, url) can NOT be edited via this route, so an edit can never
 * redirect a write somewhere else. The EDITED payload is what gets executed
 * and is persisted on the row so the approved card + audit log reflect it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await prisma.pendingAction.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status !== 'pending') {
    return NextResponse.json(
      { error: `Action already ${row.status}` },
      { status: 400 },
    );
  }

  let payload: AnyPayload;
  try {
    payload = JSON.parse(row.payload) as AnyPayload;
  } catch {
    return NextResponse.json({ error: 'Corrupt payload — cannot approve' }, { status: 500 });
  }

  // Merge in user edits (content only — whitelisted per type).
  const edits = (await req.json().catch(() => ({}))) as {
    value?: unknown; content?: unknown; subject?: unknown; body?: unknown;
  };
  if (row.type === 'memory_write' && typeof edits.value === 'string') {
    (payload as { value: string }).value = edits.value;
  } else if (row.type === 'vault_write' && typeof edits.content === 'string') {
    (payload as { content: string }).content = edits.content;
  } else if (row.type === 'email_send') {
    // Editable: what the email says. NOT editable: who it goes to or what is
    // attached — an edit can never redirect a send or swap the attachment.
    if (typeof edits.subject === 'string') (payload as { subject: string }).subject = edits.subject;
    if (typeof edits.body === 'string') (payload as { body: string }).body = edits.body;
  }

  // Persist the edited payload + refreshed summary BEFORE executing so the
  // approved-state card and any audit trail reflect what was actually written.
  const editedPayloadStr = JSON.stringify(payload);
  if (editedPayloadStr !== row.payload) {
    await prisma.pendingAction.update({
      where: { id },
      data: {
        payload: editedPayloadStr,
        summary: summarizeAction(row.type as PendingActionType, payload),
      },
    });
  }

  // Explicit per-message approval record (B-10): constructed ONLY here, after a
  // status='pending' row was individually approved. The email_send executor
  // refuses to dispatch without it. This route handles exactly one id — there
  // is no batch-approve.
  const approval: SendApproval = {
    explicit: true,
    actionId: id,
    approvedAt: new Date().toISOString(),
    via: 'pending-action-approve',
  };

  let resultSummary: string;
  try {
    resultSummary = await executePendingAction(row.type as PendingActionType, payload, approval);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const updated = await prisma.pendingAction.update({
    where: { id },
    data: {
      status: 'approved',
      resolvedAt: new Date(),
      resultSummary,
    },
  });

  return NextResponse.json(updated);
}
