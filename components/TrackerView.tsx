'use client';

import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type MonitorType = 'url' | 'search' | 'status' | 'custom';
type Frequency = 'hourly' | 'daily' | 'weekly';
type Color = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'orange';

interface TrackerHistory {
  id: string;
  status: string;
  details?: string;
  checkedAt: string;
}

interface Tracker {
  id: string;
  title: string;
  description?: string;
  category?: string;
  monitorType: MonitorType;
  monitorConfig: string;
  currentStatus?: string;
  previousStatus?: string;
  lastChecked?: string;
  lastChanged?: string;
  checkFrequency: Frequency;
  notifyOnChange: boolean;
  isActive: boolean;
  notes?: string;
  color: Color;
  createdAt: string;
  history: TrackerHistory[];
}

// ── Color accent map (for card accents) ───────────────────────────────────────

const COLOR_ACCENTS: Record<Color, string> = {
  yellow: '#F5D800',
  blue:   '#60A5FA',
  green:  '#34D399',
  pink:   '#F472B6',
  purple: '#A78BFA',
  orange: '#FB923C',
};

const COLOR_OPTIONS: Color[] = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange'];

const COLORS: Record<Color, { bg: string; border: string; header: string; dot: string }> = {
  yellow: { bg: '#FFF9C4', border: '#F9E84A', header: '#F5D800', dot: '#C8A800' },
  blue:   { bg: '#DBEAFE', border: '#93C5FD', header: '#60A5FA', dot: '#2563EB' },
  green:  { bg: '#D1FAE5', border: '#6EE7B7', header: '#34D399', dot: '#059669' },
  pink:   { bg: '#FCE7F3', border: '#F9A8D4', header: '#F472B6', dot: '#DB2777' },
  purple: { bg: '#EDE9FE', border: '#C4B5FD', header: '#A78BFA', dot: '#7C3AED' },
  orange: { bg: '#FFEDD5', border: '#FDC58A', header: '#FB923C', dot: '#EA580C' },
};

function relativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'Never';
  const ms = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span style={{ color: '#9B9BAB', fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)' }}>Not checked</span>;
  const lower = status.toLowerCase();
  const color =
    lower.includes('error') || lower.includes('not found') ? '#D4645C' :
    lower.includes('found') || lower.includes('match') || lower.includes('open') ? '#5BB98C' :
    lower.includes('unknown') || lower.includes('misconfigured') ? '#E0A458' :
    '#6B6B7B';
  return (
    <span style={{
      fontSize: 11,
      fontFamily: 'var(--font-jetbrains-mono)',
      color,
      background: color + '18',
      border: `1px solid ${color}33`,
      borderRadius: 6,
      padding: '3px 8px',
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      display: 'inline-block',
    }}>
      {status.length > 32 ? status.slice(0, 32) + '…' : status}
    </span>
  );
}

// ── New Tracker Modal ─────────────────────────────────────────────────────────

function NewTrackerModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [monitorType, setMonitorType] = useState<MonitorType>('custom');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [color, setColor] = useState<Color>('blue');
  const [saving, setSaving] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #E8E4DF',
    background: '#F8F6F4',
    fontSize: 14,
    fontFamily: 'inherit',
    color: '#1A1A1A',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 150ms ease',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: '#9B9BAB',
    display: 'block',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontFamily: 'var(--font-jetbrains-mono)',
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);

    const monitorConfig: Record<string, string> = {};
    if (monitorType === 'url' && url) monitorConfig.url = url;
    if (monitorType === 'search' && query) monitorConfig.query = query;
    if (description) monitorConfig.description = description;

    await fetch('/api/trackers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        monitorType,
        monitorConfig,
        checkFrequency: frequency,
        color,
      }),
    });

    setSaving(false);
    onCreate();
    onClose();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="scale-in" style={{ background: '#FFFFFF', borderRadius: 24, padding: '32px 36px', width: 520, maxWidth: '90vw', boxShadow: '0 24px 80px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1A1A1A', letterSpacing: '-0.01em' }}>New Tracker</div>
            <div style={{ fontSize: 13, color: '#9B9BAB', marginTop: 2 }}>Watch anything over time</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 999, border: 'none', background: '#F0EDEA', color: '#6B6B7B', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Data 100 TA Application Status" required style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Description / What to monitor</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what you want to track. The more specific, the better." rows={3}
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Monitor type</label>
              <select value={monitorType} onChange={(e) => setMonitorType(e.target.value as MonitorType)} style={inputStyle}>
                <option value="custom">Custom (Claude + Web)</option>
                <option value="search">Web search</option>
                <option value="url">URL check</option>
                <option value="status">Status lookup</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Frequency</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} style={inputStyle}>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>

          {monitorType === 'url' && (
            <div>
              <label style={labelStyle}>URL to monitor</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={{ ...inputStyle, fontFamily: 'var(--font-jetbrains-mono)' }} />
            </div>
          )}

          {monitorType === 'search' && (
            <div>
              <label style={labelStyle}>Search query</label>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Anthropic internship 2026 applications open" style={inputStyle} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Academic, Career…" style={inputStyle} />
            </div>
            <div style={{ paddingBottom: 1 }}>
              <label style={labelStyle}>Color</label>
              <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
                {COLOR_OPTIONS.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: '50%', background: COLORS[c].header, border: color === c ? '3px solid #1A1A1A' : '2px solid transparent', cursor: 'pointer', transition: 'all 0.15s' }} />
                ))}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || !title.trim()}
            style={{
              marginTop: 8,
              padding: '12px 0',
              borderRadius: 12,
              border: 'none',
              background: saving || !title.trim() ? '#E8E4DF' : '#1A1A1A',
              color: saving || !title.trim() ? '#9B9BAB' : '#fff',
              fontSize: 14,
              fontFamily: 'inherit',
              fontWeight: 600,
              cursor: saving || !title.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 0.18s',
            }}
          >
            {saving ? 'Creating…' : 'Create Tracker'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Tracker Card ──────────────────────────────────────────────────────────────

function TrackerCard({ tracker, onClick }: { tracker: Tracker; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const accent = COLOR_ACCENTS[tracker.color as Color] ?? '#7EB8D6';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="fade-up"
      style={{
        background: '#fff',
        borderRadius: 16,
        padding: '18px 20px',
        cursor: 'pointer',
        border: '1px solid rgba(0,0,0,0.04)',
        boxShadow: hovered ? '0 8px 24px rgba(0,0,0,0.1)' : '0 1px 4px rgba(0,0,0,0.04)',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        borderLeft: `3px solid ${accent}`,
        position: 'relative',
      }}
    >
      {/* Active dot */}
      <div style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: tracker.isActive ? '#5BB98C' : '#D1D5DB',
      }} className={tracker.isActive ? 'animate-pulse-dot' : ''} />

      {/* Category */}
      {tracker.category && (
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          {tracker.category}
        </div>
      )}

      {/* Title */}
      <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1A1A1A', lineHeight: 1.35, marginBottom: 12, paddingRight: 20 }}>
        {tracker.title}
      </div>

      {/* Status */}
      <div style={{ marginBottom: 12 }}>
        <StatusBadge status={tracker.currentStatus} />
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#9B9BAB' }}>{relativeTime(tracker.lastChecked)}</span>
        <span style={{ fontSize: 10, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', background: '#F0EDEA', borderRadius: 999, padding: '2px 8px' }}>
          {tracker.checkFrequency}
        </span>
      </div>
    </div>
  );
}

// ── Detail Slide-over ─────────────────────────────────────────────────────────

function DetailSlideover({ tracker, onClose, onRefresh }: { tracker: Tracker; onClose: () => void; onRefresh: () => void }) {
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const accent = COLOR_ACCENTS[tracker.color as Color] ?? '#7EB8D6';

  async function handleCheck() {
    setChecking(true);
    await fetch(`/api/trackers/${tracker.id}/check`, { method: 'POST' });
    setChecking(false);
    onRefresh();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${tracker.title}"?`)) return;
    setDeleting(true);
    await fetch(`/api/trackers/${tracker.id}`, { method: 'DELETE' });
    setDeleting(false);
    onClose();
    onRefresh();
  }

  async function handleToggle() {
    await fetch(`/api/trackers/${tracker.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !tracker.isActive }),
    });
    onRefresh();
  }

  const config = (() => { try { return JSON.parse(tracker.monitorConfig); } catch { return {}; } })();

  return (
    <>
      <div className="slideover-overlay" onClick={onClose} />
      <div className="slideover-panel">
        <div style={{ padding: 32 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ flex: 1, marginRight: 16 }}>
              {tracker.category && (
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  {tracker.category}
                </div>
              )}
              <div style={{ width: 28, height: 4, borderRadius: 2, background: accent, marginBottom: 12 }} />
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', margin: 0, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{tracker.title}</h2>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 999, border: 'none', background: '#F0EDEA', color: '#6B6B7B', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#E8E4DF'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#F0EDEA'; }}>
              ×
            </button>
          </div>

          {/* Status card */}
          <div style={{ background: '#F8F6F4', borderRadius: 14, padding: '16px 18px', marginBottom: 20, border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Current Status</div>
            <StatusBadge status={tracker.currentStatus} />
            {tracker.lastChecked && (
              <div style={{ fontSize: 11, color: '#9B9BAB', marginTop: 8 }}>
                Checked {relativeTime(tracker.lastChecked)}
                {tracker.lastChanged && ` · Changed ${relativeTime(tracker.lastChanged)}`}
              </div>
            )}
          </div>

          {/* Meta grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Type', value: tracker.monitorType },
              { label: 'Frequency', value: tracker.checkFrequency },
              { label: 'State', value: tracker.isActive ? 'Active' : 'Paused' },
              { label: 'Notify', value: tracker.notifyOnChange ? 'On change' : 'Off' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#F8F6F4', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Description / config */}
          {(tracker.description || config.url || config.query) && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Monitoring</div>
              {tracker.description && <p style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.6, margin: 0, marginBottom: config.url || config.query ? 6 : 0 }}>{tracker.description}</p>}
              {config.url && <div style={{ fontSize: 12, fontFamily: 'var(--font-jetbrains-mono)', color: '#7EB8D6', wordBreak: 'break-all' }}>{config.url}</div>}
              {config.query && <div style={{ fontSize: 12, color: '#6B6B7B' }}>Query: <em>{config.query}</em></div>}
            </div>
          )}

          {/* History */}
          {tracker.history.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>History</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tracker.history.map((h) => (
                  <div key={h.id} style={{ background: '#F8F6F4', borderRadius: 10, padding: '10px 14px', border: '1px solid rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: h.details ? 4 : 0 }}>
                      <StatusBadge status={h.status} />
                      <span style={{ fontSize: 10, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>{relativeTime(h.checkedAt)}</span>
                    </div>
                    {h.details && <p style={{ fontSize: 12, color: '#6B6B7B', margin: '4px 0 0', lineHeight: 1.5 }}>{h.details}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action footer */}
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '16px 32px', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(212,100,92,0.2)', background: 'transparent', color: '#D4645C', cursor: deleting ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500, transition: 'all 150ms ease' }}
            onMouseEnter={(e) => { if (!deleting) (e.currentTarget as HTMLElement).style.background = 'rgba(212,100,92,0.06)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleToggle}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', background: '#F8F6F4', color: '#6B6B7B', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500, transition: 'all 150ms ease' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F0EDEA'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#F8F6F4'; }}
            >
              {tracker.isActive ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={handleCheck}
              disabled={checking}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: checking ? '#E8E4DF' : '#1A1A1A', color: checking ? '#9B9BAB' : '#fff', cursor: checking ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600, transition: 'all 150ms ease' }}
            >
              {checking ? 'Checking…' : 'Check Now'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main TrackerView ──────────────────────────────────────────────────────────

export default function TrackerView() {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Tracker | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');

  const load = useCallback(async () => {
    const res = await fetch('/api/trackers');
    const data = await res.json();
    setTrackers(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function refreshSelected() {
    await load();
    if (selected) {
      const res = await fetch(`/api/trackers/${selected.id}`);
      const data = await res.json();
      setSelected(data);
    }
  }

  const active = trackers.filter((t) => t.isActive);
  const paused = trackers.filter((t) => !t.isActive);

  const visible = filter === 'active' ? active : filter === 'paused' ? paused : trackers;

  const groups =
    filter === 'all'
      ? [
          ...(active.length > 0 ? [{ label: 'Active', count: active.length, items: active, accent: '#5BB98C' }] : []),
          ...(paused.length > 0 ? [{ label: 'Paused', count: paused.length, items: paused, accent: '#C0C0CC' }] : []),
        ]
      : [{ label: filter.charAt(0).toUpperCase() + filter.slice(1), count: visible.length, items: visible, accent: filter === 'active' ? '#5BB98C' : '#C0C0CC' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F8F6F4' }}>

      {/* Header */}
      <div style={{ padding: '24px 32px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 600, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em' }}>Tracker</h1>
            {!loading && (
              <p style={{ fontSize: 13, color: '#9B9BAB', margin: '2px 0 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
                {active.length} active · {paused.length} paused
              </p>
            )}
          </div>
          <button
            onClick={() => setShowNew(true)}
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              border: 'none',
              background: '#1A1A1A',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 200ms ease',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2A2A2A'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#1A1A1A'; }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            New Tracker
          </button>
        </div>

        {/* Pill tabs */}
        {trackers.length > 0 && (
          <div className="pill-tabs" style={{ marginBottom: 24 }}>
            {(['all', 'active', 'paused'] as const).map((tab) => (
              <button
                key={tab}
                className={`pill-tab${filter === tab ? ' active' : ''}`}
                onClick={() => setFilter(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px' }}>
        {loading ? (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 120, borderRadius: 16 }} />
            ))}
          </div>
        ) : trackers.length === 0 ? (
          <div style={{ padding: '80px 24px', textAlign: 'center' }} className="fade-up">
            <div style={{ fontSize: 48, marginBottom: 16 }}>📌</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1A1A1A', marginBottom: 8, letterSpacing: '-0.01em' }}>Nothing being tracked yet</div>
            <p style={{ fontSize: 14, color: '#9B9BAB', maxWidth: 360, margin: '0 auto 28px', lineHeight: 1.6 }}>
              Watch application statuses, job postings, news, URLs, and more — all automatically.
            </p>
            <button
              onClick={() => setShowNew(true)}
              style={{ padding: '10px 24px', borderRadius: 999, border: 'none', background: '#1A1A1A', color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
            >
              Add your first tracker
            </button>
          </div>
        ) : groups.map((group) => (
          <div key={group.label} style={{ marginBottom: 32 }}>
            {/* Group header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: group.accent, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6B6B7B', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-jetbrains-mono)' }}>
                {group.label}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#9B9BAB', background: '#F0EDEA', borderRadius: 999, padding: '2px 8px' }}>
                {group.count}
              </span>
            </div>

            {group.items.length === 0 && (
              <p style={{ color: '#9B9BAB', fontSize: 13, padding: '12px 0' }}>None</p>
            )}

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }} className="card-stagger">
              {group.items.map((tracker) => (
                <TrackerCard
                  key={tracker.id}
                  tracker={tracker}
                  onClick={() => setSelected(tracker)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* New tracker modal */}
      {showNew && <NewTrackerModal onClose={() => setShowNew(false)} onCreate={load} />}

      {/* Detail slide-over */}
      {selected && (
        <DetailSlideover
          tracker={selected}
          onClose={() => setSelected(null)}
          onRefresh={refreshSelected}
        />
      )}
    </div>
  );
}
