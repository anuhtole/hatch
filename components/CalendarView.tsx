'use client';

import { useState, useEffect, useMemo } from 'react';

// Notion-pivot Calendar surface (C6 re-skin). This view replaced the
// earlier glass-shell day/week/month grid with a single vertical agenda
// of the current week. Functionality is read-only: events render with
// time + title + (location | calendar name). Event creation, editing,
// and view-mode switching are deliberately out of scope.

interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  calendarId: string;
  calendarName?: string;
  color?: string;
  htmlLink?: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - out.getDay());
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function fmtTimeRange(start: Date, end: Date, allDay: boolean): string {
  if (allDay) return 'All day';
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function fmtWeekRange(start: Date): string {
  const end = addDays(start, 6);
  if (start.getMonth() === end.getMonth()) {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}`;
}

function fmtDayDate(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export default function CalendarView() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const days = 7;
    fetch(`/api/calendar/events?days=${days}&timeMin=${weekStart.toISOString()}&timeMax=${weekEnd.toISOString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setEvents(data.events ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [weekStart, weekEnd]);

  // Group events by their start-day. Each day in the week gets a bucket
  // (possibly empty) so the week's structure stays visible.
  const days = useMemo(() => {
    const buckets: Array<{ date: Date; events: CalEvent[] }> = [];
    for (let i = 0; i < 7; i++) {
      buckets.push({ date: addDays(weekStart, i), events: [] });
    }
    for (const e of events) {
      const start = new Date(e.start);
      for (const b of buckets) {
        if (isSameDay(start, b.date)) {
          b.events.push(e);
          break;
        }
      }
    }
    for (const b of buckets) {
      b.events.sort((x, y) => new Date(x.start).getTime() - new Date(y.start).getTime());
    }
    return buckets;
  }, [events, weekStart]);

  const isAuthError = error && (
    error.includes('No OAuth tokens') || error.includes('401') ||
    error.includes('auth') || error.includes('Not connected') || error.includes('reconnect')
  );

  return (
    <div className="sb-surface">
      <div className="sb-surface-head">
        <h1 className="sb-surface-title">Calendar</h1>
        <div className="sb-surface-sub">This week · {fmtWeekRange(weekStart)}</div>
      </div>

      {error && (
        <div className="sb-banner error">
          {isAuthError ? 'Google account not connected — please reconnect in Settings.' : error}
        </div>
      )}

      <div className="sb-cal-body">
        {loading && events.length === 0 ? (
          <div className="sb-cal-day-empty" style={{ padding: '32px 10px' }}>Loading…</div>
        ) : (
          days.map((bucket) => {
            const isToday = isSameDay(bucket.date, today);
            const isPast = bucket.date.getTime() < today.getTime();
            const hasEvents = bucket.events.length > 0;
            const emptyLabel = isToday
              ? 'No more events today'
              : isPast
                ? 'No events'
                : 'No events';
            return (
              <section key={bucket.date.toISOString()} className="sb-cal-day">
                <div className="sb-cal-day-head">
                  <span className={'sb-cal-day-name' + (isToday ? ' today' : '')}>
                    {DAY_NAMES[bucket.date.getDay()]}
                  </span>
                  <span className="sb-cal-day-date">{fmtDayDate(bucket.date)}</span>
                </div>
                {hasEvents ? (
                  bucket.events.map((ev) => {
                    const start = new Date(ev.start);
                    const end = new Date(ev.end);
                    const meta = ev.location || ev.calendarName || '';
                    return (
                      <div key={ev.id} className="sb-cal-event">
                        <div className="sb-cal-event-time">
                          {fmtTimeRange(start, end, ev.allDay)}
                        </div>
                        <div className="sb-cal-event-info">
                          <div className="sb-cal-event-title">{ev.title || '(no title)'}</div>
                          {meta && <div className="sb-cal-event-meta">{meta}</div>}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="sb-cal-day-empty">{emptyLabel}</div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
