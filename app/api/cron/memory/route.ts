import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractAndWriteMemory } from '@/lib/vault-writer';

export const maxDuration = 300;

// Called on a schedule (e.g. every 10 minutes) to extract memories from idle conversations.
// In dev: hit GET /api/cron/memory manually or let the chat route trigger it.
// In production: add to vercel.json crons.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const idleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago

  const candidates = await prisma.conversation.findMany({
    where: {
      memoryExtracted: false,
      memoryExcluded: false,
      updatedAt: { lt: idleThreshold },
    },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: 10, // process at most 10 per run
  });

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const conv of candidates) {
    try {
      await extractAndWriteMemory(conv.id);
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { memoryExtracted: true },
      });
      results.push({ id: conv.id, ok: true });
    } catch (err) {
      console.error('[cron/memory] extraction failed for', conv.id, err);
      results.push({ id: conv.id, ok: false, error: String(err) });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
