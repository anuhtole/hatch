import { NextResponse } from 'next/server';
import { evaluateJob } from '@/lib/career-ops';

export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const { url } = await req.json() as { url: string };
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
    const result = await evaluateJob(url);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
