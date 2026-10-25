import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = { params: Promise<{ id: string }> };

// PATCH /api/conversations/[id] — rename or toggle favorited
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: { title?: string; favorited?: boolean; memoryExcluded?: boolean } = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.favorited !== undefined) data.favorited = body.favorited;
  if (body.memoryExcluded !== undefined) data.memoryExcluded = body.memoryExcluded;

  const conversation = await prisma.conversation.update({
    where: { id },
    data,
  });

  return NextResponse.json(conversation);
}

// DELETE /api/conversations/[id] — delete with all messages (cascade)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  await prisma.conversation.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
