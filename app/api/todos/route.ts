import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const todos = await prisma.todo.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'desc' }] });
  return NextResponse.json({ todos });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { text, priority, dueDate } = body;
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 });

  // Set order to be last
  const last = await prisma.todo.findFirst({ orderBy: { order: 'desc' } });
  const order = (last?.order ?? -1) + 1;

  const todo = await prisma.todo.create({
    data: {
      text: text.trim(),
      priority: priority ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      order,
    },
  });
  return NextResponse.json({ todo }, { status: 201 });
}
