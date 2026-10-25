'use client';

import { useState } from 'react';
import type { DiscoverySegment, DiscoveryGroup } from '@/lib/chat-context';

/**
 * DiscoveryCard (B-13) — inline lab-discovery shortlist for the chat stream.
 *
 * Renders the B-10 discovery output (published pages only): ranked groups with
 * fit scores, CITED rationales, and verbatim published contact routes — or
 * "application page only" when no contact is published. Never shows a guessed
 * address; the underlying pipeline structurally cannot produce one.
 */

const C = {
  surface: '#FFFFFF',
  border:  '#E8E4DF',
  accent:  '#7EB8D6',
  accentBg:'#E8F2F8',
  ink:     '#1A1A1A',
  dim:     '#6B6B7B',
  mute:    '#9B9BAB',
  warn:    '#E0A458',
  mono:    'var(--font-jetbrains-mono), monospace',
};

function ContactLine({ g }: { g: DiscoveryGroup }) {
  if (!g.contact) {
    return <span style={{ color: C.warn, fontFamily: C.mono, fontSize: 11.5 }}>application page only — no published contact</span>;
  }
  const label = g.contact.kind === 'email' ? g.contact.value : 'application page';
  return (
    <span style={{ fontFamily: C.mono, fontSize: 11.5, color: C.ink }}>
      {g.contact.kind === 'email' ? (
        <>{label}</>
      ) : (
        <a href={g.contact.value} target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>{label} ↗</a>
      )}
      {' '}
      <a href={g.contact.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.mute, textDecoration: 'none' }}>
        (published source ↗)
      </a>
    </span>
  );
}

function GroupRow({ g, rank }: { g: DiscoveryGroup; rank: number }) {
  const [open, setOpen] = useState(rank === 1);
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: '9px 0' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'baseline', gap: 8, width: '100%',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontFamily: C.mono, fontSize: 11, color: C.mute, flexShrink: 0 }}>#{rank}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink, flex: 1 }}>
          {g.name}{g.pi ? <span style={{ fontWeight: 400, color: C.dim }}> — PI: {g.pi}</span> : null}
        </span>
        <span style={{
          fontFamily: C.mono, fontSize: 11, color: C.accent, background: C.accentBg,
          borderRadius: 6, padding: '2px 8px', flexShrink: 0,
        }}>
          fit {g.fitScore}
        </span>
        <span style={{ fontSize: 9, color: C.mute }}>{open ? '▲' : '▼'}</span>
      </button>

      <div style={{ marginTop: 5, paddingLeft: 26 }}>
        <ContactLine g={g} />
        {open && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {g.rationales.map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: C.dim, lineHeight: 1.55 }}>
                {r.text}{' '}
                <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontSize: 11, fontFamily: C.mono }}>
                  [source ↗]
                </a>
              </div>
            ))}
            {g.undergradProcess && (
              <div style={{ fontSize: 11.5, color: C.dim, fontStyle: 'italic' }}>
                Stated process: “{g.undergradProcess}”
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DiscoveryCard({ seg }: { seg: DiscoverySegment }) {
  const gen = new Date(seg.generatedAt);
  const genLabel = isNaN(gen.getTime()) ? seg.generatedAt : gen.toLocaleString();

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface,
      padding: 14, maxWidth: 560, width: '100%',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontFamily: C.mono, fontWeight: 700, color: C.ink, letterSpacing: '0.03em' }}>
          DISCOVERY SHORTLIST — {seg.lab.toUpperCase()}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: C.mono, color: C.mute }}>
          generated {genLabel}
        </span>
      </div>
      <div style={{ fontSize: 11, color: C.mute, marginBottom: 6, lineHeight: 1.5 }}>
        Published pages only · contacts shown verbatim from their source page · no guessed addresses
      </div>
      {seg.shortlist.map((g, i) => (
        <GroupRow key={g.name} g={g} rank={i + 1} />
      ))}
    </div>
  );
}
