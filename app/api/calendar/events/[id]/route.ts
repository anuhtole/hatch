import { NextRequest, NextResponse } from 'next/server';
import { updateEvent, deleteEvent } from '@/lib/google-calendar';
import { AuthError } from '@/lib/google-auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { calendarId = 'primary', ...updates } = body;
    const event = await updateEvent(calendarId, id, updates);
    return NextResponse.json({
      event: { ...event, start: event.start.toISOString(), end: event.end.toISOString() },
    });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : 500;
    const message = error instanceof Error ? error.message : 'Failed to update event';
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const calendarId = searchParams.get('calendarId') ?? 'primary';
    await deleteEvent(calendarId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : 500;
    const message = error instanceof Error ? error.message : 'Failed to delete event';
    return NextResponse.json({ error: message }, { status });
  }
}
