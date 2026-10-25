import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateChatTitle } from '@/lib/auto-name';

type Params = { params: Promise<{ id: string }> };

// POST /api/conversations/[id]/auto-name
//
// Fire-and-forget endpoint invoked by the chat client once the first user
// message has been sent. Generates a concise 4-5 word title via Haiku and
// persists it to the conversation row. Returns the new title.
//
// Safe to call concurrently with a streaming chat — only touches the
// conversation row's `title` field, not message rows. Idempotent: if the
// conversation already has a non-default title (e.g. a manual rename
// happened first), this is a no-op.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const firstMessage: string = body.firstMessage ?? '';

  if (!firstMessage.trim()) {
    return NextResponse.json({ error: 'firstMessage required' }, { status: 400 });
  }

  const existing = await prisma.conversation.findUnique({
    where: { id },
    select: { title: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Skip if the title looks like it's already been customized. The chat
  // route seeds new conversations with the first message snippet (up to
  // 60 chars). We replace that, but leave anything that's been manually
  // renamed or already auto-named.
  const snippetSeed = firstMessage.trim().slice(0, 60);
  if (existing.title !== 'New Chat' && existing.title !== snippetSeed) {
    return NextResponse.json({ title: existing.title, skipped: true });
  }

  const title = await generateChatTitle(firstMessage);

  const updated = await prisma.conversation.update({
    where: { id },
    data: { title },
    select: { id: true, title: true },
  });

  return NextResponse.json(updated);
}
