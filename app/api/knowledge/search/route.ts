import { NextRequest, NextResponse } from 'next/server';
import { semanticSearch } from '@/lib/indexer';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 50);
  const sources = searchParams.get('sources')?.split(',').filter(Boolean);

  if (!q.trim()) {
    return NextResponse.json({ error: 'Missing query parameter ?q=' }, { status: 400 });
  }

  try {
    const results = await semanticSearch(q, { limit, sources });
    return NextResponse.json({
      query: q,
      results: results.map((r) => ({
        id: r.item.id,
        source: r.item.source,
        sourceId: r.item.sourceId,
        title: r.item.title,
        similarity: Math.round(r.similarity * 1000) / 1000,
        excerpt: r.item.content.slice(0, 500),
        metadata: r.item.metadata ? JSON.parse(r.item.metadata) : null,
        indexedAt: r.item.indexedAt,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
