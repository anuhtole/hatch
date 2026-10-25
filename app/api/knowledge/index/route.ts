import { NextRequest, NextResponse } from 'next/server';
import { runIndexJob, type IndexSource } from '@/lib/indexer';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sources: IndexSource[] = body.sources ?? ['all'];

  // Validate sources
  const valid: IndexSource[] = ['vault', 'downloads', 'upload', 'gmail', 'drive', 'all'];
  const bad = sources.filter((s) => !valid.includes(s));
  if (bad.length) {
    return NextResponse.json(
      { error: `Unknown source(s): ${bad.join(', ')}. Valid: ${valid.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const results = await runIndexJob(sources);
    return NextResponse.json({ success: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/knowledge/index]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
