import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const [lastSync, docCount, lastSyncLogs] = await Promise.all([
    prisma.syncLog.findFirst({
      where: { status: 'success' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.knowledgeDocument.count(),
    prisma.syncLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  return NextResponse.json({
    lastSyncedAt: lastSync?.createdAt ?? null,
    documentCount: docCount,
    recentLogs: lastSyncLogs,
  });
}
