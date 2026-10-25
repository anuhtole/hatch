import { NextRequest, NextResponse } from 'next/server';
import { getBriefing, isBriefingRead } from '@/lib/daily-briefing';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const content = await getBriefing(date);
  if (!content) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isRead = await isBriefingRead(date);
  return NextResponse.json({ date, content, isRead });
}
