import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reanalyzeTracker, checkTracker, regenerateTrackerMeta } from '@/lib/tracker';

export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tracker = await prisma.tracker.findUnique({
    where: { id },
    include: { history: { orderBy: { checkedAt: 'desc' }, take: 20 } },
  });
  if (!tracker) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(tracker);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const updates = await req.json();

  console.log('[tracker PATCH] id:', id, 'updates:', JSON.stringify(updates));

  const existing = await prisma.tracker.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const descChanged = updates.description !== undefined &&
    (updates.description ?? '').trim() !== (existing.description ?? '').trim();
  const titleChanged = updates.title !== undefined &&
    (updates.title ?? '').trim() !== (existing.title ?? '').trim();

  // Apply the user's direct edits first
  let updated = await prisma.tracker.update({
    where: { id },
    data: {
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.category !== undefined && { category: updates.category }),
      ...(updates.color !== undefined && { color: updates.color }),
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
      ...(updates.checkFrequency !== undefined && { checkFrequency: updates.checkFrequency }),
      ...(updates.notifyOnChange !== undefined && { notifyOnChange: updates.notifyOnChange }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
    },
    include: { history: { orderBy: { checkedAt: 'desc' }, take: 20 } },
  });

  if (descChanged || titleChanged) {
    console.log('[tracker PATCH] description/title changed — triggering reanalysis');
    try {
      // 1. Re-analyze scope
      const analysis = await reanalyzeTracker({
        title: updated.title,
        description: updated.description,
      });
      console.log('[tracker PATCH] reanalysis result:', JSON.stringify(analysis));

      // 2. Apply new monitor config + tracker type
      updated = await prisma.tracker.update({
        where: { id },
        data: {
          trackerType: analysis.trackerType,
          stepsConfig: analysis.steps ? JSON.stringify(analysis.steps) : null,
          currentStepId: analysis.currentStepId ?? null,
          monitorType: analysis.monitorType ?? 'custom',
          monitorConfig: JSON.stringify(analysis.monitorConfig ?? {}),
          lastCheckError: null,
          consecutiveFails: 0,
        },
        include: { history: { orderBy: { checkedAt: 'desc' }, take: 20 } },
      });

      // 3. Run a fresh check
      console.log('[tracker PATCH] running fresh check');
      await checkTracker(id);

      // 4. Regenerate summary + tailored message
      const freshTracker = await prisma.tracker.findUnique({ where: { id } });
      if (freshTracker) {
        console.log('[tracker PATCH] regenerating meta');
        const meta = await regenerateTrackerMeta({
          title: freshTracker.title,
          description: freshTracker.description,
          trackerType: freshTracker.trackerType,
          currentStatus: freshTracker.currentStatus,
          currentStepId: freshTracker.currentStepId,
          stepsConfig: freshTracker.stepsConfig,
        });
        console.log('[tracker PATCH] meta:', JSON.stringify(meta));

        updated = await prisma.tracker.update({
          where: { id },
          data: {
            summaryLine: meta.summaryLine,
            tailoredMessage: meta.tailoredMessage,
          },
          include: { history: { orderBy: { checkedAt: 'desc' }, take: 20 } },
        });
      }

      // 5. Log reanalysis to history
      await prisma.trackerHistory.create({
        data: {
          trackerId: id,
          status: 'reanalyzed',
          details: 'Tracker scope updated — re-evaluated based on new description',
        },
      });
    } catch (err) {
      console.error('[tracker PATCH] reanalysis failed:', err);
      // Don't fail the request — the user's direct edits already saved
    }
  }

  return NextResponse.json({ tracker: updated, reanalyzed: descChanged || titleChanged });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.tracker.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
