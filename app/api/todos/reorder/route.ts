import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/todos/reorder
// Body: { items: Array<{ id: string; order: number }> }
export async function POST(req: NextRequest) {
  const { items } = await req.json();
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 });
  }

  await Promise.all(
    items.map(({ id, order }: { id: string; order: number }) =>
      prisma.todo.update({ where: { id }, data: { order } })
    )
  );

  return NextResponse.json({ ok: true });
}
