import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';

function cvPath() {
  const base = process.env.CAREER_OPS_PATH || path.join(os.homedir(), 'career-ops');
  return path.join(base, 'cv.md');
}

export async function GET() {
  try {
    const content = await readFile(cvPath(), 'utf-8');
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ content: '' });
  }
}

export async function PATCH(req: Request) {
  try {
    const { content } = await req.json() as { content: string };
    if (typeof content !== 'string') return NextResponse.json({ error: 'content required' }, { status: 400 });
    await writeFile(cvPath(), content, 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
