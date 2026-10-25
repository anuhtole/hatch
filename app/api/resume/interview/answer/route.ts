/**
 * POST /api/resume/interview/answer
 *
 * Body: { question, requirement, answer, entitySourcePath?: string|null }
 *
 * Turns one VERBATIM user-typed interview answer into a PendingAction
 * (type 'vault_write') whose payload IS the exact content that will be appended
 * to the vault. Nothing is written here — the user approves/discards via the
 * standard PendingActionCard, and the approve route's executeVaultWrite performs
 * the write (path-escape defense + audit log), exactly like every other vault
 * write in Hatch.
 *
 * TRUST: no model call; the claim block is built mechanically by
 * interview-core.buildVaultWrite (verbatim answer + annotation + substring-
 * verified extracted tokens). Hatch never proposes or pre-fills an answer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPendingAction } from '@/lib/pending-actions';
import { buildVaultWrite, isKnownEntityPath, extractTokens } from '@/lib/resume/interview-core';

export const dynamic = 'force-dynamic';

interface AnswerBody {
  question?: string;
  requirement?: string;
  answer?: string;
  entitySourcePath?: string | null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AnswerBody;
  const question = body.question?.trim();
  const answer = body.answer?.trim();
  if (!question || !answer) {
    return NextResponse.json({ error: 'question and answer are required' }, { status: 400 });
  }

  let entityPath: string | null = body.entitySourcePath?.trim() || null;
  if (entityPath && !isKnownEntityPath(entityPath)) {
    return NextResponse.json({ error: `unknown entity file: ${entityPath}` }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let payload;
  try {
    payload = buildVaultWrite(answer, question, entityPath, today);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const { id, summary } = await createPendingAction('vault_write', payload);

  return NextResponse.json({
    id,
    summary,
    payload, // the EXACT bytes the approve will write — the card shows these
    extractedTokens: extractTokens(answer),
  });
}
