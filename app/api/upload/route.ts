/**
 * app/api/upload/route.ts
 *
 * Accepts any file up to 50 MB, extracts content via lib/file-extractor,
 * stores the file locally, creates a KnowledgeDocument stub (content = ''),
 * and returns the extracted text + metadata for the approval modal.
 *
 * The ingest route (api/knowledge/ingest) finalises the record on user approval.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { extractFileContent } from '@/lib/file-extractor';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File exceeds 50 MB limit.' }, { status: 400 });
    }

    // Save to disk
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${timestamp}_${cleanName}`;
    const filePath = path.join(uploadsDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const publicUrl = `/uploads/${filename}`;

    // Extract content
    const extraction = await extractFileContent(buffer, file.type, file.name);

    // Create stub KnowledgeDocument (content filled on approval)
    const doc = await prisma.knowledgeDocument.create({
      data: {
        title: file.name,
        source: 'chat',
        sourceUrl: publicUrl,
        content: '',
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      },
    });

    return NextResponse.json(
      {
        id: doc.id,
        url: publicUrl,
        filename: file.name,
        size: file.size,
        mimeType: file.type,
        extractedText: extraction.extractedText,
        extractedPreview: extraction.extractedPreview,
        pageCount: extraction.pageCount,
        wordCount: extraction.wordCount,
        method: extraction.method,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[upload]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
