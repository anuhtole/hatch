import { prisma } from './prisma';
import { getCourses, getCourseFiles, downloadFile } from './canvas';

export async function syncCanvasFiles() {
  const courses = await getCourses();
  let documentsFound = 0;

  for (const course of courses) {
    const files = await getCourseFiles(course.id);

    for (const file of files) {
      // Only process text-based files for now
      const contentType: string = file.content_type ?? '';
      const isText =
        contentType.includes('text') ||
        contentType.includes('pdf') ||
        (file.filename ?? '').endsWith('.md') ||
        (file.filename ?? '').endsWith('.txt');

      if (!isText) continue;

      try {
        const buffer = await downloadFile(file.url);
        const content = buffer.toString('utf-8').slice(0, 50000); // cap at 50k chars

        await prisma.knowledgeDocument.upsert({
          where: { sourceId: `canvas-${file.id}` } as any,
          create: {
            title: file.display_name,
            source: 'canvas',
            sourceId: `canvas-${file.id}`,
            sourceUrl: file.url,
            content,
            courseName: course.name,
            fileName: file.filename,
            fileType: contentType || null,
            fileSize: file.size,
            lastSyncedAt: new Date(),
          },
          update: {
            content,
            lastSyncedAt: new Date(),
          },
        });

        documentsFound++;
      } catch {
        // Skip files that can't be read as text
      }
    }
  }

  await prisma.syncLog.create({
    data: {
      source: 'canvas',
      status: 'success',
      documentsFound,
      message: `Synced ${documentsFound} files from ${courses.length} courses`,
    },
  });

  return { documentsFound, courses: courses.length };
}

export async function searchKnowledge(query: string, limit = 5) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (terms.length === 0) return [];

  const docs = await prisma.knowledgeDocument.findMany({
    take: limit * 10,
    orderBy: { lastSyncedAt: 'desc' },
  });

  // Simple scoring: count term occurrences, with boost for manual/identity docs
  const scored = docs.map((doc) => {
    const text = `${doc.title} ${doc.content} ${doc.courseName ?? ''} ${doc.category ?? ''}`.toLowerCase();
    const score = terms.reduce((sum, term) => {
      const matches = (text.match(new RegExp(term, 'g')) ?? []).length;
      return sum + matches;
    }, 0);
    // Boost manually curated docs (resume, wiki pages) so they surface reliably
    const sourceBoost = doc.source === 'manual' ? 5 : 0;
    return { ...doc, score: score + sourceBoost };
  });

  return scored
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function getRelevantContext(userMessage: string): Promise<string> {
  const msg = userMessage.toLowerCase();

  // Always inject resume when identity/professional context is needed
  const resumeKeywords = ['resume', 'experience', 'microsoft', 'pitchbook', 'nielsen', 'dialpad', 'warner', 'internship', 'application', 'apply', 'background', 'skills', 'outreach', 'cover letter'];
  const wantsResume = resumeKeywords.some((kw) => msg.includes(kw));

  let docs = await searchKnowledge(userMessage, wantsResume ? 4 : 3);

  // If resume was requested but not in top results, force-include it
  if (wantsResume && !docs.some((d) => d.sourceId === 'manual-resume-anatole-seychal')) {
    const resume = await prisma.knowledgeDocument.findFirst({
      where: { sourceId: 'manual-resume-anatole-seychal' },
    });
    if (resume) docs = [{ ...resume, score: 999 }, ...docs].slice(0, 4);
  }

  if (docs.length === 0) return '';

  return docs
    .map(
      (doc) =>
        `[${doc.source.toUpperCase()}${doc.category ? `·${doc.category.toUpperCase()}` : ''}] ${doc.title}${doc.courseName ? ` (${doc.courseName})` : ''}:\n${doc.content.slice(0, 2000)}`
    )
    .join('\n\n---\n\n');
}

// Cross-reference a contact's employer against Anatole's resume companies.
// Returns a note string if there's a match, empty string otherwise.
// Used during email sync enrichment.
export function crossReferenceWithResume(contactCompany: string): string {
  const RESUME_COMPANIES: Record<string, string> = {
    microsoft: 'Anatole interned as PM at Microsoft (Summer 2025) — built the AI Reviewer Agent for Power Apps.',
    pitchbook: 'Anatole was Project Manager at PitchBook (Spring 2025) — led 6-consultant team.',
    nielsen: 'Anatole interned as Technical PM at Nielsen (Fall 2024).',
    dialpad: 'Anatole interned as PM at Dialpad (Summer 2024) — led multilingual product expansion.',
    'warner bros': 'Anatole consulted at Warner Bros. (Spring 2024) on product strategy for college engagement.',
    'warner brothers': 'Anatole consulted at Warner Bros. (Spring 2024) on product strategy for college engagement.',
    berkeley: 'Anatole attends UC Berkeley.',
    uc3m: 'Anatole is studying abroad at UC3M Madrid (2025–2026).',
  };
  const lower = contactCompany.toLowerCase();
  for (const [key, note] of Object.entries(RESUME_COMPANIES)) {
    if (lower.includes(key)) return note;
  }
  return '';
}

export async function addDocument(
  title: string,
  content: string,
  source: 'canvas' | 'gmail' | 'drive' | 'manual',
  metadata: {
    sourceId?: string;
    sourceUrl?: string;
    category?: string;
    courseName?: string;
    fileName?: string;
    fileType?: string;
    fileSize?: number;
  } = {}
) {
  return prisma.knowledgeDocument.create({
    data: {
      title,
      source,
      content,
      lastSyncedAt: new Date(),
      ...metadata,
    },
  });
}
