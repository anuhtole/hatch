import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { executePendingAction } from '@/lib/pending-actions';

type Params = { params: Promise<{ id: string; msgId: string }> };

// PATCH — update message (approve, mark sent, update body, etc.)
export async function PATCH(req: Request, { params }: Params) {
  const { msgId } = await params;
  try {
    const body = await req.json() as {
      status?: string;
      subject?: string;
      body?: string;
      notes?: string;
      sentAt?: string;
      repliedAt?: string;
      followupDue?: string;
    };
    const message = await prisma.outreachMessage.update({
      where: { id: msgId },
      data: {
        ...(body.status      !== undefined && { status: body.status }),
        ...(body.subject     !== undefined && { subject: body.subject }),
        ...(body.body        !== undefined && { body: body.body }),
        ...(body.notes       !== undefined && { notes: body.notes }),
        ...(body.sentAt      !== undefined && { sentAt: new Date(body.sentAt) }),
        ...(body.repliedAt   !== undefined && { repliedAt: new Date(body.repliedAt) }),
        ...(body.followupDue !== undefined && { followupDue: new Date(body.followupDue) }),
      },
    });

    // Write to memory on sent/replied — these are meaningful career relationship events
    if (body.status === 'sent' || body.status === 'replied') {
      const memKey = `outreach:${message.recipientName.toLowerCase().replace(/\s+/g, '_')}`;
      executePendingAction('memory_write', {
        category: 'career', key: memKey, value: JSON.stringify({ name: message.recipientName, email: message.recipientEmail, title: message.recipientTitle, org: message.recipientOrg, lastContact: new Date().toISOString(), status: body.status }), store: 'db',
      }).catch(() => { /* non-blocking; B-12: executor is the sole Memory-table writer */ });
    }

    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — remove a message
export async function DELETE(_req: Request, { params }: Params) {
  const { msgId } = await params;
  try {
    await prisma.outreachMessage.delete({ where: { id: msgId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
