'use client';

import { useState } from 'react';
import NetworkView from './wiki/NetworkView';
import LivingResume from './wiki/LivingResume';

type Tab = 'network' | 'resume';

const TABS: { id: Tab; label: string }[] = [
  { id: 'network', label: 'Network' },
  { id: 'resume', label: 'Living Resume' },
];

export default function WikiView() {
  const [tab, setTab] = useState<Tab>('network');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#17141C' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px 0', flexShrink: 0 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: '#FBF5EC', margin: 0, letterSpacing: '-0.02em' }}>Wiki</h1>
        <p style={{ fontSize: 13, color: '#766D62', margin: '2px 0 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
          Network & living resume
        </p>
        <div className="pill-tabs" style={{ marginTop: 20, marginBottom: 0 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pill-tab${tab === t.id ? ' active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {tab === 'network' && <NetworkView />}
        {tab === 'resume' && <LivingResume />}
      </div>
    </div>
  );
}
