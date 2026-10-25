import { NextResponse } from 'next/server';
import { runIdleExtraction } from '@/lib/memory-scheduler';

/**
 * POST /api/memory/extract-idle
 *
 * Manual trigger for the idle-conversation memory extraction sweep.
 * Useful for testing and debugging — mirrors exactly what the instrumentation
 * scheduler calls every 2 minutes.
 */
export async function POST() {
  try {
    const result = await runIdleExtraction();
    return NextResponse.json({
      ok: true,
      processed: result.processed.length,
      errors: result.errors.length,
      detail: result,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
