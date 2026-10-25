'use client';

// Original Career-section client layout. Preserved here so flipping
// FEATURES.CAREER back to true fully restores the dashboard, TopBar
// wiring, and sync controls without any other code changes.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/shell/TopBar';
import { LayoutProvider } from '@/lib/layout-context';

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';
type SyncStatus = 'synced' | 'stale' | 'syncing';

export default function CareerLayoutShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('stale');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetch('/api/sync/status')
      .then((r) => r.json())
      .then((data: { lastSyncedAt?: string | null }) => {
        if (!data.lastSyncedAt) { setSyncStatus('stale'); return; }
        const lastSync = new Date(data.lastSyncedAt);
        setLastSyncedAt(lastSync);
        const hoursSince = (Date.now() - lastSync.getTime()) / 3_600_000;
        setSyncStatus(hoursSince < 24 ? 'synced' : 'stale');
      })
      .catch(() => setSyncStatus('stale'));
  }, []);

  function handleNavigate(view: View) {
    if (view === 'career') {
      router.push('/career');
    } else {
      router.push(`/?view=${view}`);
    }
  }

  async function handleSync() {
    if (syncStatus === 'syncing') return;
    setSyncStatus('syncing');
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json() as { syncedAt?: string; lastSyncedAt?: string };
      const ts = data.syncedAt ?? data.lastSyncedAt ?? null;
      if (ts) {
        setLastSyncedAt(new Date(ts));
        setSyncStatus('synced');
      } else {
        setSyncStatus('stale');
      }
    } catch {
      setSyncStatus('stale');
    }
  }

  return (
    <LayoutProvider>
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <TopBar
          active="career"
          onNavigate={handleNavigate}
          syncStatus={syncStatus}
          lastSyncedAt={lastSyncedAt}
          onSync={handleSync}
        />
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>
      </div>
    </LayoutProvider>
  );
}
