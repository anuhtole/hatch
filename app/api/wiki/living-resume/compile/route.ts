import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/prisma';

// POST /api/wiki/living-resume/compile
// Re-reads all sources and stores a compiled snapshot as a KnowledgeDocument.
export async function POST() {
  const resumePath = join(process.cwd(), 'wiki', 'raw', 'resume-anatole-seychal.md');
  const hubPath = join(process.cwd(), 'wiki', 'topics', 'anatole-seychal.md');

  let compiledContent = '';

  if (existsSync(resumePath)) {
    compiledContent += readFileSync(resumePath, 'utf-8');
  }
  if (existsSync(hubPath)) {
    compiledContent += '\n\n---\n\n' + readFileSync(hubPath, 'utf-8');
  }

  // Pull recent knowledge docs
  const recentDocs = await prisma.knowledgeDocument.findMany({
    where: { source: { not: 'manual' } },
    orderBy: { lastSyncedAt: 'desc' },
    take: 30,
    select: { title: true, content: true, source: true, category: true },
  });

  const supplement = recentDocs
    .map((d) => `### ${d.title}\n${d.content.slice(0, 500)}`)
    .join('\n\n');

  compiledContent += supplement ? '\n\n---\n\n## Recent Knowledge\n\n' + supplement : '';

  // Upsert as KnowledgeDocument
  await prisma.knowledgeDocument.upsert({
    where: { sourceId: 'living-resume-compiled' } as never,
    create: {
      title: 'Living Resume — Compiled',
      source: 'manual',
      sourceId: 'living-resume-compiled',
      content: compiledContent,
      category: 'professional',
      lastSyncedAt: new Date(),
    },
    update: {
      content: compiledContent,
      lastSyncedAt: new Date(),
    },
  });

  return NextResponse.json({ compiled: true, compiledAt: new Date().toISOString() });
}
