'use client';

import type { ReactNode } from 'react';

const PILLS = [
  'Brief me on tonight',
  "What's due this week?",
  'Draft a reply',
];

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatHeaderDate(d: Date): string {
  const day = d.toLocaleDateString(undefined, { weekday: 'long' });
  const month = d.toLocaleDateString(undefined, { month: 'long' });
  const date = d.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${month} ${date} · ${time}`;
}

function Chevron(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6, opacity: 0.4 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function EmptyHero({
  onQuickAction,
  now,
}: {
  onQuickAction: (text: string) => void;
  now: Date;
}) {
  return (
    <div
      data-chat-hero
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 640 }}>
        <div
          className="hero-rise"
          style={{
            fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
            fontSize: 10.5,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            opacity: 0.4,
            marginBottom: 20,
            color: 'var(--text-warm)',
          }}
        >
          {formatHeaderDate(now)}
        </div>

        <h1
          className="font-display hero-rise stagger-1"
          style={{
            fontSize: 'clamp(40px, 5.2vw, 68px)',
            fontWeight: 300,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            color: 'var(--text-warm)',
            textShadow: '0 0 80px rgba(244,162,97,0.18), 0 0 24px rgba(244,162,97,0.08)',
            margin: 0,
          }}
        >
          {greetingFor(now)},
          <br />
          <span
            className="font-display"
            style={{ fontStyle: 'italic', fontWeight: 300, color: 'var(--accent-warm)' }}
          >
            Anatole
          </span>
          .
        </h1>

        <p
          className="font-display hero-rise stagger-2"
          style={{
            fontStyle: 'italic',
            marginTop: 20,
            fontSize: 15.5,
            color: 'var(--text-muted)',
            fontWeight: 300,
          }}
        >
          Two unread emails worth reading. One assignment due tonight.
        </p>

        <div
          className="hero-rise stagger-3"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
            marginTop: 32,
          }}
        >
          {PILLS.map((p) => (
            <button
              key={p}
              onClick={() => onQuickAction(p)}
              className="glass-pill"
              style={{
                borderRadius: 999,
                padding: '6px 14px',
                fontSize: 12.5,
                display: 'inline-flex',
                alignItems: 'center',
                fontFamily: 'var(--font-inter), system-ui, sans-serif',
              }}
            >
              <span style={{ opacity: 0.8 }}>{p}</span>
              <Chevron />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
