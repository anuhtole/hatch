import { NextRequest, NextResponse } from 'next/server';
import { searchKnowledge, addDocument } from '@/lib/knowledge';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);

  try {
    if (q.trim()) {
      const documents = await searchKnowledge(q, limit);
      return NextResponse.json({ documents });
    }

    const documents = await prisma.knowledgeDocument.findMany({
      take: limit,
      orderBy: { lastSyncedAt: 'desc' },
      select: {
        id: true,
        title: true,
        source: true,
        courseName: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        lastSyncedAt: true,
        content: true,
      },
    });

    return NextResponse.json({ documents });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Query failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { title, content, source, metadata } = await req.json();

  if (!title || !content || !source) {
    return NextResponse.json(
      { error: 'Missing required fields: title, content, source' },
      { status: 400 }
    );
  }

  try {
    const doc = await addDocument(title, content, source, metadata ?? {});
    return NextResponse.json({ document: doc });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add document';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
