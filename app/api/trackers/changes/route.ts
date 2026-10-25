import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  // Return trackers that changed in the last 24h, ordered by lastChanged desc
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const changed = await prisma.tracker.findMany({
    where: { lastChanged: { gte: since } },
    orderBy: { lastChanged: 'desc' },
    include: { history: { orderBy: { checkedAt: 'desc' }, take: 3 } },
  });
  return NextResponse.json(changed);
}
