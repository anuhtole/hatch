import { NextRequest, NextResponse } from 'next/server';
import { deleteMemory, updateMemory } from '@/lib/memory';
import {
  removeManualFactFromLegacy,
  updateManualFactInLegacy,
} from '@/lib/legacy-memory';

// Pull the human-readable text out of a Memory.value JSON blob. Manual
// rows store {text: "..."}; auto-extracted rows have richer shapes.
function extractText(rawValue: string): string {
  try {
    const obj = JSON.parse(rawValue);
    if (typeof obj === 'string') return obj;
    if (typeof obj?.text === 'string') return obj.text;
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' · ');
  } catch {
    return rawValue;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await deleteMemory(id);
    // Mirror the delete into memory.json. No-op if the id isn't in the
    // manual_facts map (e.g. an auto-extracted row was deleted).
    try { removeManualFactFromLegacy(id); }
    catch (e) { console.warn('[api/memories DELETE] legacy mirror failed:', e); }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value ?? {});
  try {
    const memory = await updateMemory(id, value);
    // Mirror the edit. If the row wasn't in manual_facts (auto-extracted
    // rows aren't), updateManualFactInLegacy is a no-op.
    try { updateManualFactInLegacy(id, { text: extractText(value) }); }
    catch (e) { console.warn('[api/memories PATCH] legacy mirror failed:', e); }
    return NextResponse.json({ memory });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
