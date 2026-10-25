import { NextRequest, NextResponse } from 'next/server';
import { executePendingAction, decideVaultMode } from '@/lib/pending-actions';

export async function POST(req: NextRequest) {
  try {
    const { path, content } = await req.json();
    if (!path || !content) {
      return NextResponse.json({ error: 'path and content are required' }, { status: 400 });
    }
    // B-12: wiki saves go through the vault_write executor (path-guarded,
    // backed up, audit-logged). The editor save is an explicit user gesture on
    // the exact content — same direct-executor precedent as the interview flow.
    await executePendingAction('vault_write', {
      path: path as string,
      content: content as string,
      mode: decideVaultMode(path as string),
    });
    return NextResponse.json({ ok: true, path });
  } catch (err) {
    console.error('[wiki/route] writeNote error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
