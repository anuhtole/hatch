import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET — list all campaigns with message counts
export async function GET() {
  try {
    const campaigns = await prisma.outreachCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { messages: { select: { id: true, status: true } } },
    });
    return NextResponse.json({ campaigns });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — create a new campaign
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      name: string;
      goal: string;
      targetOrg?: string;
      targetRole?: string;
      notes?: string;
    };
    const campaign = await prisma.outreachCampaign.create({
      data: {
        name: body.name,
        goal: body.goal,
        targetOrg: body.targetOrg ?? null,
        targetRole: body.targetRole ?? null,
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json({ campaign });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
