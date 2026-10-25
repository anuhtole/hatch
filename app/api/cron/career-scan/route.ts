import { NextResponse } from 'next/server';
import { scanPortals } from '@/lib/career-ops';

export const maxDuration = 300;

// Called by Vercel Cron at 05:00 Europe/Madrid (UTC+2 in summer = 03:00 UTC)
// vercel.json: { "path": "/api/cron/career-scan", "schedule": "0 3 * * *" }
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await scanPortals();
    console.log(`[cron/career-scan] Scanned ${result.companyCount} companies, found ${result.newJobs.length} new jobs`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/career-scan] scanPortals threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
