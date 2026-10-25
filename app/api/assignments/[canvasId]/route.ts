import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ canvasId: string }> }
) {
  const { canvasId } = await context.params;
  const body = await req.json();

  try {
    await prisma.assignment.upsert({
      where: { canvasId },
      update: { userCompleted: Boolean(body.userCompleted) },
      create: {
        canvasId,
        courseId: String(body.courseId ?? ''),
        courseName: String(body.courseName ?? ''),
        title: String(body.title ?? ''),
        description: body.description ?? null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        pointsPossible: body.pointsPossible ?? null,
        submissionStatus: body.submissionStatus ?? null,
        userCompleted: Boolean(body.userCompleted),
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[assignments/[canvasId] PATCH]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
