import { NextResponse } from 'next/server';
import { dailyRealityCheck } from '@/lib/memory-scheduler';

export const runtime = 'nodejs';
export const maxDuration = 120;

function checkAuth(req: Request): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

async function run(): Promise<NextResponse> {
  try {
    const result = await dailyRealityCheck();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[reality-check] failed:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

/**
 * GET /api/memory/reality-check
 * Called by Vercel Cron at 04:00 UTC (6am Madrid time) — before briefing generation.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

/**
 * POST /api/memory/reality-check
 * Manual trigger — for /memory refresh command and the settings UI.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
