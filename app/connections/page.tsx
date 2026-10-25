'use client';

/**
 * /connections — LinkedIn Connections (B-37). Standalone page on the live Notion
 * shell, mirroring app/resume/page.tsx exactly. Mounts the intact NetworkView
 * (LinkedIn CSV import + /api/network/* + Prisma ContactEntry). The legacy career
 * section stays feature-flagged off; Connections mounts here, not under /career.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NotionSidebar from '@/components/shell/NotionSidebar';
import NetworkView from '@/components/wiki/NetworkView';
import { LayoutProvider } from '@/lib/layout-context';
import { FEATURES } from '@/lib/feature-flags';

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';

export default function ConnectionsPage() {
  const router = useRouter();
  const [active] = useState<View>('home');

  function onNavigate(v: View) {
    if (!FEATURES.CAREER && v === 'career') return;
    router.push(`/?view=${v}`);
  }

  return (
    <LayoutProvider>
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
        background: 'var(--bg-paper)',
      }}>
        <NotionSidebar active={active} onNavigate={onNavigate} />
        <main style={{ flex: 1, overflowY: 'auto', minWidth: 0, padding: '28px 32px' }}>
          <NetworkView />
        </main>
      </div>
    </LayoutProvider>
  );
}
