import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const { text, completed, priority, dueDate, notes, links, order } = body;

  const todo = await prisma.todo.update({
    where: { id },
    data: {
      ...(text !== undefined      ? { text }      : {}),
      ...(completed !== undefined ? { completed } : {}),
      ...(priority !== undefined  ? { priority }  : {}),
      ...(dueDate !== undefined   ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      ...(notes !== undefined     ? { notes }     : {}),
      ...(links !== undefined     ? { links: links ? JSON.stringify(links) : null } : {}),
      ...(order !== undefined     ? { order }     : {}),
    },
  });
  return NextResponse.json({ todo });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.todo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
