import { NextResponse } from 'next/server';
import { getFollowupsDue } from '@/lib/career-ops';
import { prisma } from '@/lib/prisma';

export const maxDuration = 60;

// Called by Vercel Cron at 08:00 Europe/Madrid (UTC+2 in summer = 06:00 UTC)
// vercel.json: { "path": "/api/cron/career-followups", "schedule": "0 6 * * *" }
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const overdue = await getFollowupsDue();

    // Create a todo for each overdue follow-up that doesn't already have one
    let created = 0;
    for (const entry of overdue) {
      const todoText = `Follow up: ${entry.company} — ${entry.role} (${entry.daysOverdue}d overdue)`;

      // Avoid duplicates — check if a matching todo already exists
      const existing = await prisma.todo.findFirst({
        where: {
          text: todoText,
          completed: false,
        },
      });

      if (!existing) {
        await prisma.todo.create({
          data: {
            text: todoText,
            priority: (entry.daysOverdue ?? 0) >= 14 ? 'high' : 'medium',
            notes: entry.contact ? `Contact: ${entry.contact}` : null,
          },
        });
        created++;
      }
    }

    console.log(`[cron/career-followups] ${overdue.length} overdue, created ${created} new todos`);
    return NextResponse.json({ ok: true, overdueCount: overdue.length, todosCreated: created });
  } catch (err) {
    console.error('[cron/career-followups] threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
