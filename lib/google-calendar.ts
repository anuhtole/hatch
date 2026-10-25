import { google } from 'googleapis';
import { withGoogleRetry } from './google-auth';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  calendarId: string;
  calendarName?: string;
  color?: string;
  attendees?: Array<{ email: string; name?: string; status: string }>;
  htmlLink?: string;
}

export interface CalItem {
  id: string;
  name: string;
  color?: string;
  primary?: boolean;
}

export interface TodayBriefing {
  date: string;
  events: CalendarEvent[];
  tomorrowFirst?: CalendarEvent;
  conflicts: Array<{ a: CalendarEvent; b: CalendarEvent }>;
  freeBlocks: Array<{ start: Date; end: Date; durationMinutes: number }>;
}

// Google Calendar color IDs → hex
const COLOR_MAP: Record<string, string> = {
  '1': '#7986CB', // Lavender
  '2': '#33B679', // Sage
  '3': '#8E24AA', // Grape
  '4': '#E67C73', // Flamingo
  '5': '#F6BF26', // Banana
  '6': '#F4511E', // Tangerine
  '7': '#039BE5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3F51B5', // Blueberry
  '10': '#0B8043', // Basil
  '11': '#D50000', // Tomato
};

function parseEventDate(dateObj: { date?: string | null; dateTime?: string | null } | null | undefined): Date {
  if (!dateObj) return new Date();
  if (dateObj.dateTime) return new Date(dateObj.dateTime);
  if (dateObj.date) return new Date(dateObj.date + 'T00:00:00');
  return new Date();
}

function mapEvent(raw: {
  id?: string | null;
  summary?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  location?: string | null;
  description?: string | null;
  colorId?: string | null;
  attendees?: Array<{ email?: string | null; displayName?: string | null; responseStatus?: string | null }> | null;
  htmlLink?: string | null;
}, calendarId: string, calendarName?: string, calendarColor?: string): CalendarEvent {
  const start = parseEventDate(raw.start);
  const end = parseEventDate(raw.end);
  const allDay = !!(raw.start?.date && !raw.start?.dateTime);
  return {
    id: raw.id ?? '',
    title: raw.summary ?? '(No title)',
    start,
    end,
    allDay,
    location: raw.location ?? undefined,
    description: raw.description ?? undefined,
    calendarId,
    calendarName,
    color: raw.colorId ? COLOR_MAP[raw.colorId] : calendarColor,
    attendees: raw.attendees?.map((a) => ({
      email: a.email ?? '',
      name: a.displayName ?? undefined,
      status: a.responseStatus ?? 'needsAction',
    })),
    htmlLink: raw.htmlLink ?? undefined,
  };
}

export async function listCalendars(account = 'berkeley'): Promise<CalItem[]> {
  return withGoogleRetry(account, async (auth) => {
    const cal = google.calendar({ version: 'v3', auth });
    const res = await cal.calendarList.list({ maxResults: 50 });
    return (res.data.items ?? []).map((c) => ({
      id: c.id ?? '',
      name: c.summary ?? c.id ?? '',
      color: c.backgroundColor ?? undefined,
      primary: c.primary ?? false,
    }));
  });
}

export async function getEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  account = 'berkeley'
): Promise<CalendarEvent[]> {
  return withGoogleRetry(account, async (auth) => {
    const cal = google.calendar({ version: 'v3', auth });
    // Fetch calendar color for this calendar
    let calName: string | undefined;
    let calColor: string | undefined;
    try {
      const entry = await cal.calendarList.get({ calendarId });
      calName = entry.data.summary ?? undefined;
      calColor = entry.data.backgroundColor ?? undefined;
    } catch {
      // Non-fatal — proceed without color/name
    }

    const res = await cal.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    return (res.data.items ?? []).map((e) => mapEvent(e, calendarId, calName, calColor));
  });
}

export async function getUpcomingEvents(days = 7, account = 'berkeley'): Promise<CalendarEvent[]> {
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + days * 24 * 60 * 60 * 1000);

  const calendars = await listCalendars(account);
  const all = await Promise.all(
    calendars.map((c) => getEvents(c.id, timeMin, timeMax, account).catch(() => [] as CalendarEvent[]))
  );

  const merged = all.flat().sort((a, b) => a.start.getTime() - b.start.getTime());
  return merged;
}

export interface CreateEventInput {
  title: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  allDay?: boolean;
  location?: string;
  description?: string;
  attendees?: string[]; // email addresses
}

export async function createEvent(
  calendarId: string,
  event: CreateEventInput,
  account = 'berkeley'
): Promise<CalendarEvent> {
  return withGoogleRetry(account, async (auth) => {
    const cal = google.calendar({ version: 'v3', auth });
    const body: {
      summary: string;
      location?: string;
      description?: string;
      start: { date?: string; dateTime?: string; timeZone?: string };
      end: { date?: string; dateTime?: string; timeZone?: string };
      attendees?: Array<{ email: string }>;
    } = {
      summary: event.title,
      location: event.location,
      description: event.description,
      start: event.allDay
        ? { date: event.start.slice(0, 10) }
        : { dateTime: event.start, timeZone: 'America/Los_Angeles' },
      end: event.allDay
        ? { date: event.end.slice(0, 10) }
        : { dateTime: event.end, timeZone: 'America/Los_Angeles' },
    };
    if (event.attendees?.length) {
      body.attendees = event.attendees.map((e) => ({ email: e }));
    }
    const res = await cal.events.insert({ calendarId, requestBody: body });
    return mapEvent(res.data, calendarId);
  });
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  updates: Partial<CreateEventInput>,
  account = 'berkeley'
): Promise<CalendarEvent> {
  return withGoogleRetry(account, async (auth) => {
    const cal = google.calendar({ version: 'v3', auth });
    const patch: Record<string, unknown> = {};
    if (updates.title !== undefined) patch.summary = updates.title;
    if (updates.location !== undefined) patch.location = updates.location;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.start !== undefined) {
      patch.start = updates.allDay
        ? { date: updates.start.slice(0, 10) }
        : { dateTime: updates.start, timeZone: 'America/Los_Angeles' };
    }
    if (updates.end !== undefined) {
      patch.end = updates.allDay
        ? { date: updates.end.slice(0, 10) }
        : { dateTime: updates.end, timeZone: 'America/Los_Angeles' };
    }
    const res = await cal.events.patch({ calendarId, eventId, requestBody: patch });
    return mapEvent(res.data, calendarId);
  });
}

export async function deleteEvent(
  calendarId: string,
  eventId: string,
  account = 'berkeley'
): Promise<void> {
  return withGoogleRetry(account, async (auth) => {
    const cal = google.calendar({ version: 'v3', auth });
    await cal.events.delete({ calendarId, eventId });
  });
}

export async function getTodayBriefing(account = 'berkeley'): Promise<TodayBriefing> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);

  const calendars = await listCalendars(account);
  const [todayResults, tomorrowResults] = await Promise.all([
    Promise.all(calendars.map((c) => getEvents(c.id, todayStart, todayEnd, account).catch(() => [] as CalendarEvent[]))),
    Promise.all(calendars.map((c) => getEvents(c.id, tomorrowStart, tomorrowEnd, account).catch(() => [] as CalendarEvent[]))),
  ]);

  const todayEvents = todayResults.flat().filter((e) => !e.allDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  const tomorrowEvents = tomorrowResults.flat().filter((e) => !e.allDay).sort((a, b) => a.start.getTime() - b.start.getTime());

  // Find conflicts (overlapping events)
  const conflicts: Array<{ a: CalendarEvent; b: CalendarEvent }> = [];
  for (let i = 0; i < todayEvents.length; i++) {
    for (let j = i + 1; j < todayEvents.length; j++) {
      const a = todayEvents[i];
      const b = todayEvents[j];
      if (a.end > b.start && b.end > a.start) {
        conflicts.push({ a, b });
      }
    }
  }

  // Find free blocks > 1h between 8AM and 10PM
  const workStart = new Date(todayStart.getTime() + 8 * 60 * 60 * 1000);
  const workEnd = new Date(todayStart.getTime() + 22 * 60 * 60 * 1000);
  const freeBlocks: Array<{ start: Date; end: Date; durationMinutes: number }> = [];
  let cursor = workStart;
  for (const event of todayEvents) {
    if (event.start > cursor && event.start <= workEnd) {
      const gap = (event.start.getTime() - cursor.getTime()) / 60000;
      if (gap >= 60) {
        freeBlocks.push({ start: cursor, end: event.start, durationMinutes: Math.round(gap) });
      }
    }
    if (event.end > cursor) cursor = event.end;
  }
  if (cursor < workEnd) {
    const gap = (workEnd.getTime() - cursor.getTime()) / 60000;
    if (gap >= 60) {
      freeBlocks.push({ start: cursor, end: workEnd, durationMinutes: Math.round(gap) });
    }
  }

  return {
    date: todayStart.toISOString().slice(0, 10),
    events: todayEvents,
    tomorrowFirst: tomorrowEvents[0],
    conflicts,
    freeBlocks,
  };
}
