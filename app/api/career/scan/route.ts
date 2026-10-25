import { NextResponse } from 'next/server';
import { scanPortals } from '@/lib/career-ops';

export const maxDuration = 300;

export async function POST() {
  try {
    const result = await scanPortals();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
