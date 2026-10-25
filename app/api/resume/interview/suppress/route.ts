/**
 * POST /api/resume/interview/suppress — "don't ask again" for one gap question.
 * Body: { requirement, question }. Writes a suppression (a dotfile entry the
 * pool discovery can never pick up), never a claim. Shared with the CLI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { addSuppression, loadSuppressions } from '@/lib/resume/interview-core';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { requirement?: string; question?: string };
  const requirement = body.requirement?.trim();
  const question = body.question?.trim();
  if (!requirement || !question) {
    return NextResponse.json({ error: 'requirement and question are required' }, { status: 400 });
  }
  addSuppression(requirement, question, new Date().toISOString().slice(0, 10));
  return NextResponse.json({ ok: true, suppressed: loadSuppressions().length });
}
