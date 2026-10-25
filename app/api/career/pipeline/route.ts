import { NextResponse } from 'next/server';
import { getApplicationsPipeline, type Application } from '@/lib/career-ops';
import { prisma } from '@/lib/prisma';
import { executePendingAction } from '@/lib/pending-actions';

// GET — merge markdown apps + DB PipelineCards
export async function GET() {
  try {
    const [markdownData, dbCards] = await Promise.all([
      getApplicationsPipeline().catch(() => ({ total: 0, byStatus: {}, applications: [] })),
      prisma.pipelineCard.findMany({ orderBy: { createdAt: 'desc' } }),
    ]);

    // Shape markdown apps into the unified card format
    const mdCards = markdownData.applications.map((app: Application) => ({
      id: `md-${app.num}`,
      org: app.company,
      role: app.role,
      type: 'job' as const,
      status: normaliseStatus(app.status),
      url: app.reportUrl ?? undefined,
      deadline: undefined,
      score: app.score ?? undefined,
      notes: app.notes || undefined,
      sourceId: undefined,
      createdAt: app.date || undefined,
      source: 'markdown' as const,
    }));

    const cards = [
      ...dbCards.map((c) => ({ ...c, source: 'db' as const })),
      ...mdCards,
    ];

    return NextResponse.json({ cards });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — create a new pipeline card
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      org: string;
      role: string;
      type?: string;
      status?: string;
      url?: string;
      deadline?: string;
      score?: string;
      notes?: string;
      sourceId?: string;
      // legacy fields from CatalogTab "+ Pipeline" action
      company?: string;
    };

    const card = await prisma.pipelineCard.create({
      data: {
        org: body.org ?? body.company ?? '',
        role: body.role ?? '',
        type: body.type ?? 'job',
        status: body.status ?? 'discovered',
        url: body.url ?? null,
        deadline: body.deadline ?? null,
        score: body.score ?? null,
        notes: body.notes ?? null,
        sourceId: body.sourceId ?? null,
      },
    });

    // Write to memory so Claude knows about this application
    const memKey = `application:${card.org.toLowerCase().replace(/\s+/g, '_')}:${card.role.toLowerCase().replace(/\s+/g, '_')}`;
    executePendingAction('memory_write', {
        category: 'career', key: memKey, value: JSON.stringify({ org: card.org, role: card.role, type: card.type, status: card.status, addedAt: new Date().toISOString() }), store: 'db',
      }).catch(() => { /* non-blocking; B-12: executor is the sole Memory-table writer */ });

    return NextResponse.json({ card });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normaliseStatus(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (s === 'applied')                       return 'applied';
  if (s === 'interview' || s === 'interviewing') return 'interviewing';
  if (s === 'offer')                         return 'offer';
  if (s === 'rejected' || s === 'closed' || s === 'withdrawn') return 'closed';
  if (s === 'evaluated')                     return 'evaluated';
  return 'discovered';
}
