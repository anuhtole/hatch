'use client';

import { useEffect, useState } from 'react';
import { prefetchUrls } from '@/lib/swr-config';

const HOME_PREFETCH_URLS = [
  '/api/briefing/today',
  '/api/todos',
  '/api/trackers',
  '/api/conversations',
  '/api/canvas/assignments?days=30',
  '/api/stocks/quote?symbols=XLK,SCHG,MSFT,SPY&range=1W',
];

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';

type Props = {
  active: View;
  onNavigate: (view: View) => void;
  syncStatus: 'synced' | 'stale' | 'syncing';
  lastSyncedAt: Date | null;
  onSync: () => void;
};

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

// ── Icons ──────────────────────────────────────────────────────────────────────

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function IconEmail() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <polyline points="2,4 12,13 22,4"/>
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function IconBriefcase() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      <line x1="12" y1="12" x2="12" y2="17"/>
      <line x1="9" y1="14" x2="15" y2="14"/>
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function IconSync() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <polyline points="23 20 23 14 17 14"/>
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>
    </svg>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────────

const navItems: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'home',     label: 'Home',     icon: <IconHome /> },
  { id: 'email',    label: 'Email',    icon: <IconEmail /> },
  { id: 'calendar', label: 'Calendar', icon: <IconCalendar /> },
  { id: 'career',   label: 'Career',   icon: <IconBriefcase /> },
  { id: 'settings', label: 'Settings', icon: <IconSettings /> },
];

export default function Sidebar({ active, onNavigate, syncStatus, lastSyncedAt, onSync }: Props) {
  const relativeTime = useRelativeTime(lastSyncedAt);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ id: string; y: number } | null>(null);

  const syncColor =
    syncStatus === 'synced'  ? '#8FC89A' :
    syncStatus === 'syncing' ? '#E8B87A' : '#766D62';

  return (
    <aside style={{
      width: 72,
      minWidth: 72,
      background: '#1C1822',
      borderRight: '1px solid rgba(255,235,210,0.07)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '20px 0',
      position: 'relative',
      zIndex: 10,
    }}>

      {/* Logo */}
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: 'linear-gradient(135deg, #7EB8D6 0%, #5BA3C9 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 700,
        fontSize: 15,
        fontFamily: 'var(--font-jetbrains-mono)',
        boxShadow: '0 4px 12px rgba(126,184,214,0.4)',
        marginBottom: 24,
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}>
        S
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, width: '100%', padding: '0 12px', alignItems: 'center' }}>
        {navItems.map((item) => {
          const isActive = item.id === active;
          const isHovered = hoveredItem === item.id;
          return (
            <div key={item.id} style={{ position: 'relative', width: '100%' }}>
              <button
                onClick={() => onNavigate(item.id)}
                onMouseEnter={(e) => {
                  setHoveredItem(item.id);
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setTooltip({ id: item.id, y: rect.top + rect.height / 2 });
                  if (item.id === 'home') prefetchUrls(HOME_PREFETCH_URLS);
                }}
                onMouseLeave={() => { setHoveredItem(null); setTooltip(null); }}
                style={{
                  width: '100%',
                  height: 44,
                  borderRadius: 12,
                  border: 'none',
                  background: isActive ? '#221E2A' : isHovered ? 'rgba(255,235,210,0.05)' : 'transparent',
                  color: isActive ? '#FBF5EC' : isHovered ? '#EADFD0' : '#766D62',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
                }}
              >
                {item.icon}
              </button>
            </div>
          );
        })}
      </nav>

      {/* Sync */}
      <button
        onClick={syncStatus !== 'syncing' ? onSync : undefined}
        onMouseEnter={() => setHoveredItem('_sync')}
        onMouseLeave={() => setHoveredItem(null)}
        title={syncStatus === 'syncing' ? 'Syncing…' : lastSyncedAt ? `Synced ${relativeTime}` : 'Sync now'}
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          border: 'none',
          background: hoveredItem === '_sync' ? 'rgba(255,235,210,0.05)' : 'transparent',
          color: syncColor,
          cursor: syncStatus !== 'syncing' ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 200ms ease',
          marginTop: 8,
          animation: syncStatus === 'syncing' ? 'spin 1s linear infinite' : 'none',
        }}
      >
        <IconSync />
      </button>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: 80,
          top: tooltip.y - 16,
          background: '#221E2A',
          color: '#FBF5EC',
          padding: '6px 12px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          zIndex: 1000,
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          animation: 'fade-in 100ms ease both',
        }}>
          {navItems.find(n => n.id === tooltip.id)?.label ?? ''}
          <div style={{
            position: 'absolute',
            left: -4,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 0,
            height: 0,
            borderTop: '4px solid transparent',
            borderBottom: '4px solid transparent',
            borderRight: '4px solid #221E2A',
          }} />
        </div>
      )}
    </aside>
  );
}
