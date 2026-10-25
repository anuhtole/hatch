import { NextRequest, NextResponse } from 'next/server';
import { listMemories } from '@/lib/memory';
import { prisma } from '@/lib/prisma';
import { executePendingAction } from '@/lib/pending-actions';
import { addManualFactToLegacy } from '@/lib/legacy-memory';

export async function GET() {
  try {
    const memories = await listMemories();
    return NextResponse.json({ memories });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// User-added fact from the Memory modal. Accepts a free-text body and
// stores it as a `fact` memory with a generated key. Mirrored into
// memory.json (Layer 2 retrieval in the chat route) so the new fact is
// included in the system prompt on the next chat turn — without the
// mirror, manual additions only land in the Prisma table and chat
// retrieval misses them until a full re-extraction.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'Empty fact' }, { status: 400 });
  }
  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'fact';
  const key = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    // B-12: through the executor (sole Memory-table writer). Manual add is an
    // explicit user gesture on exact content — interview-flow precedent.
    await executePendingAction('memory_write', {
      category, key, value: JSON.stringify({ text }), store: 'db', confidence: 1.0,
    });
    const memory = await prisma.memory.findUniqueOrThrow({
      where: { category_key: { category, key } },
    });
    // Mirror to memory.json. Best-effort — if the file write fails, the
    // Prisma row is still authoritative; we just log and move on.
    try {
      addManualFactToLegacy({
        id: memory.id,
        text,
        category,
        addedAt: memory.createdAt.toISOString(),
        updatedAt: memory.updatedAt.toISOString(),
      });
    } catch (e) {
      console.warn('[api/memories] legacy mirror failed:', e);
    }
    return NextResponse.json({ memory });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
