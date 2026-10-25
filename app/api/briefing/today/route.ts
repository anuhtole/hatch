import { NextResponse } from 'next/server';
import { getOrGenerateBriefing, todayDate, isBriefingRead } from '@/lib/daily-briefing';

export const maxDuration = 300;

export async function GET() {
  try {
    const date = todayDate();
    const content = await getOrGenerateBriefing(date);
    const isRead = await isBriefingRead(date);
    return NextResponse.json({
      date,
      raw: content,
      highlights: content.highlights ?? [],
      isRead,
    });
  } catch (err) {
    console.error('[briefing/today] getOrGenerateBriefing threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
