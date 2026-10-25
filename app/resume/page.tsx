'use client';

/**
 * /resume — Resume Studio (B-9). Standalone page on the live Notion shell.
 * (The career section is feature-flagged off since the 2026-06 pivot; the
 * Resume Studio therefore mounts here, not under /career.)
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NotionSidebar from '@/components/shell/NotionSidebar';
import ResumeStudio from '@/components/resume/ResumeStudio';
import { LayoutProvider } from '@/lib/layout-context';
import { FEATURES } from '@/lib/feature-flags';

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';

export default function ResumeStudioPage() {
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
          <ResumeStudio />
        </main>
      </div>
    </LayoutProvider>
  );
}
