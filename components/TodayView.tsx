'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types (mirror lib/daily-briefing.ts) ─────────────────────────────────────

interface CalendarSection {
  events: Array<{ title: string; start: string; end: string; location?: string; allDay: boolean }>;
  conflicts: Array<{ a: string; b: string }>;
  longestFreeBlock?: { start: string; end: string; durationMinutes: number };
}

interface EmailItem {
  id: string; from: string; subject: string; snippet: string;
  priority: 'HIGH' | 'MEDIUM'; action: string;
}

interface AssignmentItem {
  title: string; courseName: string; dueAt: string;
  urgency: 'URGENT' | 'UPCOMING'; submissionStatus?: string;
}

interface TrackerChange {
  title: string; from: string | null; to: string; changedAt: string;
}

interface StockData {
  symbol: string; name: string; price?: string; change?: string;
  changePct?: string; direction?: 'up' | 'down' | 'flat'; news?: string;
}

interface NewsStory {
  headline: string; summary: string; source?: string; url?: string;
}

interface CareerOpportunity {
  title: string; company: string; relevance: string; url?: string; deadline?: string;
}

interface BriefingContent {
  calendar: CalendarSection | { error: string };
  emails: { items: EmailItem[] } | { error: string };
  assignments: { items: AssignmentItem[]; totalDue: number } | { error: string };
  trackers: { changes: TrackerChange[]; steady: boolean } | { error: string };
  markets: { stocks: StockData[]; summary: string } | { error: string };
  news: { stories: NewsStory[] } | { error: string };
  career: { opportunities: CareerOpportunity[] } | { error: string };
  vault: { recentNotes: Array<{ path: string; title: string; modifiedAt: string }>; actionItems: string[]; focusSuggestion: string } | { error: string };
  generatedAt: string;
}

type View = 'today' | 'chat' | 'email' | 'files' | 'assignments' | 'calendar' | 'tracker' | 'wiki' | 'settings';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasError(section: object): section is { error: string } {
  return 'error' in section;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDueDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 24) return `Due today ${formatTime(iso)}`;
  if (diffH < 48) return `Due tomorrow ${formatTime(iso)}`;
  return `Due ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

function greetingPrefix(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDateHeader(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard({ title }: { title: string }) {
  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
        {[80, 60, 90, 50].map((w, i) => (
          <div key={i} className="skeleton" style={{ height: 14, width: `${w}%`, borderRadius: 6 }} />
        ))}
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 20,
  border: '1px solid rgba(0,0,0,0.04)',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const cardHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-jetbrains-mono)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: '#9B9BAB',
  fontWeight: 600,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-jetbrains-mono)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  fontWeight: 600,
};

// ── Section: Calendar ─────────────────────────────────────────────────────────

function CalendarCard({ data }: { data: CalendarSection | { error: string } }) {
  if (hasError(data)) return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Today's Schedule</div>
      <div style={{ color: '#9B9BAB', fontSize: 13 }}>Calendar unavailable — connect Google Calendar in Settings.</div>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={cardHeaderStyle}>Today's Schedule</div>
        {data.conflicts.length > 0 && (
          <span style={{ fontSize: 11, color: '#D4645C', fontWeight: 600, background: '#FDF0EF', padding: '2px 8px', borderRadius: 20 }}>
            {data.conflicts.length} conflict{data.conflicts.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {data.events.length === 0 ? (
        <div style={{ color: '#9B9BAB', fontSize: 14 }}>No events today — open calendar.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {data.events.map((e, i) => {
            const now = new Date();
            const start = new Date(e.start);
            const end = new Date(e.end);
            const isNow = start <= now && end >= now;
            const isPast = end < now;
            return (
              <div key={i} style={{
                display: 'flex',
                gap: 12,
                padding: '8px 10px',
                borderRadius: 8,
                background: isNow ? 'rgba(126,184,214,0.08)' : 'transparent',
                opacity: isPast ? 0.45 : 1,
                borderLeft: isNow ? '3px solid #7EB8D6' : '3px solid transparent',
              }}>
                <div style={{ fontSize: 12, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', minWidth: 65, paddingTop: 1 }}>
                  {formatTime(e.start)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: isNow ? 600 : 500, color: isNow ? '#1A1A1A' : '#3A3A3A', lineHeight: 1.3 }}>
                    {e.title}
                  </div>
                  {e.location && (
                    <div style={{ fontSize: 12, color: '#9B9BAB', marginTop: 2 }}>{e.location}</div>
                  )}
                </div>
                {isNow && <span style={{ fontSize: 10, color: '#7EB8D6', fontWeight: 700, letterSpacing: '0.05em', alignSelf: 'center' }}>NOW</span>}
              </div>
            );
          })}
        </div>
      )}

      {data.longestFreeBlock && (
        <div style={{ background: 'rgba(91,185,140,0.06)', borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>🎯</span>
          <div>
            <div style={{ fontSize: 12, color: '#5BB98C', fontWeight: 600 }}>Best focus block</div>
            <div style={{ fontSize: 13, color: '#3A3A3A' }}>
              {formatTime(data.longestFreeBlock.start)} – {formatTime(data.longestFreeBlock.end)}
              <span style={{ color: '#9B9BAB', marginLeft: 6 }}>{data.longestFreeBlock.durationMinutes}m free</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section: Emails ───────────────────────────────────────────────────────────

function EmailCard({ data, onNavigate }: { data: { items: EmailItem[] } | { error: string }; onNavigate: (v: View) => void }) {
  if (hasError(data)) return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Priority Inbox</div>
      <div style={{ color: '#9B9BAB', fontSize: 13 }}>Email unavailable — connect Gmail in Settings.</div>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={cardHeaderStyle}>Priority Inbox</div>
        {data.items.length > 0 && (
          <button onClick={() => onNavigate('email')} style={{ fontSize: 12, color: '#7EB8D6', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            Open inbox →
          </button>
        )}
      </div>

      {data.items.length === 0 ? (
        <div style={{ color: '#9B9BAB', fontSize: 14 }}>Inbox clear — no priority emails in the last 24h.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.items.map((e, i) => (
            <button
              key={i}
              onClick={() => onNavigate('email')}
              style={{
                background: e.priority === 'HIGH' ? 'rgba(212,100,92,0.04)' : 'transparent',
                border: e.priority === 'HIGH' ? '1px solid rgba(212,100,92,0.12)' : '1px solid #F0ECE8',
                borderRadius: 10,
                padding: '10px 12px',
                textAlign: 'left',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: e.priority === 'HIGH' ? '#D4645C' : '#9B9BAB',
                  background: e.priority === 'HIGH' ? 'rgba(212,100,92,0.1)' : '#F5F2EF',
                  padding: '2px 6px',
                  borderRadius: 10,
                }}>
                  {e.priority}
                </span>
                <span style={{ fontSize: 12, color: '#6B6B7B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.from.replace(/<.*>/, '').trim()}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 2, lineHeight: 1.3 }}>
                {e.subject}
              </div>
              <div style={{ fontSize: 12, color: '#6B6B7B' }}>{e.action}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section: Assignments ──────────────────────────────────────────────────────

function AssignmentsCard({ data, onNavigate }: { data: { items: AssignmentItem[]; totalDue: number } | { error: string }; onNavigate: (v: View) => void }) {
  if (hasError(data)) return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Upcoming Assignments</div>
      <div style={{ color: '#9B9BAB', fontSize: 13 }}>Canvas unavailable.</div>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={cardHeaderStyle}>Assignments Due This Week</div>
        {data.items.length > 0 && (
          <button onClick={() => onNavigate('assignments')} style={{ fontSize: 12, color: '#7EB8D6', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            View all →
          </button>
        )}
      </div>

      {data.items.length === 0 ? (
        <div style={{ color: '#9B9BAB', fontSize: 14 }}>No assignments due in the next 7 days.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.items.map((a, i) => (
            <button
              key={i}
              onClick={() => onNavigate('assignments')}
              style={{
                background: a.urgency === 'URGENT' ? 'rgba(224,164,88,0.06)' : 'transparent',
                border: a.urgency === 'URGENT' ? '1px solid rgba(224,164,88,0.2)' : '1px solid #F0ECE8',
                borderRadius: 10,
                padding: '9px 12px',
                textAlign: 'left',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                {a.urgency === 'URGENT' && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#E0A458', background: 'rgba(224,164,88,0.12)', padding: '2px 6px', borderRadius: 10, letterSpacing: '0.06em' }}>
                    URGENT
                  </span>
                )}
                <span style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>
                  {a.courseName.length > 30 ? a.courseName.slice(0, 30) + '…' : a.courseName}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1A1A', lineHeight: 1.3 }}>{a.title}</div>
              <div style={{ fontSize: 12, color: a.urgency === 'URGENT' ? '#E0A458' : '#9B9BAB', marginTop: 2 }}>
                {formatDueDate(a.dueAt)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section: Tracker Changes ──────────────────────────────────────────────────

function TrackerCard({ data, onNavigate }: { data: { changes: TrackerChange[]; steady: boolean } | { error: string }; onNavigate: (v: View) => void }) {
  if (hasError(data)) return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Tracker Updates</div>
      <div style={{ color: '#9B9BAB', fontSize: 13 }}>Tracker data unavailable.</div>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={cardHeaderStyle}>Tracker Updates</div>
        <button onClick={() => onNavigate('tracker')} style={{ fontSize: 12, color: '#7EB8D6', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          Open →
        </button>
      </div>

      {data.steady ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#5BB98C', fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#5BB98C', flexShrink: 0 }} />
          All trackers steady — no changes in the last 24h.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.changes.map((c, i) => (
            <button
              key={i}
              onClick={() => onNavigate('tracker')}
              style={{ background: '#F8F4EF', border: '1px solid #E8E4DF', borderRadius: 10, padding: '9px 12px', textAlign: 'left', cursor: 'pointer', width: '100%' }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 4 }}>{c.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: '#9B9BAB' }}>{c.from ?? 'unchecked'}</span>
                <span style={{ color: '#9B9BAB' }}>→</span>
                <span style={{ color: '#5BA3C9', fontWeight: 500 }}>{c.to}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section: Markets ──────────────────────────────────────────────────────────

function MarketsCard({ data }: { data: { stocks: StockData[]; summary: string } | { error: string } }) {
  if (hasError(data)) return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Markets</div>
      <div style={{ color: '#9B9BAB', fontSize: 13 }}>Market data unavailable.</div>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Markets</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {data.stocks.map((s, i) => {
          const isUp = s.direction === 'up';
          const isDown = s.direction === 'down';
          const color = isUp ? '#5BB98C' : isDown ? '#D4645C' : '#9B9BAB';
          const bg = isUp ? 'rgba(91,185,140,0.06)' : isDown ? 'rgba(212,100,92,0.06)' : '#F8F4EF';
          return (
            <div key={i} style={{ background: bg, borderRadius: 10, padding: '10px 12px', border: `1px solid ${isUp ? 'rgba(91,185,140,0.15)' : isDown ? 'rgba(212,100,92,0.15)' : '#E8E4DF'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 12, fontWeight: 700, color: '#1A1A1A' }}>{s.symbol}</span>
                <span style={{ fontSize: 14 }}>{isUp ? '↑' : isDown ? '↓' : '→'}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A', marginBottom: 2 }}>{s.price ?? '—'}</div>
              <div style={{ fontSize: 12, color, fontWeight: 600 }}>{s.changePct ?? s.change ?? '—'}</div>
              {s.news && <div style={{ fontSize: 11, color: '#9B9BAB', marginTop: 4, lineHeight: 1.4 }}>{s.news}</div>}
            </div>
          );
        })}
      </div>
      {data.summary && (
        <div style={{ fontSize: 12, color: '#6B6B7B', fontStyle: 'italic', borderTop: '1px solid #F0ECE8', paddingTop: 10 }}>
          {data.summary}
        </div>
      )}
    </div>
  );
}

// ── Section: News ─────────────────────────────────────────────────────────────

function NewsCard({ data }: { data: { stories: NewsStory[] } | { error: string } }) {
  const [saved, setSaved] = useState<Set<number>>(new Set());

  if (hasError(data)) return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Tech News</div>
      <div style={{ color: '#9B9BAB', fontSize: 13 }}>News unavailable.</div>
    </div>
  );

  async function saveStory(i: number, story: NewsStory) {
    const slug = story.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
    const today = new Date().toISOString().slice(0, 10);
    const content = `---
title: "${story.headline}"
tags: [resource, tech-news]
created: ${today}
source: ${story.source ?? 'unknown'}
url: ${story.url ?? ''}
---

# ${story.headline}

${story.summary}

**Source:** ${story.source ?? 'Unknown'} — [Read more](${story.url ?? '#'})
`;
    await fetch('/api/wiki', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `07-resources/tech-news-${today}-${slug}.md`, content, title: story.headline }),
    });
    setSaved((prev) => new Set(prev).add(i));
  }

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Tech News</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.stories.map((s, i) => (
          <div key={i} style={{ paddingBottom: 12, borderBottom: i < data.stories.length - 1 ? '1px solid #F0ECE8' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A', textDecoration: 'none', lineHeight: 1.3, flex: 1 }}>
                  {s.headline}
                </a>
              ) : (
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A', lineHeight: 1.3, flex: 1 }}>{s.headline}</div>
              )}
              <button
                onClick={() => saveStory(i, s)}
                disabled={saved.has(i)}
                title="Save to Vault"
                style={{
                  fontSize: 12,
                  color: saved.has(i) ? '#5BB98C' : '#9B9BAB',
                  background: 'none',
                  border: 'none',
                  cursor: saved.has(i) ? 'default' : 'pointer',
                  flexShrink: 0,
                  padding: '2px 4px',
                }}
              >
                {saved.has(i) ? '✓' : '＋vault'}
              </button>
            </div>
            <div style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.5 }}>{s.summary}</div>
            {s.source && <div style={{ fontSize: 11, color: '#9B9BAB', marginTop: 4, fontFamily: 'var(--font-jetbrains-mono)' }}>{s.source}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section: Career ───────────────────────────────────────────────────────────

function CareerCard({ data }: { data: { opportunities: CareerOpportunity[] } | { error: string } }) {
  if (hasError(data)) return (
    <div style={{ ...cardStyle, border: '1px solid rgba(126,184,214,0.2)' }}>
      <div style={cardHeaderStyle}>For You</div>
      <div style={{ color: '#9B9BAB', fontSize: 13 }}>Career intelligence unavailable.</div>
    </div>
  );

  return (
    <div style={{ ...cardStyle, border: '1px solid rgba(126,184,214,0.25)', background: 'linear-gradient(135deg, #FFFFFF 0%, rgba(232,242,248,0.3) 100%)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ ...cardHeaderStyle, color: '#5BA3C9' }}>For You — Career Intelligence</div>
      </div>

      {data.opportunities.length === 0 ? (
        <div style={{ color: '#9B9BAB', fontSize: 13 }}>No new opportunities found today.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.opportunities.map((o, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(126,184,214,0.15)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A', lineHeight: 1.3, marginBottom: 2 }}>{o.title}</div>
                  <div style={{ fontSize: 12, color: '#5BA3C9', fontWeight: 500 }}>{o.company}</div>
                </div>
                {o.url && (
                  <a
                    href={o.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: '#FFFFFF', background: '#7EB8D6', padding: '4px 10px', borderRadius: 6, textDecoration: 'none', fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}
                  >
                    Apply →
                  </a>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.5 }}>{o.relevance}</div>
              {o.deadline && (
                <div style={{ fontSize: 11, color: '#E0A458', marginTop: 6, fontWeight: 600 }}>⏰ {o.deadline}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section: Vault ────────────────────────────────────────────────────────────

function VaultCard({ data }: { data: { recentNotes: Array<{ path: string; title: string; modifiedAt: string }>; actionItems: string[]; focusSuggestion: string } | { error: string } }) {
  if (hasError(data)) return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Vault</div>
      <div style={{ color: '#9B9BAB', fontSize: 13 }}>Vault unavailable.</div>
    </div>
  );

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Vault Activity</div>

      {data.focusSuggestion && (
        <div style={{ background: 'rgba(126,184,214,0.07)', border: '1px solid rgba(126,184,214,0.15)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, color: '#7EB8D6', fontWeight: 700, marginBottom: 3, letterSpacing: '0.06em' }}>SUGGESTED FOCUS</div>
          <div style={{ fontSize: 13, color: '#3A3A3A' }}>{data.focusSuggestion}</div>
        </div>
      )}

      {data.actionItems.length > 0 && (
        <div>
          <div style={{ ...sectionLabelStyle, color: '#9B9BAB', marginBottom: 6 }}>Action Items</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.actionItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#3A3A3A', alignItems: 'flex-start' }}>
                <span style={{ color: '#7EB8D6', marginTop: 1 }}>·</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recentNotes.length > 0 && (
        <div>
          <div style={{ ...sectionLabelStyle, color: '#9B9BAB', marginBottom: 6 }}>Updated Today</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {data.recentNotes.map((n, i) => (
              <div key={i} style={{ fontSize: 12, color: '#6B6B7B', padding: '3px 0', display: 'flex', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 10, color: '#9B9BAB', paddingTop: 1, flexShrink: 0 }}>
                  {n.path.split('/')[0]}
                </span>
                <span>{n.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recentNotes.length === 0 && data.actionItems.length === 0 && (
        <div style={{ color: '#9B9BAB', fontSize: 13 }}>No vault activity in the last 24h.</div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface TodayViewProps {
  onNavigate: (view: View) => void;
  onRead: () => void;
}

export default function TodayView({ onNavigate, onRead }: TodayViewProps) {
  const [briefing, setBriefing] = useState<BriefingContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBriefing = useCallback(async (regen = false) => {
    if (regen) setRegenerating(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(regen ? '/api/briefing/regenerate' : '/api/briefing/today', {
        method: regen ? 'POST' : 'GET',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBriefing(data.content);
      // Mark as read
      fetch('/api/briefing/mark-read', { method: 'POST' }).catch(() => {});
      onRead();
    } catch (e) {
      console.error('[TodayView] loadBriefing error:', e);
      setError(String(e));
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, [onRead]);

  useEffect(() => { loadBriefing(); }, [loadBriefing]);

  const generatedAt = briefing?.generatedAt
    ? new Date(briefing.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#F8F6F4', padding: '24px 32px 48px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 13, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 4, letterSpacing: '0.06em' }}>
            {formatDateHeader().toUpperCase()}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em' }}>
            {greetingPrefix()}, Anatole.
          </h1>
          {generatedAt && (
            <div style={{ fontSize: 12, color: '#9B9BAB', marginTop: 6 }}>
              Briefing generated at {generatedAt}
            </div>
          )}
        </div>
        <button
          onClick={() => loadBriefing(true)}
          disabled={regenerating || loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 18px',
            background: regenerating || loading ? '#F0EDEA' : '#1A1A1A',
            border: 'none',
            borderRadius: 999,
            fontSize: 13,
            color: regenerating || loading ? '#9B9BAB' : '#FFFFFF',
            cursor: regenerating || loading ? 'default' : 'pointer',
            fontFamily: 'inherit',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14, display: 'inline-block', animation: regenerating ? 'pulse 1s ease-in-out infinite' : 'none' }}>↺</span>
          {regenerating ? 'Refreshing…' : 'Regenerate'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ background: '#FDF0EF', border: '1px solid rgba(212,100,92,0.2)', borderRadius: 12, padding: '14px 18px', marginBottom: 24, color: '#D4645C', fontSize: 13 }}>
          Failed to load briefing: {error}. <button onClick={() => loadBriefing()} style={{ color: '#D4645C', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 13 }}>Try again</button>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {['Today\'s Schedule', 'Priority Inbox', 'Assignments', 'Tracker Updates',
            'Markets', 'Tech News', 'For You', 'Vault'].map((title) => (
            <SkeletonCard key={title} title={title} />
          ))}
        </div>
      )}

      {/* Content grid */}
      {!loading && briefing && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="fade-up" style={{ animationDelay: '0ms' }}>
              <CalendarCard data={briefing.calendar} />
            </div>
            <div className="fade-up" style={{ animationDelay: '60ms' }}>
              <EmailCard data={briefing.emails} onNavigate={onNavigate} />
            </div>
            <div className="fade-up" style={{ animationDelay: '120ms' }}>
              <AssignmentsCard data={briefing.assignments} onNavigate={onNavigate} />
            </div>
            <div className="fade-up" style={{ animationDelay: '180ms' }}>
              <TrackerCard data={briefing.trackers} onNavigate={onNavigate} />
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="fade-up" style={{ animationDelay: '40ms' }}>
              <MarketsCard data={briefing.markets} />
            </div>
            <div className="fade-up" style={{ animationDelay: '100ms' }}>
              <NewsCard data={briefing.news} />
            </div>
            <div className="fade-up" style={{ animationDelay: '160ms' }}>
              <CareerCard data={briefing.career} />
            </div>
            <div className="fade-up" style={{ animationDelay: '220ms' }}>
              <VaultCard data={briefing.vault} />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
