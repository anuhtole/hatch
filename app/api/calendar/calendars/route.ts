import { NextResponse } from 'next/server';
import { listCalendars } from '@/lib/google-calendar';
import { AuthError } from '@/lib/google-auth';

export async function GET() {
  try {
    const calendars = await listCalendars('berkeley');
    return NextResponse.json({ calendars });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : 500;
    const message = error instanceof Error ? error.message : 'Failed to fetch calendars';
    return NextResponse.json({ error: message }, { status });
  }
}
