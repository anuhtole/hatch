import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/pending-actions/[id]
 * Used by PendingActionCard to fetch the row when the stream has gone
 * (page reload, chat reopened, etc.) so the card can render its
 * approved / discarded state.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await prisma.pendingAction.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}
