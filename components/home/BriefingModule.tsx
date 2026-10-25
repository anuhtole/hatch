'use client';

import { useState, useEffect, useRef } from 'react';
import { useStableData } from '@/lib/swr-config';
import { createPortal } from 'react-dom';
import CollapsibleModule from './CollapsibleModule';
import { useModalPosition } from '@/lib/useModalPosition';
import type {
  BriefingContent,
  Highlight,
  TodaySection,
  TechAISection,
  WorldNewsSection,
  GoodMorningSection,
  DidYouKnowSection,
  VaultEchoesSection,
  StockData,
  CareerOpportunity,
  NewsStory,
} from '@/lib/daily-briefing';

// ── Section config ─────────────────────────────────────────────────────────────

const SECTION_ORDER = [
  'dailyRecap', 'today', 'markets', 'techAI', 'worldNews', 'career', 'didYouKnow', 'vaultEchoes',
] as const;

const SECTION_LABEL: Record<string, string> = {
  dailyRecap: 'Daily Recap',
  today: 'Today',
  markets: 'Markets',
  techAI: 'Tech & AI',
  worldNews: 'World News',
  career: 'Career Beat',
  didYouKnow: 'Did You Know',
  vaultEchoes: 'Vault Echoes',
};

const SECTION_ACCENT: Record<string, string> = {
  dailyRecap: '#E8B87A',
  today: '#7EB8D6',
  markets: '#8FC89A',
  techAI: '#7EB8D6',
  worldNews: '#7EB8D6',
  career: '#E8B87A',
  didYouKnow: '#7EB8D6',
  vaultEchoes: '#A89E91',
};

const TYPE_SECTION_COLOR: Record<string, string> = {
  calendar: '#7EB8D6',
  email: '#D88878',
  assignment: '#E8B87A',
  tracker: '#7EB8D6',
  market: '#8FC89A',
  news: '#7EB8D6',
  career: '#E8B87A',
  vault: '#A89E91',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasError(s: unknown): s is { error: string } {
  return !!s && typeof (s as { error?: string }).error === 'string';
}

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

// ── Highlight type icons ──────────────────────────────────────────────────────

function HighlightIcon({ type }: { type: Highlight['type'] }) {
  const color = TYPE_SECTION_COLOR[type] ?? '#9B9BAB';
  const size = 11;

  if (type === 'calendar') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
  if (type === 'email') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/>
    </svg>
  );
  if (type === 'assignment') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  );
  if (type === 'tracker') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
  if (type === 'market') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
    </svg>
  );
  if (type === 'career') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
    </svg>
  );
  // news / vault fallback
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  );
}

// ── Modal section cards ───────────────────────────────────────────────────────

function SectionCard({
  id,
  section,
  children,
}: {
  id: string;
  section: keyof typeof SECTION_LABEL;
  children: React.ReactNode;
}) {
  const accent = SECTION_ACCENT[section] ?? '#9B9BAB';
  return (
    <div
      id={id}
      style={{
        background: '#221E2A',
        borderRadius: 14,
        border: '1px solid rgba(255,235,210,0.07)',
        overflow: 'hidden',
        scrollMarginTop: 20,
      }}
    >
      {/* Accent bar + label */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 18px 10px',
        borderBottom: '1px solid rgba(255,235,210,0.07)',
      }}>
        <div style={{ width: 3, height: 14, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#766D62',
          fontFamily: 'var(--font-jetbrains-mono)',
          letterSpacing: '0.09em',
        }}>
          {SECTION_LABEL[section]?.toUpperCase()}
        </div>
      </div>
      <div style={{ padding: '14px 18px 16px' }}>{children}</div>
    </div>
  );
}

function AllClear() {
  return <div style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>All clear</div>;
}

function SectionError({ error }: { error: string }) {
  const msg = error.includes('"message"') ? (() => {
    try { return JSON.parse(error.slice(error.indexOf('{'))).error?.message ?? error; } catch { return error; }
  })() : error;
  return (
    <div style={{ fontSize: 11, color: '#D88878', fontFamily: 'var(--font-jetbrains-mono)', lineHeight: 1.5 }}>
      <span style={{ opacity: 0.6 }}>Error: </span>{msg}
    </div>
  );
}

// ── Daily Recap card ──────────────────────────────────────────────────────────

function DailyRecapCard({ data }: { data: BriefingContent['dailyRecap'] }) {
  if (!data) return <AllClear />;
  if (hasError(data)) return <SectionError error={(data as { error: string }).error} />;
  const d = data as GoodMorningSection;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 15, color: '#FBF5EC', fontFamily: 'var(--font-display)', lineHeight: 1.5 }}>
        {d.greeting}
      </div>
      {d.dayLine && (
        <div style={{ fontSize: 13, color: '#EADFD0', lineHeight: 1.5 }}>{d.dayLine}</div>
      )}
      {d.toneNote && (
        <div style={{
          fontSize: 12,
          color: '#E8B87A',
          fontFamily: 'var(--font-jetbrains-mono)',
          marginTop: 4,
          borderLeft: '2px solid #E8B87A',
          paddingLeft: 10,
        }}>
          {d.toneNote}
        </div>
      )}
    </div>
  );
}

// ── Today card ────────────────────────────────────────────────────────────────

function TodayCard({ data, onNavigateToTrackers }: { data: BriefingContent['today']; onNavigateToTrackers?: () => void }) {
  if (!data) return <AllClear />;
  if (hasError(data)) return <SectionError error={(data as { error: string }).error} />;
  const d = data as TodaySection;
  const hasAnything = d.events?.length || d.emails?.length || d.assignments?.length || d.trackers?.length;
  if (!hasAnything) return <AllClear />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Calendar events */}
      {d.events?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.07em', marginBottom: 7 }}>CALENDAR</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {d.events.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 11, color: '#7EB8D6', fontFamily: 'var(--font-jetbrains-mono)', minWidth: 48, flexShrink: 0, paddingTop: 1 }}>
                  {ev.allDay ? 'All day' : fmtTime(ev.start)}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC' }}>{ev.title}</div>
                  {ev.location && <div style={{ fontSize: 11, color: '#766D62', marginTop: 1 }}>{ev.location}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Emails */}
      {d.emails?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.07em', marginBottom: 7 }}>EMAIL</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.emails.map((em, i) => (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {em.priority === 'HIGH' && (
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#D88878', flexShrink: 0 }} />
                  )}
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#FBF5EC' }}>{em.subject}</div>
                </div>
                <div style={{ fontSize: 11, color: '#766D62', marginTop: 1 }}>{em.from}</div>
                {em.action && <div style={{ fontSize: 10, color: '#D88878', fontFamily: 'var(--font-jetbrains-mono)', marginTop: 2 }}>{em.action}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assignments */}
      {d.assignments?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.07em', marginBottom: 7 }}>ASSIGNMENTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {d.assignments.map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#FBF5EC' }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: '#766D62', marginTop: 1 }}>{a.courseName}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ fontSize: 11, color: a.urgency === 'URGENT' ? '#D88878' : '#A89E91', fontFamily: 'var(--font-jetbrains-mono)' }}>
                    {fmtDate(a.dueAt)}
                  </div>
                  {a.urgency === 'URGENT' && (
                    <div style={{ fontSize: 9, color: '#D88878', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em' }}>URGENT</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trackers — inline callouts */}
      {d.trackers?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {d.trackers.map((c, i) => (
            <div key={i} style={{
              background: 'rgba(126,184,214,0.06)',
              borderLeft: '2px solid #7EB8D6',
              borderRadius: '0 8px 8px 0',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}>
              <div style={{ fontSize: 12, color: '#FBF5EC', lineHeight: 1.4 }}>
                🔔 <span style={{ fontWeight: 600 }}>{c.title}</span>
                {c.from
                  ? <> status changed: <span style={{ color: '#A89E91' }}>{c.from}</span> → <span style={{ color: '#7EB8D6' }}>{c.to}</span></>
                  : <> — <span style={{ color: '#7EB8D6' }}>{c.to}</span></>
                }
              </div>
              {onNavigateToTrackers && (
                <button
                  onClick={onNavigateToTrackers}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(126,184,214,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(126,184,214,0.5)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(126,184,214,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(126,184,214,0.3)'; }}
                  style={{
                    fontSize: 10,
                    color: '#7EB8D6',
                    fontFamily: 'var(--font-jetbrains-mono)',
                    background: 'rgba(126,184,214,0.1)',
                    border: '1px solid rgba(126,184,214,0.3)',
                    borderRadius: 999,
                    cursor: 'pointer',
                    padding: '4px 12px',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Take me there →
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Markets card ──────────────────────────────────────────────────────────────

function MarketsCard({ data }: { data: BriefingContent['markets'] }) {
  if (!data) return <AllClear />;
  if (hasError(data)) return <SectionError error={(data as { error: string }).error} />;
  const d = data as { stocks: StockData[]; summary: string };
  if (!d.stocks?.length && !d.summary) return <AllClear />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {d.summary && (
        <div style={{ fontSize: 12, color: '#A89E91', fontStyle: 'italic', marginBottom: 2 }}>{d.summary}</div>
      )}
      {d.stocks?.map((s, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#FBF5EC', fontFamily: 'var(--font-jetbrains-mono)' }}>{s.symbol}</span>
            {s.name && <span style={{ fontSize: 11, color: '#766D62', marginLeft: 7 }}>{s.name}</span>}
            {s.news && <div style={{ fontSize: 11, color: '#A89E91', marginTop: 2 }}>{s.news}</div>}
          </div>
          {s.price && (
            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC' }}>{s.price}</div>
              {s.changePct && (
                <div style={{
                  fontSize: 11,
                  color: s.direction === 'up' ? '#8FC89A' : s.direction === 'down' ? '#D88878' : '#766D62',
                  fontFamily: 'var(--font-jetbrains-mono)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  justifyContent: 'flex-end',
                }}>
                  {s.direction === 'up' ? '↑' : s.direction === 'down' ? '↓' : '–'} {s.changePct}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tech & AI card ────────────────────────────────────────────────────────────

function NewsRow({ story }: { story: NewsStory }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC', lineHeight: 1.4 }}>{story.headline}</div>
      {story.summary && (
        <div style={{ fontSize: 12, color: '#EADFD0', marginTop: 3, lineHeight: 1.5 }}>{story.summary}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        {story.source && <span style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>{story.source}</span>}
        {story.url && (
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10, color: '#7EB8D6', fontFamily: 'var(--font-jetbrains-mono)', textDecoration: 'none' }}
          >
            Read more →
          </a>
        )}
      </div>
    </div>
  );
}

function TechAICard({ data }: { data: BriefingContent['techAI'] }) {
  if (!data) return <AllClear />;
  if (hasError(data)) return <SectionError error={(data as { error: string }).error} />;
  const d = data as TechAISection;
  const hasAny = d.aiStories?.length || d.techPolicy?.length;
  if (!hasAny) return <AllClear />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {d.aiStories?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.07em', marginBottom: 8 }}>AI / ML</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.aiStories.map((s, i) => <NewsRow key={i} story={s} />)}
          </div>
        </div>
      )}
      {d.techPolicy?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.07em', marginBottom: 8 }}>TECH POLICY</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.techPolicy.map((s, i) => <NewsRow key={i} story={s} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── World News card ───────────────────────────────────────────────────────────

function WorldNewsCard({ data }: { data: BriefingContent['worldNews'] }) {
  if (!data) return <AllClear />;
  if (hasError(data)) return <SectionError error={(data as { error: string }).error} />;
  const stories = (data as WorldNewsSection).stories ?? [];
  if (!stories.length) return <AllClear />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {stories.map((s, i) => <NewsRow key={i} story={s} />)}
    </div>
  );
}

// ── Career card ───────────────────────────────────────────────────────────────

function CareerCard({ data, onNavigateToCareer }: { data: BriefingContent['career']; onNavigateToCareer?: (tab?: string) => void }) {
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  if (!data) return <AllClear />;
  if (hasError(data)) return <SectionError error={(data as { error: string }).error} />;
  const opps = (data as { opportunities: CareerOpportunity[] }).opportunities ?? [];
  if (!opps.length) return <AllClear />;

  async function addToPipeline(o: CareerOpportunity, idx: number) {
    try {
      await fetch('/api/career/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org: o.company, role: o.title, url: o.url ?? undefined, notes: o.relevance ?? undefined }),
      });
      setAddedIds((prev) => new Set(prev).add(idx));
    } catch { /* silent */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {opps.map((o, i) => (
        <div key={i}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#FBF5EC' }}>
                {o.title} <span style={{ color: '#766D62', fontWeight: 400 }}>@ {o.company}</span>
              </div>
              <div style={{ fontSize: 12, color: '#EADFD0', marginTop: 3, lineHeight: 1.5 }}>{o.relevance}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                {o.deadline && (
                  <span style={{ fontSize: 10, color: '#E8B87A', fontFamily: 'var(--font-jetbrains-mono)' }}>Deadline: {o.deadline}</span>
                )}
                {o.url && (
                  <a
                    href={o.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 10, color: '#7EB8D6', fontFamily: 'var(--font-jetbrains-mono)', textDecoration: 'none' }}
                  >
                    Apply →
                  </a>
                )}
              </div>
            </div>
            <button
              onClick={() => addToPipeline(o, i)}
              disabled={addedIds.has(i)}
              style={{
                flexShrink: 0,
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid rgba(126,184,214,0.3)',
                background: addedIds.has(i) ? 'rgba(143,200,154,0.15)' : 'rgba(126,184,214,0.1)',
                color: addedIds.has(i) ? '#8FC89A' : '#7EB8D6',
                fontSize: 10,
                fontFamily: 'var(--font-jetbrains-mono)',
                cursor: addedIds.has(i) ? 'default' : 'pointer',
              }}
            >
              {addedIds.has(i) ? '✓ Added' : '+ Pipeline'}
            </button>
          </div>
        </div>
      ))}
      {onNavigateToCareer && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onNavigateToCareer('pipeline')}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(232,184,122,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(232,184,122,0.5)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(232,184,122,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(232,184,122,0.3)'; }}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid rgba(232,184,122,0.3)',
              background: 'rgba(232,184,122,0.1)',
              color: '#E8B87A',
              fontSize: 11,
              fontFamily: 'var(--font-jetbrains-mono)',
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            Pipeline →
          </button>
          <button
            onClick={() => onNavigateToCareer('suggestions')}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(184,160,232,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(184,160,232,0.5)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(184,160,232,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(184,160,232,0.3)'; }}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid rgba(184,160,232,0.3)',
              background: 'rgba(184,160,232,0.1)',
              color: '#B8A0E8',
              fontSize: 11,
              fontFamily: 'var(--font-jetbrains-mono)',
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            Suggestions →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Did You Know card ─────────────────────────────────────────────────────────

function DidYouKnowCard({ data, onRegenerate }: { data: BriefingContent['didYouKnow']; onRegenerate?: () => void }) {
  const [regenerating, setRegenerating] = useState(false);

  async function handleRegenerate() {
    if (!onRegenerate || regenerating) return;
    setRegenerating(true);
    onRegenerate();
    setTimeout(() => setRegenerating(false), 3000);
  }

  if (!data) return <AllClear />;
  if (hasError(data)) return <SectionError error={(data as { error: string }).error} />;
  const d = data as DidYouKnowSection;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
      {onRegenerate && (
        <button
          onClick={handleRegenerate}
          title="Generate new fact"
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: '1px solid rgba(255,235,210,0.12)',
            background: 'rgba(255,235,210,0.05)',
            color: '#766D62',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#FBF5EC'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,235,210,0.1)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#766D62'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,235,210,0.05)'; }}
        >
          <svg
            width="11" height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: regenerating ? 'spin 1s linear infinite' : 'none' }}
          >
            <path d="M1 4v6h6" /><path d="M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </button>
      )}
      <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.07em' }}>
        {d.category?.toUpperCase()}
      </div>
      <div style={{
        fontSize: 13,
        color: '#FBF5EC',
        lineHeight: 1.6,
        fontFamily: 'var(--font-display)',
        fontStyle: 'italic',
        transition: 'opacity 0.3s ease',
        opacity: regenerating ? 0.4 : 1,
      }}>
        {d.fact}
      </div>
    </div>
  );
}


// ── Vault Echoes card ─────────────────────────────────────────────────────────

function VaultEchoesCard({ data }: { data: BriefingContent['vaultEchoes'] }) {
  if (!data) return <AllClear />;
  if (hasError(data)) return <SectionError error={(data as { error: string }).error} />;
  const d = data as VaultEchoesSection;
  const hasContent = d.recentNotes?.length || d.reflection || d.focusSuggestion;
  if (!hasContent) return <AllClear />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {d.reflection && (
        <div style={{
          fontSize: 13,
          color: '#FBF5EC',
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          lineHeight: 1.5,
          borderLeft: '2px solid #A89E91',
          paddingLeft: 12,
        }}>
          {d.reflection}
        </div>
      )}
      {d.focusSuggestion && (
        <div style={{ fontSize: 12, color: '#EADFD0', lineHeight: 1.5 }}>{d.focusSuggestion}</div>
      )}
      {d.recentNotes?.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.07em', marginBottom: 6 }}>RECENT NOTES</div>
          {d.recentNotes.map((n, i) => (
            <div key={i} style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 3 }}>
              {n.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function BriefingModal({
  content,
  onClose,
  onRegenerate,
  onRegenerateFact,
  regenerating,
  scrollToSection,
  onNavigateToTrackers,
  onNavigateToCareer,
}: {
  content: BriefingContent;
  onClose: () => void;
  onRegenerate: () => void;
  onRegenerateFact: () => void;
  regenerating: boolean;
  scrollToSection?: string | null;
  onNavigateToTrackers?: () => void;
  onNavigateToCareer?: (tab?: string) => void;
}) {
  const { overlayStyle } = useModalPosition();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Body scroll lock + hide underlying chat hero
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => { document.body.classList.remove('modal-open'); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (scrollToSection) {
      // Small delay to let the modal render
      const t = setTimeout(() => {
        const el = document.getElementById(`section-${scrollToSection}`);
        if (el && bodyRef.current) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 80);
      return () => clearTimeout(t);
    }
  }, [scrollToSection]);

  const generatedAt = content.generatedAt;
  const dateLabel = generatedAt
    ? new Date(generatedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (!mounted) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{ ...overlayStyle, background: 'rgba(10, 8, 14, 0.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', zIndex: 1000 }}
    >
      <div
        className="modal-panel"
        style={{
          background: '#1C1822',
          borderRadius: 20,
          width: '90vw',
          maxWidth: 1280,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(255,235,210,0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.08em', marginBottom: 3 }}>
              DAILY BRIEF
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#FBF5EC', fontFamily: 'var(--font-display)' }}>
              {dateLabel}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              style={{
                height: 30,
                padding: '0 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,235,210,0.13)',
                background: regenerating ? '#221E2A' : '#2A2533',
                color: regenerating ? '#766D62' : '#A89E91',
                fontSize: 11,
                fontFamily: 'var(--font-jetbrains-mono)',
                cursor: regenerating ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {regenerating ? (
                <>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Regenerating…
                </>
              ) : (
                <>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 4v6h6" /><path d="M23 20v-6h-6" />
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
                  </svg>
                  Regenerate
                </>
              )}
            </button>
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 8, border: 'none',
                background: '#221E2A', color: '#A89E91', cursor: 'pointer',
                fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          </div>
        </div>

        {/* Body — magazine 2-column grid */}
        <div
          ref={bodyRef}
          className="thin-scroll"
          style={{ overflowY: 'auto', padding: '18px 24px 28px', flex: 1 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Row 1: Daily Recap — full width hero */}
            <div style={{ gridColumn: '1 / -1' }}>
              <SectionCard id="section-dailyRecap" section="dailyRecap">
                <DailyRecapCard data={content.dailyRecap} />
              </SectionCard>
            </div>

            {/* Row 2: Today | Markets */}
            <SectionCard id="section-today" section="today">
              <TodayCard data={content.today} onNavigateToTrackers={onNavigateToTrackers} />
            </SectionCard>
            <SectionCard id="section-markets" section="markets">
              <MarketsCard data={content.markets} />
            </SectionCard>

            {/* Row 3: Tech & AI | World News */}
            <SectionCard id="section-techAI" section="techAI">
              <TechAICard data={content.techAI} />
            </SectionCard>
            <SectionCard id="section-worldNews" section="worldNews">
              <WorldNewsCard data={content.worldNews} />
            </SectionCard>

            {/* Row 4: Career Beat — full width emphasized */}
            <div style={{ gridColumn: '1 / -1' }}>
              <SectionCard id="section-career" section="career">
                <CareerCard data={content.career} onNavigateToCareer={onNavigateToCareer} />
              </SectionCard>
            </div>

            {/* Row 5: Did You Know — full width */}
            <div style={{ gridColumn: '1 / -1' }}>
              <SectionCard id="section-didYouKnow" section="didYouKnow">
                <DidYouKnowCard data={content.didYouKnow} onRegenerate={onRegenerateFact} />
              </SectionCard>
            </div>

            {/* Row 6: Vault Echoes — full width */}
            <div style={{ gridColumn: '1 / -1' }}>
              <SectionCard id="section-vaultEchoes" section="vaultEchoes">
                <VaultEchoesCard data={content.vaultEchoes} />
              </SectionCard>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BriefingModule({ onModalOpenChange, onNavigateToCareer }: { onModalOpenChange?: (open: boolean) => void; onNavigateToCareer?: (tab?: string) => void }) {
  const [briefing, setBriefing] = useState<BriefingContent | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [scrollToSection, setScrollToSection] = useState<string | null>(null);
  const swrInitRef = useRef(false);

  useEffect(() => { onModalOpenChange?.(expanded); }, [expanded, onModalOpenChange]);

  const { data: briefingData, isLoading: briefingFetching } = useStableData<{ raw?: BriefingContent; highlights?: Highlight[]; error?: string }>('/api/briefing/today');

  async function doRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch('/api/briefing/regenerate', { method: 'POST' });
      const d = await res.json() as { content?: unknown };
      if (d.content && typeof d.content === 'object') {
        const bc = d.content as BriefingContent;
        setBriefing(bc);
        setHighlights(bc.highlights ?? []);
      }
    } catch {}
    setRegenerating(false);
  }

  useEffect(() => {
    if (briefingFetching || swrInitRef.current) return;
    swrInitRef.current = true;
    if (briefingData?.raw) {
      setBriefing(briefingData.raw as BriefingContent);
      setHighlights(briefingData.highlights ?? []);
      setLoading(false);
    } else {
      doRegenerate().finally(() => setLoading(false));
    }
  }, [briefingData, briefingFetching]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleHighlightClick(h: Highlight) {
    setScrollToSection(h.section);
    setExpanded(true);
  }

  function handleNavigateToTrackers() {
    setExpanded(false);
    setScrollToSection(null);
  }

  function handleNavigateToCareer(tab?: string) {
    setExpanded(false);
    setScrollToSection(null);
    onNavigateToCareer?.(tab);
  }

  // Clear scrollToSection after modal uses it
  useEffect(() => {
    if (scrollToSection && expanded) {
      const t = setTimeout(() => setScrollToSection(null), 500);
      return () => clearTimeout(t);
    }
  }, [scrollToSection, expanded]);

  async function doRegenerateFact() {
    try {
      const res = await fetch('/api/briefing/regenerate-fact', { method: 'POST' });
      const d = await res.json() as { didYouKnow?: unknown };
      if (d.didYouKnow && briefing) {
        setBriefing({ ...briefing, didYouKnow: d.didYouKnow as BriefingContent['didYouKnow'] });
      }
    } catch {}
  }

  return (
    <>
      <CollapsibleModule title="Today's Briefing" index="01" live={true} onExpand={() => { setScrollToSection(null); setExpanded(true); }}>
        <div style={{ padding: '0 16px 14px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 36, borderRadius: 8 }} />
              ))}
            </div>
          ) : regenerating ? (
            <div style={{ fontSize: 12, color: '#766D62', textAlign: 'center', padding: '10px 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
              Generating briefing…
            </div>
          ) : highlights.length === 0 ? (
            <div style={{ fontSize: 12, color: '#766D62', textAlign: 'center', padding: '8px 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
              All clear today
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {highlights.map((h, i) => (
                <button
                  key={i}
                  onClick={() => handleHighlightClick(h)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 8px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    transition: 'background 120ms ease',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,235,210,0.05)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    <HighlightIcon type={h.type} />
                  </span>
                  <span style={{
                    fontSize: 12,
                    color: '#EADFD0',
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}>
                    {h.text}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </CollapsibleModule>

      {expanded && briefing && (
        <BriefingModal
          content={briefing}
          onClose={() => { setExpanded(false); setScrollToSection(null); }}
          onRegenerate={doRegenerate}
          onRegenerateFact={doRegenerateFact}
          regenerating={regenerating}
          scrollToSection={scrollToSection}
          onNavigateToTrackers={handleNavigateToTrackers}
          onNavigateToCareer={handleNavigateToCareer}
        />
      )}
    </>
  );
}
