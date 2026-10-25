import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/conversations — list all, with preview of last message
export async function GET() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      favorited: c.favorited,
      preview: c.messages[0]?.content.slice(0, 80) ?? '',
      messageCount: c._count.messages,
      memoryExcluded: c.memoryExcluded,
    })),
  });
}

// POST /api/conversations — create a new conversation
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title: string = body.title ?? 'New Chat';

  const conversation = await prisma.conversation.create({
    data: { title },
  });

  return NextResponse.json(conversation, { status: 201 });
}
