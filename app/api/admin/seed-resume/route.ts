import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/prisma';

// POST /api/admin/seed-resume
// One-time route to insert the resume and wiki hub page as KnowledgeDocuments.
// Call once after first setup: curl -X POST http://localhost:3000/api/admin/seed-resume
export async function POST() {
  const results: string[] = [];

  const docs = [
    {
      filePath: 'wiki/raw/resume-anatole-seychal.md',
      title: 'Anatole Seychal — Resume',
      source: 'manual' as const,
      sourceId: 'manual-resume-anatole-seychal',
      category: 'professional',
    },
    {
      filePath: 'wiki/topics/anatole-seychal.md',
      title: 'Anatole Seychal — Wiki Hub',
      source: 'manual' as const,
      sourceId: 'manual-wiki-anatole-seychal',
      category: 'identity',
    },
  ];

  for (const doc of docs) {
    try {
      const content = readFileSync(join(process.cwd(), doc.filePath), 'utf-8');

      await prisma.knowledgeDocument.upsert({
        where: { sourceId: doc.sourceId } as never,
        create: {
          title: doc.title,
          source: doc.source,
          sourceId: doc.sourceId,
          content,
          category: doc.category,
          lastSyncedAt: new Date(),
        },
        update: {
          content,
          lastSyncedAt: new Date(),
        },
      });

      results.push(`✓ ${doc.title}`);
    } catch (err) {
      results.push(`✗ ${doc.title}: ${err}`);
    }
  }

  return NextResponse.json({ seeded: results });
}
