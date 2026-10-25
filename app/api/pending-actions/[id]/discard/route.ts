import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { archiveDeniedEmailSend, type EmailSendPayload } from '@/lib/pending-actions';

/**
 * POST /api/pending-actions/[id]/discard
 * Marks the row as discarded. No-op for the underlying systems.
 *
 * Optional JSON body { reason } — for email_send denials the reason is archived
 * on the outreach queue entry as suppression CONTEXT only (no auto-learning:
 * nothing reads it back into drafting).
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

  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };

  if (row.type === 'email_send') {
    try {
      archiveDeniedEmailSend(JSON.parse(row.payload) as EmailSendPayload, reason ?? '');
    } catch (err) {
      console.error('[pending-actions discard] deny archive failed:', err);
    }
  }

  const updated = await prisma.pendingAction.update({
    where: { id },
    data: {
      status: 'discarded',
      resolvedAt: new Date(),
      ...(reason ? { resultSummary: `Denied: ${reason}` } : {}),
    },
  });

  return NextResponse.json(updated);
}
