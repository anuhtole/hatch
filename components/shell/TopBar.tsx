'use client';

import { useEffect, useState } from 'react';
import { prefetchUrls } from '@/lib/swr-config';
import { FEATURES } from '@/lib/feature-flags';

const HOME_PREFETCH_URLS = [
  '/api/briefing/today',
  '/api/todos',
  '/api/trackers',
  '/api/conversations',
  '/api/canvas/assignments?days=14',
  '/api/stocks/quote?symbols=XLK,SCHG,MSFT,SPY&range=1W',
];

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';
type SyncStatus = 'synced' | 'stale' | 'syncing';

type Props = {
  active: View;
  onNavigate: (view: View) => void;
  syncStatus: SyncStatus;
  lastSyncedAt: Date | null;
  onSync: () => void;
};

const ALL_SPACES: { id: View; label: string; flag?: keyof typeof FEATURES }[] = [
  { id: 'home',     label: 'Home' },
  { id: 'email',    label: 'Mail' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'career',   label: 'Career', flag: 'CAREER' },
  { id: 'settings', label: 'Settings' },
];

// Hide nav chips whose feature flag is off (post-2026-06 product pivot).
const SPACES = ALL_SPACES.filter((s) => !s.flag || FEATURES[s.flag]);

function useRelativeTime(date: Date | null): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!date) { setLabel('Never synced'); return; }
    function compute() {
      const seconds = Math.floor((Date.now() - date!.getTime()) / 1000);
      if (seconds < 60) return 'just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    }
    setLabel(compute());
    const interval = setInterval(() => setLabel(compute()), 30_000);
    return () => clearInterval(interval);
  }, [date]);
  return label;
}

function IconSync({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'spin-cw' : undefined}
    >
      <polyline points="1 4 1 10 7 10" />
      <polyline points="23 20 23 14 17 14" />
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  );
}

export default function TopBar({ active, onNavigate, syncStatus, lastSyncedAt, onSync }: Props) {
  const relativeTime = useRelativeTime(lastSyncedAt);
  const syncTitle =
    syncStatus === 'syncing' ? 'Syncing…' :
    lastSyncedAt ? `Synced ${relativeTime}` : 'Sync now';

  return (
    <header
      className="topbar-glass"
      style={{
        height: 48,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        position: 'relative',
        zIndex: 40,
      }}
    >
      {/* Left — brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 220 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(244,162,97,0.2), rgba(135,206,224,0.15))',
            border: '1px solid rgba(255,245,230,0.1)',
            color: 'var(--accent-warm)',
          }}
        >
          <IconSparkles />
        </div>
        <span
          className="font-display"
          style={{
            fontStyle: 'italic',
            fontSize: 15,
            letterSpacing: '-0.01em',
            color: 'var(--text-warm)',
          }}
        >
          Hatch
        </span>
      </div>

      {/* Center — space chips */}
      <nav style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 4 }}>
        {SPACES.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              onClick={() => onNavigate(s.id)}
              onMouseEnter={() => { if (s.id === 'home') prefetchUrls(HOME_PREFETCH_URLS); }}
              className={isActive ? 'space-tab-active' : 'space-tab'}
              style={{
                height: 28,
                padding: '0 12px',
                borderRadius: 999,
                fontSize: 12.5,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-inter), system-ui, sans-serif',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Right — sync, search/cmd-K, avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 220, justifyContent: 'flex-end' }}>
        <button
          className="shell-sync"
          data-status={syncStatus}
          onClick={syncStatus !== 'syncing' ? onSync : undefined}
          title={syncTitle}
          style={{
            height: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px',
            borderRadius: 999,
            fontSize: 10.5,
            fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
            cursor: syncStatus === 'syncing' ? 'default' : 'pointer',
          }}
        >
          <IconSync spinning={syncStatus === 'syncing'} />
          <span style={{ opacity: 0.8 }}>{syncStatus === 'syncing' ? 'syncing' : (lastSyncedAt ? relativeTime : 'sync')}</span>
        </button>

        <button
          className="cmd-trigger"
          // Palette is out of scope for Step 1 — visual only.
          onClick={() => { /* Step 2: open command palette */ }}
          style={{
            height: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 6px 0 10px',
            borderRadius: 999,
          }}
        >
          <IconSearch />
          <span style={{
            fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
            fontSize: 10.5,
            opacity: 0.5,
          }}>Search</span>
          <span
            style={{
              fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
              fontSize: 9.5,
              opacity: 0.5,
              padding: '1px 4px',
              marginLeft: 2,
              borderRadius: 4,
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-thin)',
            }}
          >⌘K</span>
        </button>

        <div
          className="warm-pulse"
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #f5a662, #d97e3a)',
            color: '#2a1a08',
            fontWeight: 500,
            fontSize: 13,
            fontFamily: 'var(--font-fraunces), Georgia, serif',
          }}
        >
          A
        </div>
      </div>
    </header>
  );
}
