/**
 * GET /api/resume/interview/questions?target=<name>
 *
 * Open (non-suppressed) gap-report questions for a target, verbatim, plus the
 * entity files an answer may attach to. NO model call — questions come straight
 * from out/<target>/gap-report.json (trust rule: Hatch asks, never proposes).
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { outDirFor } from '@/lib/resume/out-dir';
import { openQuestions, entityTargets, GENERAL_REL } from '@/lib/resume/interview-core';
import type { GapReport } from '@/lib/resume/gap-report';

export const dynamic = 'force-dynamic';

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target') ?? '';
  if (!NAME_RE.test(target)) return NextResponse.json({ error: 'bad target' }, { status: 400 });

  const gapPath = join(outDirFor(target), 'gap-report.json');
  if (!existsSync(gapPath)) {
    return NextResponse.json({ error: `no gap report for "${target}" — run the pipeline first` }, { status: 404 });
  }
  const gap = JSON.parse(readFileSync(gapPath, 'utf-8')) as GapReport;
  const open = openQuestions(gap);

  return NextResponse.json({
    target,
    total: gap.questions.length,
    suppressed: gap.questions.length - open.length,
    questions: open,
    entities: entityTargets().map((e) => ({ name: e.name, kind: e.kind, sourcePath: e.sourcePath })),
    generalPath: GENERAL_REL,
  });
}
