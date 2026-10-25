import { NextResponse } from 'next/server';
import { getKnowledgeStats } from '@/lib/indexer';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const [bySource, total, recentJob, memoryCount] = await Promise.all([
      getKnowledgeStats(),
      prisma.knowledgeItem.count(),
      prisma.indexingJob.findFirst({ orderBy: { startedAt: 'desc' } }),
      prisma.memory.count(),
    ]);

    return NextResponse.json({
      total,
      bySource,
      memoryCount,
      lastJob: recentJob
        ? {
            status: recentJob.status,
            source: recentJob.source,
            startedAt: recentJob.startedAt,
            finishedAt: recentJob.finishedAt,
            stats: recentJob.stats ? JSON.parse(recentJob.stats) : null,
            error: recentJob.error,
          }
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
