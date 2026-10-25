import { NextResponse } from 'next/server';
import { syncCanvasFiles } from '@/lib/knowledge';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const now = new Date();
  let documentsFound = 0;
  let courses = 0;
  const warnings: string[] = [];

  // Canvas sync — non-fatal if token is missing/expired
  try {
    const result = await syncCanvasFiles();
    documentsFound = result.documentsFound;
    courses = result.courses;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Canvas sync failed';
    console.warn('[sync POST] Canvas sync skipped:', message);
    warnings.push(`Canvas: ${message}`);
    // Still log a partial-success so the timestamp advances
    await prisma.syncLog.create({
      data: { source: 'canvas', status: 'error', message },
    });
  }

  // Record an overall success log so status/route returns a real timestamp
  await prisma.syncLog.create({
    data: {
      source: 'all',
      status: 'success',
      documentsFound,
      message: warnings.length
        ? `Partial sync — ${warnings.join('; ')}`
        : `Synced ${documentsFound} files from ${courses} courses`,
    },
  });

  return NextResponse.json({
    success: true,
    documentsFound,
    courses,
    syncedAt: now.toISOString(),
    warnings: warnings.length ? warnings : undefined,
  });
}
