import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { outDirFor } from '@/lib/resume/out-dir';

/**
 * GET /api/resume/outreach/discovery?lab=<name>
 * Returns the lab's discovery shortlist (out/<lab>/discovery.json), produced by
 * `npm run resume:discover -- --lab=<name>`. Discovery is a SHORTLIST FOR
 * APPROVAL — the user picks recipients in the UI; picks become queue entries.
 */
export async function GET(req: NextRequest) {
  const lab = new URL(req.url).searchParams.get('lab');
  if (!lab || !/^[a-z0-9-]+$/.test(lab)) {
    return NextResponse.json({ error: 'lab query param required ([a-z0-9-])' }, { status: 400 });
  }
  const p = join(outDirFor(lab), 'discovery.json');
  if (!existsSync(p)) {
    return NextResponse.json(
      { error: `no discovery for "${lab}" — run: npm run resume:discover -- --lab=${lab}` },
      { status: 404 },
    );
  }
  const d = JSON.parse(readFileSync(p, 'utf-8'));
  // The UI needs the shortlist, not the crawled page texts.
  return NextResponse.json({
    lab: d.lab,
    rootUrl: d.rootUrl,
    generatedAt: d.generatedAt,
    pagesCrawled: d.fetchedPages?.length ?? 0,
    shortlist: d.shortlist ?? [],
  });
}
