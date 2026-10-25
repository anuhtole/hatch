import { NextRequest, NextResponse } from 'next/server';
import { searchDriveFiles, listDriveFiles } from '@/lib/google-drive';
import { AuthError } from '@/lib/google-auth';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  try {
    const files = q ? await searchDriveFiles(q) : await listDriveFiles(undefined, 20);
    return NextResponse.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Drive search failed';
    console.error('[drive/search]', error);
    const status = error instanceof AuthError ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
