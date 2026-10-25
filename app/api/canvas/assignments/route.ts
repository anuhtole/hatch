import { NextRequest, NextResponse } from 'next/server';
import { getUpcomingAssignments } from '@/lib/canvas';
import { prisma } from '@/lib/prisma';

// ── Server-side cache (15 min TTL) ────────────────────────────────────────────
// Uses globalThis so the cache survives Turbopack hot-module reloads in dev.

type CacheEntry = {
  data: { assignments: Awaited<ReturnType<typeof getUpcomingAssignments>> };
  days: number;
  expiresAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var _canvasAssignmentsCache: CacheEntry | null;
}
globalThis._canvasAssignmentsCache ??= null;

const CACHE_TTL_MS = 15 * 60 * 1000;

function getCache() { return globalThis._canvasAssignmentsCache; }
function setCache(entry: CacheEntry) { globalThis._canvasAssignmentsCache = entry; }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') ?? '14', 10);
  const force = searchParams.get('force') === 'true';

  const t0 = Date.now();

  // Cache hit
  const cached = getCache();
  if (!force && cached && cached.days === days && cached.expiresAt > Date.now()) {
    console.log('[canvas/assignments] cache hit, age', Math.round((Date.now() - (cached.expiresAt - CACHE_TTL_MS)) / 1000) + 's');
    return NextResponse.json(cached.data);
  }

  console.log('[canvas/assignments] cache miss, fetching');

  try {
    const assignments = await getUpcomingAssignments(days);
    console.log('[canvas/assignments] canvas fetch done', Date.now() - t0, 'ms');

    // Cross-reference DB for user-completed assignments and filter them out
    const completed = await prisma.assignment.findMany({
      where: { userCompleted: true },
      select: { canvasId: true },
    });
    const completedIds = new Set(completed.map((c) => c.canvasId));
    const filtered = assignments.filter((a) => !completedIds.has(String(a.id)));

    const result = { assignments: filtered };

    setCache({ data: result, days, expiresAt: Date.now() + CACHE_TTL_MS });
    console.log('[canvas/assignments] total', Date.now() - t0, 'ms');

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch assignments';
    console.error('[canvas/assignments GET]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
