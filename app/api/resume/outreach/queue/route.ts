import { NextRequest, NextResponse } from 'next/server';
import { loadQueue, saveQueue, updateQueueEntry, type OutreachRecipient, type QueueEntry } from '@/lib/resume/outreach';

const LAB_RE = /^[a-z0-9-]+$/;

/** GET /api/resume/outreach/queue?lab=<name> — the per-lab outreach queue. */
export async function GET(req: NextRequest) {
  const lab = new URL(req.url).searchParams.get('lab');
  if (!lab || !LAB_RE.test(lab)) return NextResponse.json({ error: 'lab query param required' }, { status: 400 });
  return NextResponse.json({ lab, queue: loadQueue(lab) });
}

/**
 * POST /api/resume/outreach/queue — the user PICKS a shortlist recipient.
 * Body: { lab, recipient: { name, group, email, emailSourceUrl, sourceUrls } }.
 * Picks become outreach entries; drafting is a separate explicit step.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { lab?: string; recipient?: OutreachRecipient } | null;
  if (!body?.lab || !LAB_RE.test(body.lab) || !body.recipient?.name) {
    return NextResponse.json({ error: 'lab + recipient{name,…} required' }, { status: 400 });
  }
  const r = body.recipient;
  const queue = loadQueue(body.lab);
  const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  if (queue.some((e) => e.id === slug && e.status !== 'denied')) {
    return NextResponse.json({ error: `"${r.name}" is already in the ${body.lab} queue` }, { status: 409 });
  }
  const entry: QueueEntry = {
    id: slug,
    recipient: {
      name: r.name,
      group: r.group ?? '',
      email: r.email ?? '',
      emailSourceUrl: r.emailSourceUrl ?? '',
      sourceUrls: r.sourceUrls ?? [],
    },
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  saveQueue(body.lab, [...queue.filter((e) => e.id !== slug), entry]);
  return NextResponse.json({ entry }, { status: 201 });
}

/**
 * PATCH /api/resume/outreach/queue — archive a pick with a reason (deny before
 * any draft exists). Reason is stored as suppression CONTEXT only — nothing
 * auto-learns from it. Denying a pending_send draft goes through
 * /api/pending-actions/[id]/discard instead (which also archives here).
 */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { lab?: string; id?: string; reason?: string } | null;
  if (!body?.lab || !LAB_RE.test(body.lab) || !body.id) {
    return NextResponse.json({ error: 'lab + id required' }, { status: 400 });
  }
  const updated = updateQueueEntry(body.lab, body.id, {
    status: 'denied',
    reason: body.reason ?? '',
  });
  if (!updated) return NextResponse.json({ error: 'queue entry not found' }, { status: 404 });
  return NextResponse.json({ entry: updated });
}
