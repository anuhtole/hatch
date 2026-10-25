import { NextResponse } from 'next/server';
import { FELLOWSHIPS } from '@/lib/scrapers/fellowships';
import { RESEARCH_PROGRAMS } from '@/lib/scrapers/research';
import { GRANTS } from '@/lib/scrapers/grants';
import { POLICY_PROGRAMS } from '@/lib/scrapers/policy';

const ALL_OPPORTUNITIES = [
  ...FELLOWSHIPS,
  ...RESEARCH_PROGRAMS,
  ...GRANTS,
  ...POLICY_PROGRAMS,
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');

  const results = category
    ? ALL_OPPORTUNITIES.filter((o) => o.category === category)
    : ALL_OPPORTUNITIES;

  return NextResponse.json({ opportunities: results });
}
