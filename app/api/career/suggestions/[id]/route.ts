import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = { params: Promise<{ id: string }> };

// PATCH — update status (done/dismissed) or fields
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json() as { status?: string; priority?: string };
    const suggestion = await prisma.careerSuggestion.update({
      where: { id },
      data: {
        ...(body.status   !== undefined && { status: body.status }),
        ...(body.priority !== undefined && { priority: body.priority }),
      },
    });
    return NextResponse.json({ suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — remove a suggestion
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    await prisma.careerSuggestion.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
