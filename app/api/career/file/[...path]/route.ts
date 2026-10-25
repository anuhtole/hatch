/**
 * app/api/career/file/[...path]/route.ts
 *
 * Serves PDF files from CAREER_OPS_PATH/output/.
 * Path traversal is blocked — resolved path must remain inside basePath.
 *
 * Usage: GET /api/career/file/cover-letters/acme-swe-2026-04-22.pdf
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readFile } from 'fs/promises';

const CAREER_OPS_PATH = process.env.CAREER_OPS_PATH || path.join(process.env.HOME || '', 'career-ops');
const BASE_PATH = path.join(CAREER_OPS_PATH, 'output');

type Params = { params: Promise<{ path: string[] }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { path: segments } = await params;

  // Reconstruct and resolve the requested path
  const relative = segments.join('/');
  const fullPath = path.resolve(BASE_PATH, relative);

  // Path traversal guard
  if (!fullPath.startsWith(BASE_PATH + path.sep) && fullPath !== BASE_PATH) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let data: Buffer;
  try {
    data = await readFile(fullPath);
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
  const filename = path.basename(fullPath);

  return new NextResponse(data as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}
