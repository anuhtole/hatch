import { NextRequest, NextResponse } from 'next/server';
import { getUpcomingEvents, getEvents, createEvent } from '@/lib/google-calendar';
import { AuthError } from '@/lib/google-auth';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const calendarId = searchParams.get('calendarId');
    const timeMin = searchParams.get('timeMin');
    const timeMax = searchParams.get('timeMax');
    const days = searchParams.get('days');

    let events;
    if (calendarId && timeMin && timeMax) {
      events = await getEvents(calendarId, new Date(timeMin), new Date(timeMax));
    } else {
      events = await getUpcomingEvents(days ? parseInt(days, 10) : 14);
    }

    // Serialize dates as ISO strings for JSON transport
    return NextResponse.json({
      events: events.map((e) => ({
        ...e,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
      })),
    });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : 500;
    const message = error instanceof Error ? error.message : 'Failed to fetch events';
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { calendarId = 'primary', ...eventData } = body;
    const event = await createEvent(calendarId, eventData);
    return NextResponse.json({
      event: { ...event, start: event.start.toISOString(), end: event.end.toISOString() },
    });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : 500;
    const message = error instanceof Error ? error.message : 'Failed to create event';
    return NextResponse.json({ error: message }, { status });
  }
}
