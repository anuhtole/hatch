import { NextResponse } from 'next/server';
import { generateBriefing, todayDate } from '@/lib/daily-briefing';

export const maxDuration = 300;

export async function POST() {
  try {
    const date = todayDate();
    const content = await generateBriefing(date);
    return NextResponse.json({ date, content, isRead: false });
  } catch (err) {
    console.error('[briefing/regenerate] generateBriefing threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
