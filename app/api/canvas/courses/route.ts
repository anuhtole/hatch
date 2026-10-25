import { NextResponse } from 'next/server';
import { getCourses } from '@/lib/canvas';

export async function GET() {
  try {
    const courses = await getCourses();
    return NextResponse.json({ courses });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch courses';
    console.error('[canvas/courses GET]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
