import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reanalyzeTracker, regenerateTrackerMeta } from '@/lib/tracker';

export const maxDuration = 120;

// POST /api/trackers/cleanup
// One-time migration: regenerates summaryLine + tailoredMessage for all trackers.
// Also fills in missing trackerType via reanalysis.
export async function POST() {
  const trackers = await prisma.tracker.findMany();
  const results: { id: string; title: string; status: string }[] = [];

  for (const t of trackers) {
    try {
      let tracker = t;

      // If trackerType is missing or default but no stepsConfig, reanalyze scope
      if (!t.trackerType || (t.trackerType === 'binary' && !t.stepsConfig)) {
        const analysis = await reanalyzeTracker({
          title: t.title,
          description: t.description,
        });

        tracker = await prisma.tracker.update({
          where: { id: t.id },
          data: {
            trackerType: analysis.trackerType,
            stepsConfig: analysis.steps ? JSON.stringify(analysis.steps) : null,
            currentStepId: analysis.currentStepId ?? null,
            monitorType: analysis.monitorType ?? 'custom',
            monitorConfig: JSON.stringify(analysis.monitorConfig ?? {}),
          },
        });
      }

      // Regenerate summary and tailored message (no emojis, editorial tone)
      const meta = await regenerateTrackerMeta({
        title: tracker.title,
        description: tracker.description,
        trackerType: tracker.trackerType,
        currentStatus: tracker.currentStatus,
        currentStepId: tracker.currentStepId,
        stepsConfig: tracker.stepsConfig,
      });

      await prisma.tracker.update({
        where: { id: t.id },
        data: {
          summaryLine: meta.summaryLine,
          tailoredMessage: meta.tailoredMessage,
        },
      });

      console.log(`[cleanup] Cleaned tracker ${t.id}: ${t.title}`);
      results.push({ id: t.id, title: t.title, status: 'ok' });
    } catch (err) {
      console.error(`[cleanup] Failed tracker ${t.id}:`, err);
      results.push({ id: t.id, title: t.title, status: `error: ${String(err)}` });
    }
  }

  return NextResponse.json({ cleaned: results.length, results });
}
