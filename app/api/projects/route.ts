import { NextResponse } from 'next/server';
import { listClaudeCodeProjects } from '@/lib/projects';

export async function GET() {
  try {
    const projects = await listClaudeCodeProjects();
    return NextResponse.json({ projects });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
