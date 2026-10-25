import { NextResponse } from 'next/server';
import { markBriefingRead, todayDate } from '@/lib/daily-briefing';

export async function POST() {
  const date = todayDate();
  await markBriefingRead(date);
  return NextResponse.json({ ok: true, date });
}
