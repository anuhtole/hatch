import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/pending-actions
 * Optional ?status=pending|approved|discarded
 * Optional ?conversationId=...
 *
 * Used by the PendingActionCard on mount (and reload) to rehydrate state
 * if the chat is reopened after the stream is gone.
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  const conversationId = req.nextUrl.searchParams.get('conversationId') ?? undefined;

  const rows = await prisma.pendingAction.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return NextResponse.json({ actions: rows });
}
