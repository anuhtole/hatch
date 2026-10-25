import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { executePendingAction } from '@/lib/pending-actions';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json() as {
      status?: string;
      notes?: string;
      score?: string;
      deadline?: string;
    };
    const card = await prisma.pipelineCard.update({
      where: { id },
      data: {
        ...(body.status   !== undefined && { status: body.status }),
        ...(body.notes    !== undefined && { notes: body.notes }),
        ...(body.score    !== undefined && { score: body.score }),
        ...(body.deadline !== undefined && { deadline: body.deadline }),
      },
    });

    // Update memory when status changes (key career milestones)
    if (body.status) {
      const memKey = `application:${card.org.toLowerCase().replace(/\s+/g, '_')}:${card.role.toLowerCase().replace(/\s+/g, '_')}`;
      executePendingAction('memory_write', {
        category: 'career', key: memKey, value: JSON.stringify({ org: card.org, role: card.role, type: card.type, status: card.status, updatedAt: new Date().toISOString() }), store: 'db',
      }).catch(() => { /* non-blocking; B-12: executor is the sole Memory-table writer */ });
    }

    return NextResponse.json({ card });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    await prisma.pipelineCard.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
