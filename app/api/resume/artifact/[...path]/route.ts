/**
 * GET /api/resume/artifact/[...path] — serve pipeline artifacts from ~/hatch/out/.
 *
 * e.g. /api/resume/artifact/bair/tailored-resume.docx
 *      /api/resume/artifact/chai/visual/tailored-resume.docx.png
 *      /api/resume/artifact/selection-diff.md
 *
 * Path traversal is blocked (resolved path must stay inside out/). Auth posture
 * matches the rest of this personal, local-only app (no session layer exists);
 * the route serves nothing outside out/ and follows the same pattern as
 * /api/career/file/[...path].
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readFile } from 'fs/promises';
import os from 'os';
import { loadLastGreen } from '@/lib/resume/last-green';

const BASE_PATH = path.join(os.homedir(), 'hatch', 'out');

// B-13: artifacts tracked by last-green get their hashes RE-VERIFIED on every
// fetch — a stale/tampered/mid-rerun file 409s instead of being served.
const VERIFIED_FILES = new Set(['tailored-resume.docx', 'resume.pdf']);

const CONTENT_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
};

type Params = { params: Promise<{ path: string[] }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { path: segments } = await params;
  const relative = segments.join('/');
  const fullPath = path.resolve(BASE_PATH, relative);

  if (!fullPath.startsWith(BASE_PATH + path.sep) && fullPath !== BASE_PATH) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Hash re-verification for last-green-tracked artifacts (<target>/<file>).
  if (segments.length === 2 && VERIFIED_FILES.has(segments[1])) {
    try {
      loadLastGreen(segments[0]); // throws on missing record or hash mismatch
    } catch (err) {
      return new NextResponse(
        `Artifact verification failed: ${err instanceof Error ? err.message : String(err)}`,
        { status: 409 },
      );
    }
  }

  let data: Buffer;
  try {
    data = await readFile(fullPath);
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const filename = path.basename(fullPath);
  const disposition = ext === '.png' || ext === '.md' || ext === '.json' ? 'inline' : 'attachment';

  return new NextResponse(data as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    },
  });
}
