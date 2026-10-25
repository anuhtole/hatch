'use client';

import { useState, useEffect } from 'react';
import NotionSidebar from '@/components/shell/NotionSidebar';
import AllChatsView from '@/components/chats/AllChatsView';
import { LayoutProvider } from '@/lib/layout-context';
import { useRouter } from 'next/navigation';
import { FEATURES } from '@/lib/feature-flags';

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';

// /chats — full-page conversation browser. C2 swaps the C1 stub for the
// real AllChatsView surface (search + Starred filter + per-row menu).
export default function ChatsPage() {
  const router = useRouter();
  const [active, setActive] = useState<View>('home');

  // On /chats we don't highlight a primary nav chip; sidebar nav clicks
  // route the user back to /?view=… so the SPA owns view switching there.
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
          <AllChatsView />
        </main>
      </div>
    </LayoutProvider>
  );
}
