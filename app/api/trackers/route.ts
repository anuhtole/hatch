import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createTracker } from '@/lib/tracker';

export async function GET() {
  const trackers = await prisma.tracker.findMany({
    orderBy: { createdAt: 'desc' },
    include: { history: { orderBy: { checkedAt: 'desc' }, take: 5 } },
  });
  return NextResponse.json(trackers);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const tracker = await createTracker({
    title: body.title,
    description: body.description,
    category: body.category,
    monitorType: body.monitorType,
    monitorConfig: body.monitorConfig ?? {},
    checkFrequency: body.checkFrequency ?? 'daily',
    notifyOnChange: body.notifyOnChange ?? true,
    color: body.color ?? 'yellow',
    notes: body.notes,
  });
  return NextResponse.json(tracker, { status: 201 });
}
