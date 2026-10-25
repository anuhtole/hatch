import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ATTACH_DIR = path.join(process.cwd(), '.tmp', 'email-attachments');
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File exceeds 25 MB limit' }, { status: 400 });

    if (!existsSync(ATTACH_DIR)) await mkdir(ATTACH_DIR, { recursive: true });

    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${Date.now()}_${cleanName}`;
    const filePath = path.join(ATTACH_DIR, filename);

    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({
      filePath,
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || 'application/octet-stream',
    });
  } catch (err) {
    console.error('[email/attachments POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
