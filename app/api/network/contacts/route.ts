import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  companyPrestige,
  schoolPrestige,
  seniority,
  TIER_LABELS,
} from '@/lib/network-categorizer';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') ?? '';
  const subcategory = searchParams.get('subcategory') ?? '';
  const school = searchParams.get('school') ?? '';
  const company = searchParams.get('company') ?? '';
  const search = searchParams.get('search') ?? '';
  const sort = searchParams.get('sort') ?? 'tier'; // tier | name | company | school

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (subcategory) where.subcategory = subcategory;
  if (school) where.school = { contains: school };
  if (company) where.company = { contains: company };
  if (search) {
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { company: { contains: search } },
      { position: { contains: search } },
    ];
  }

  const contacts = await prisma.contactEntry.findMany({
    where,
    orderBy: sort === 'name'
      ? [{ firstName: 'asc' }, { lastName: 'asc' }]
      : sort === 'company'
        ? [{ company: 'asc' }, { firstName: 'asc' }]
        : sort === 'school'
          ? [{ school: 'asc' }, { firstName: 'asc' }]
          : [{ tier: 'asc' }, { firstName: 'asc' }],
  });

  // Secondary sort for tier: school prestige → company prestige → seniority
  if (sort === 'tier') {
    contacts.sort((a, b) => {
      if ((a.tier ?? 99) !== (b.tier ?? 99)) return (a.tier ?? 99) - (b.tier ?? 99);
      const presA = schoolPrestige(a.school) + companyPrestige(a.company) + seniority(a.position);
      const presB = schoolPrestige(b.school) + companyPrestige(b.company) + seniority(b.position);
      return presB - presA;
    });
  }

  return NextResponse.json({ contacts, total: contacts.length });
}
