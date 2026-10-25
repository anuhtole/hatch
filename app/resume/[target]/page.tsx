'use client';

/**
 * /resume/<target> — per-target detail (B-44). Mounts <TargetDetail> on the same
 * Notion shell wrapper as /resume (app/resume/page.tsx). Research targets show the
 * outreach surface; industry targets show the application container.
 */

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import NotionSidebar from '@/components/shell/NotionSidebar';
import TargetDetail from '@/components/resume/TargetDetail';
import { LayoutProvider } from '@/lib/layout-context';
import { FEATURES } from '@/lib/feature-flags';

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';

export default function TargetDetailPage() {
  const router = useRouter();
  const params = useParams();
  const raw = params.target;
  const target = decodeURIComponent(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''));
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
          <TargetDetail target={target} />
        </main>
      </div>
    </LayoutProvider>
  );
}
