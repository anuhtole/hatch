import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function escapeCSV(val: string | null | undefined): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') ?? '';
  const subcategory = searchParams.get('subcategory') ?? '';
  const search = searchParams.get('search') ?? '';

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (subcategory) where.subcategory = subcategory;
  if (search) {
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { company: { contains: search } },
    ];
  }

  const contacts = await prisma.contactEntry.findMany({
    where,
    orderBy: [{ tier: 'asc' }, { firstName: 'asc' }],
  });

  const headers = [
    'First Name', 'Last Name', 'Email', 'Company', 'Position',
    'School', 'Major', 'LinkedIn URL', 'Category', 'Subcategory',
    'Tier', 'Connected On',
  ];

  const rows = contacts.map((c) => [
    escapeCSV(c.firstName),
    escapeCSV(c.lastName),
    escapeCSV(c.email),
    escapeCSV(c.company),
    escapeCSV(c.position),
    escapeCSV(c.school),
    escapeCSV(c.major),
    escapeCSV(c.linkedinUrl),
    escapeCSV(c.category),
    escapeCSV(c.subcategory),
    escapeCSV(c.tier != null ? String(c.tier) : ''),
    escapeCSV(c.connectedOn),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="network-export.csv"',
    },
  });
}
