import { NextRequest, NextResponse } from 'next/server';
import { checkTracker } from '@/lib/tracker';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await checkTracker(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
