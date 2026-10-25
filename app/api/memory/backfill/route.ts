import { NextResponse } from 'next/server';
import { backfillFrontmatter } from '@/lib/vault-writer';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    const results = await backfillFrontmatter();
    return NextResponse.json({ ok: true, filesUpdated: results.length, results });
  } catch (err: unknown) {
    console.error('[backfill] failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
