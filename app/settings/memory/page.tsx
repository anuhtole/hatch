'use client';

import { useState, useEffect } from 'react';

type MemoryFileStatus = {
  slug: string;
  subdir: string;
  type: string;
  lastVerified: string | null;
  daysOld: number | null;
  confidence: number | null;
  source: string | null;
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
};

type StatusData = {
  people: MemoryFileStatus[];
  projects: MemoryFileStatus[];
  gapsSummary: string[];
};

const FRESHNESS_COLOR: Record<string, string> = {
  fresh:   '#5BB98C',
  aging:   '#E0A458',
  stale:   '#D4645C',
  unknown: '#6B6B7B',
};

const FRESHNESS_LABEL: Record<string, string> = {
  fresh:   'fresh',
  aging:   'aging',
  stale:   'stale',
  unknown: '—',
};

function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: '#6B6B7B', fontSize: 12 }}>—</span>;
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? '#5BB98C' : value >= 0.5 ? '#E0A458' : '#D4645C';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 60, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color }} />
      </div>
      <span style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>{pct}%</span>
    </div>
  );
}

function MemoryTable({ rows, title }: { rows: MemoryFileStatus[]; title: string }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 13, fontFamily: 'var(--font-jetbrains-mono)', color: '#9B9BAB', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
        {title} <span style={{ color: '#6B6B7B' }}>({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p style={{ color: '#6B6B7B', fontSize: 13 }}>No files found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['Slug', 'Freshness', 'Last verified', 'Confidence', 'Source'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 12px 10px', color: '#6B6B7B', fontWeight: 500, fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, letterSpacing: '0.04em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '9px 12px', color: '#E8E8ED', fontFamily: 'var(--font-jetbrains-mono)', fontSize: 12 }}>
                  {r.slug}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    color: FRESHNESS_COLOR[r.freshness],
                    fontFamily: 'var(--font-jetbrains-mono)',
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: FRESHNESS_COLOR[r.freshness], display: 'inline-block' }} />
                    {FRESHNESS_LABEL[r.freshness]}
                    {r.daysOld !== null && <span style={{ color: '#6B6B7B' }}>({r.daysOld}d)</span>}
                  </span>
                </td>
                <td style={{ padding: '9px 12px', color: '#8888A0', fontSize: 12, fontFamily: 'var(--font-jetbrains-mono)' }}>
                  {r.lastVerified ?? '—'}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <ConfidenceBar value={r.confidence} />
                </td>
                <td style={{ padding: '9px 12px', color: '#6B6B7B', fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)' }}>
                  {r.source ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function MemorySettingsPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/memory/status');
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function runRealityCheck() {
    setRunning(true);
    try {
      const res = await fetch('/api/memory/reality-check', { method: 'POST' });
      const json = await res.json();
      setLastRun(`Done — ${json.newPeopleCount ?? 0} new people, ${json.gapCount ?? 0} gaps, ${json.emailUpdates ?? 0} email updates`);
      await load();
    } catch (err) {
      setLastRun(`Error: ${err}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      color: '#E8E8ED',
      fontFamily: 'var(--font-dm-sans, system-ui)',
      padding: '48px 40px',
      maxWidth: 900,
      margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 40 }}>
        <div>
          <a href="/" style={{ color: '#6B6B7B', fontSize: 12, fontFamily: 'var(--font-jetbrains-mono)', textDecoration: 'none', display: 'block', marginBottom: 16 }}>
            ← Back to Hatch
          </a>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Memory</h1>
          <p style={{ color: '#6B6B7B', fontSize: 13, marginTop: 6 }}>
            Vault-backed memory files — people &amp; projects tracked across conversations.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <button
            onClick={runRealityCheck}
            disabled={running}
            style={{
              background: running ? 'rgba(110,86,207,0.2)' : 'rgba(110,86,207,0.85)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              cursor: running ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {running ? 'Running…' : 'Run Reality Check'}
          </button>
          {lastRun && (
            <span style={{ fontSize: 11, color: '#5BB98C', fontFamily: 'var(--font-jetbrains-mono)' }}>
              {lastRun}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#6B6B7B', fontSize: 13 }}>Loading memory files…</p>
      ) : !data ? (
        <p style={{ color: '#D4645C', fontSize: 13 }}>Failed to load memory status.</p>
      ) : (
        <>
          <MemoryTable rows={data.people} title="People" />
          <MemoryTable rows={data.projects} title="Projects" />

          {data.gapsSummary.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--font-jetbrains-mono)', color: '#9B9BAB', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                Gaps
              </h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {data.gapsSummary.map((g, i) => (
                  <li key={i} style={{ fontSize: 12, color: '#E0A458', fontFamily: 'var(--font-jetbrains-mono)', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
