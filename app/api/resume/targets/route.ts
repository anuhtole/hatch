/**
 * GET /api/resume/targets — list targets/*.json with artifact state, so the UI
 * can offer existing targets and link finished runs.
 */

import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const dynamic = 'force-dynamic';

export async function GET() {
  const targetsDir = join(homedir(), 'hatch', 'targets');
  const outDir = join(homedir(), 'hatch', 'out');
  let names: string[] = [];
  try {
    names = readdirSync(targetsDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  } catch { /* no targets dir yet */ }

  const targets = names.map((name) => {
    // B-44: read the RAW target JSON (which carries `labRoot` for research targets);
    // the TargetDef type strips it, so we read it here and derive `kind` read-only.
    // Research targets (chai/bair) carry labRoot; industry targets (industry-pm) don't.
    // New user-created targets have no labRoot → default 'industry' (acceptable for B-44).
    let def: { title?: string; urls?: string[]; pastedText?: string; labRoot?: string } = {};
    try { def = JSON.parse(readFileSync(join(targetsDir, `${name}.json`), 'utf-8')); } catch { /* unreadable */ }
    const docx = join(outDir, name, 'tailored-resume.docx');
    const gap = join(outDir, name, 'gap-report.json');
    return {
      name,
      title: def.title ?? name,
      urls: def.urls ?? [],
      kind: def.labRoot ? 'research' : 'industry',
      hasPastedText: Boolean(def.pastedText?.trim()),
      hasRun: existsSync(docx),
      hasGapReport: existsSync(gap),
      lastRunAt: existsSync(docx) ? statSync(docx).mtime.toISOString() : null,
    };
  });

  return NextResponse.json({ targets, hasSelectionDiff: existsSync(join(outDir, 'selection-diff.md')) });
}
