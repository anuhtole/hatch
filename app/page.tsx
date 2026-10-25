'use client';

import { useState, useEffect } from 'react';
import NotionSidebar from '@/components/shell/NotionSidebar';
import HomeView from '@/components/home/HomeView';
import EmailView from '@/components/EmailView';
import CalendarView from '@/components/CalendarView';
import CareerView from '@/components/CareerView';
import type { CareerTab } from '@/components/CareerView';
import SettingsView from '@/components/SettingsView';
import { LayoutProvider } from '@/lib/layout-context';
import { FEATURES } from '@/lib/feature-flags';

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';

export default function Home() {
  const [view, setView] = useState<View>('home');
  const [careerTab, setCareerTab] = useState<CareerTab>('dashboard');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlView = params.get('view') as View | null;
    const validViews: View[] = ['home', 'email', 'calendar', 'career', 'settings']
      .filter((v) => v !== 'career' || FEATURES.CAREER) as View[];
    if (urlView && validViews.includes(urlView)) setView(urlView);
    if (params.get('connected')) sessionStorage.setItem('aria_oauth_connected', params.get('connected')!);
    if (params.get('error')) sessionStorage.setItem('aria_oauth_error', params.get('error')!);
    if (params.toString()) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  function navigateToCareer(tab?: string) {
    if (!FEATURES.CAREER) return;
    if (tab) setCareerTab(tab as CareerTab);
    setView('career');
  }

  const views: Record<View, React.ReactNode> = {
    home:     <HomeView onNavigateToCareer={navigateToCareer} />,
    email:    <EmailView />,
    calendar: <CalendarView />,
    career:   FEATURES.CAREER ? <CareerView initialTab={careerTab} /> : <HomeView onNavigateToCareer={navigateToCareer} />,
    settings: <SettingsView />,
  };

  return (
    <LayoutProvider>
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
        background: 'var(--bg-paper)',
      }}>
        <NotionSidebar active={view} onNavigate={setView} />
        <main
          key={view}
          style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}
        >
          {views[view]}
        </main>
      </div>
    </LayoutProvider>
  );
}
