import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = { params: Promise<{ id: string }> };

// POST — add a message (optionally AI-draft it)
export async function POST(req: Request, { params }: Params) {
  const { id: campaignId } = await params;
  try {
    const body = await req.json() as {
      recipientName: string;
      recipientEmail: string;
      recipientTitle?: string;
      recipientOrg?: string;
      subject?: string;
      body?: string;
      notes?: string;
      // if true, call Claude to draft subject+body
      autoDraft?: boolean;
      // context for autoDraft
      campaignGoal?: string;
      senderName?: string;
      senderContext?: string;
    };

    // autoDraft RETIRED (B-10): it generated ungrounded cold emails (no citations,
    // no provenance), which violates two-regime grounding. Grounded outreach
    // drafting lives in Resume Studio → Outreach (lib/resume/outreach.ts +
    // guard:outreach). Manual message CRUD below is unchanged.
    if (body.autoDraft) {
      return NextResponse.json(
        { error: 'autoDraft retired (B-10): ungrounded drafting is not allowed. Use Resume Studio → Outreach.' },
        { status: 410 },
      );
    }

    const subject = body.subject ?? '';
    const messageBody = body.body ?? '';

    const message = await prisma.outreachMessage.create({
      data: {
        campaignId,
        recipientName: body.recipientName,
        recipientEmail: body.recipientEmail,
        recipientTitle: body.recipientTitle ?? null,
        recipientOrg: body.recipientOrg ?? null,
        subject,
        body: messageBody,
        status: 'draft',
        notes: body.notes ?? null,
      },
    });

    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
