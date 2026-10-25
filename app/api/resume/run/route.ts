/**
 * POST /api/resume/run — run the résumé pipeline server-side with streamed progress.
 *
 * Body: { target: string }                              — run an existing targets/<name>.json
 *   or  { def: { name, title?, urls[], pastedText? } }  — persist targets/<name>.json, then run
 *   plus { noResearch?: boolean }
 *
 * Streams NDJSON (same transport as the chat route):
 *   {t:'stage', name, status:'start'|'pass'|'fail', detail?}
 *   {t:'log', line}
 *   {t:'result', targetName, outDir, docxBytes, artifacts:{...}}   (success)
 *   {t:'error', stage, detail}                                     (failed gate — run stops)
 *
 * Fail-fast is identical to the CLI: a failed stage emits 'fail' + 'error' and the
 * stream ends. There is NO parameter to skip or continue past a failed gate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runTarget, resolveTargetCtx, StageError, type PipelineEmit } from '@/lib/resume/run-pipeline';
import { saveTargetDef } from '@/lib/resume/fetch-target';

export const dynamic = 'force-dynamic';

interface RunBody {
  target?: string;
  def?: { name?: string; title?: string; urls?: string[]; pastedText?: string };
  noResearch?: boolean;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as RunBody;

  let targetName = body.target?.trim();
  if (body.def) {
    const name = body.def.name?.trim().toLowerCase();
    if (!name || !NAME_RE.test(name)) {
      return NextResponse.json({ error: 'def.name must be a short alphanumeric id' }, { status: 400 });
    }
    try {
      // Shared with the resume_tailor chat tool (B-11) — one def-persist implementation.
      saveTargetDef({ name, title: body.def.title, urls: body.def.urls ?? [], pastedText: body.def.pastedText });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    targetName = name;
  }
  if (!targetName || !NAME_RE.test(targetName)) {
    return NextResponse.json({ error: 'pass { target } or { def }' }, { status: 400 });
  }

  const argv = body.noResearch ? ['--no-research'] : [];
  const encoder = new TextEncoder();
  const name = targetName;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      const emit: PipelineEmit = {
        log: (line) => send({ t: 'log', line }),
        stage: (stageName, status, detail) => send({ t: 'stage', name: stageName, status, detail }),
      };
      try {
        const ctx = await resolveTargetCtx(name);
        const result = await runTarget(ctx, emit, ['', '', ...argv]);
        send({
          t: 'result',
          targetName: result.targetName,
          docxBytes: result.docxBytes,
          artifacts: {
            resume: `/api/resume/artifact/${name}/tailored-resume.docx`,
            resumePdf: `/api/resume/artifact/${name}/resume.pdf`,
            coverLetter: `/api/resume/artifact/${name}/cover-letter.docx`,
            png: `/api/resume/artifact/${name}/visual/tailored-resume.docx.png`,
            gapReport: `/api/resume/artifact/${name}/gap-report.json`,
            skillsToLearn: `/api/resume/artifact/${name}/skills-to-learn.json`,
            selectionDiff: `/api/resume/artifact/selection-diff.md`,
          },
        });
      } catch (err) {
        if (err instanceof StageError) {
          send({ t: 'error', stage: err.stage, detail: err.detail });
        } else {
          send({ t: 'error', stage: 'uncaught', detail: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  });
}
