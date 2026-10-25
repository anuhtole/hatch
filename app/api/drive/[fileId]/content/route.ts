import { NextRequest, NextResponse } from 'next/server';
import { getDriveFileContent } from '@/lib/google-drive';
import { AuthError } from '@/lib/google-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name') ?? undefined;

  try {
    const content = await getDriveFileContent(fileId, name);
    return NextResponse.json({ content });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read file';
    console.error('[drive/[fileId]/content]', error);
    const status = error instanceof AuthError ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
