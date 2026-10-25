import { NextResponse } from 'next/server';
import { generateBriefing, todayDate } from '@/lib/daily-briefing';

export const maxDuration = 300;

// Called by Vercel Cron at 07:00 Europe/Madrid (UTC+2 in summer = 05:00 UTC)
// vercel.json: { "crons": [{ "path": "/api/cron/briefing", "schedule": "0 5 * * *" }] }
export async function GET(req: Request) {
  // Verify the request is from Vercel Cron in production
  const authHeader = req.headers.get('authorization');
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const date = todayDate();
    const content = await generateBriefing(date);
    return NextResponse.json({ ok: true, date, generatedAt: content.generatedAt });
  } catch (err) {
    console.error('[cron/briefing] generateBriefing threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
