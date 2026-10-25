import { NextResponse } from 'next/server';
import { getApplicationsPipeline, getFollowupsDue } from '@/lib/career-ops';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import path from 'path';
import os from 'os';

export async function GET() {
  try {
    const [pipeline, followups, dbCards, outreachMsgs] = await Promise.all([
      getApplicationsPipeline().catch(() => ({ total: 0, byStatus: {} as Record<string, number>, applications: [] })),
      getFollowupsDue().catch(() => []),
      prisma.pipelineCard.findMany({ select: { status: true } }),
      prisma.outreachMessage.findMany({ select: { status: true, createdAt: true } }),
    ]);

    // Merge markdown + DB byStatus
    const byStatus: Record<string, number> = { ...pipeline.byStatus };
    for (const card of dbCards) {
      byStatus[card.status] = (byStatus[card.status] ?? 0) + 1;
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    // Count today's new jobs from scan-history.tsv
    const careerOpsPath = process.env.CAREER_OPS_PATH || path.join(os.homedir(), 'career-ops');
    const todayStr = new Date().toISOString().slice(0, 10);
    let newJobsToday = 0;
    try {
      const tsv = await readFile(path.join(careerOpsPath, 'data', 'scan-history.tsv'), 'utf-8');
      newJobsToday = tsv.split('\n').filter((l) => l.includes(todayStr)).length;
    } catch { /* no scan run yet */ }

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const outreachToday   = outreachMsgs.filter((m) => new Date(m.createdAt) >= todayStart).length;
    const outreachPending = outreachMsgs.filter((m) => m.status === 'draft' || m.status === 'approved').length;

    return NextResponse.json({
      total,
      byStatus,
      followupsOverdue: followups.length,
      newJobsToday,
      outreachToday,
      outreachPending,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
