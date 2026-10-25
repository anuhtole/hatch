import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = { params: Promise<{ id: string }> };

// GET — campaign detail with all messages
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const campaign = await prisma.outreachCampaign.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ campaign });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH — update campaign fields
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json() as {
      name?: string;
      goal?: string;
      status?: string;
      targetOrg?: string;
      targetRole?: string;
      notes?: string;
    };
    const campaign = await prisma.outreachCampaign.update({
      where: { id },
      data: {
        ...(body.name       !== undefined && { name: body.name }),
        ...(body.goal       !== undefined && { goal: body.goal }),
        ...(body.status     !== undefined && { status: body.status }),
        ...(body.targetOrg  !== undefined && { targetOrg: body.targetOrg }),
        ...(body.targetRole !== undefined && { targetRole: body.targetRole }),
        ...(body.notes      !== undefined && { notes: body.notes }),
      },
    });
    return NextResponse.json({ campaign });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — delete campaign and all its messages
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    await prisma.outreachCampaign.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
