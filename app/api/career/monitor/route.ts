import { NextResponse } from 'next/server';
import { runEmailMonitor } from '@/lib/application-email-monitor';

// POST /api/career/monitor
// Trigger a Gmail scan for application-related emails and update pipeline card statuses.
// Can be called manually from the UI or via a scheduled cron in instrumentation.ts.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { lookbackHours?: number; account?: string };
    const lookbackHours = Number(body.lookbackHours ?? 24);
    const account = String(body.account ?? 'berkeley');

    const result = await runEmailMonitor(account, lookbackHours);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[career/monitor] Error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// GET — lightweight status endpoint (returns count of active pipeline cards)
export async function GET() {
  const { prisma } = await import('@/lib/prisma');
  const active = await prisma.pipelineCard.count({
    where: { status: { in: ['applied', 'interviewing'] } },
  });
  return NextResponse.json({ activeCards: active });
}
