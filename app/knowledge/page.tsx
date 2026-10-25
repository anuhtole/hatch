'use client';

import { useState, useEffect } from 'react';
import NotionSidebar from '@/components/shell/NotionSidebar';
import KnowledgeView from '@/components/knowledge/KnowledgeView';
import { LayoutProvider } from '@/lib/layout-context';
import { useRouter } from 'next/navigation';
import { FEATURES } from '@/lib/feature-flags';

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';

export default function KnowledgePage() {
  const router = useRouter();
  const [active, setActive] = useState<View>('home');
  useEffect(() => { setActive('home'); }, []);

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
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <KnowledgeView />
        </main>
      </div>
    </LayoutProvider>
  );
}
