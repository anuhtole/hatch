import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const [total, unenriched, byCategory, byCompany] = await Promise.all([
    prisma.contactEntry.count(),
    prisma.contactEntry.count({ where: { enrichedAt: null } }),
    prisma.contactEntry.groupBy({
      by: ['category'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    prisma.contactEntry.groupBy({
      by: ['company'],
      _count: { id: true },
      where: { company: { not: null } },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    }),
  ]);

  const companiesCount = await prisma.contactEntry.findMany({
    where: { company: { not: null } },
    select: { company: true },
    distinct: ['company'],
  });

  return NextResponse.json({
    total,
    enriched: total - unenriched,
    unenriched,
    companiesCount: companiesCount.length,
    byCategory: byCategory.map((g) => ({
      category: g.category ?? 'Uncategorized',
      count: g._count.id,
    })),
    topCompanies: byCompany.map((g) => ({
      company: g.company ?? '',
      count: g._count.id,
    })),
  });
}
