import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET — list suggestions (default: current week, open)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const weekOf = searchParams.get('weekOf') ?? currentISOWeek();
  const all = searchParams.get('all') === 'true';

  try {
    const suggestions = await prisma.careerSuggestion.findMany({
      where: {
        weekOf,
        ...(all ? {} : { status: 'open' }),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({ suggestions, weekOf });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function currentISOWeek(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-${String(week).padStart(2, '0')}`;
}
