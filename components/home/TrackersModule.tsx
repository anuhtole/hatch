'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLiveData } from '@/lib/swr-config';
import CollapsibleModule from './CollapsibleModule';
import { useModalPosition } from '@/lib/useModalPosition';

// ── Types ─────────────────────────────────────────────────────────────────────

type TrackerHistory = {
  id: string;
  status: string;
  details: string | null;
  checkedAt: string;
};

type StepDef = { id: string; title: string; description?: string };

type Tracker = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  monitorType: string;
  monitorConfig: string;
  currentStatus: string | null;
  previousStatus: string | null;
  lastChecked: string | null;
  lastChanged: string | null;
  checkFrequency: string;
  notifyOnChange: boolean;
  isActive: boolean;
  notes: string | null;
  color: string;
  trackerType: string;
  stepsConfig: string | null;
  currentStepId: string | null;
  summaryLine: string | null;
  tailoredMessage: string | null;
  lastCheckError: string | null;
  consecutiveFails: number;
  history: TrackerHistory[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, { bg: string; dot: string; border: string }> = {
  yellow: { bg: 'rgba(232,184,122,0.10)', dot: '#E8B87A', border: 'rgba(232,184,122,0.25)' },
  red:    { bg: 'rgba(216,136,120,0.10)', dot: '#D88878', border: 'rgba(216,136,120,0.25)' },
  green:  { bg: 'rgba(143,200,154,0.10)', dot: '#8FC89A', border: 'rgba(143,200,154,0.25)' },
  blue:   { bg: 'rgba(126,184,214,0.10)', dot: '#7EB8D6', border: 'rgba(126,184,214,0.25)' },
  purple: { bg: 'rgba(155,142,196,0.10)', dot: '#9B8EC4', border: 'rgba(155,142,196,0.25)' },
};

const COLORS = ['yellow', 'green', 'blue', 'red', 'purple'];
const MONITOR_TYPES = ['url', 'search', 'status', 'custom'];
const FREQUENCIES = ['hourly', 'daily', 'weekly'];

function statusColor(status: string | null): string {
  if (!status) return '#766D62';
  const s = status.toLowerCase();
  if (s.includes('ok') || s.includes('up') || s.includes('pass') || s.includes('good')) return '#8FC89A';
  if (s.includes('warn') || s.includes('change') || s.includes('pending')) return '#E8B87A';
  if (s.includes('fail') || s.includes('down') || s.includes('err')) return '#D88878';
  return '#766D62';
}

function changedRecently(lastChanged: string | null): boolean {
  if (!lastChanged) return false;
  return Date.now() - new Date(lastChanged).getTime() < 24 * 60 * 60 * 1000;
}

function timeAgo(ts: string | null): string {
  if (!ts) return 'never';
  const ms = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

function isPositiveBinaryState(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes('open') || s.includes('active') || s.includes('live') || s.includes('pass')
    || s.includes('ok') || s.includes('up') || s.includes('good') || s.includes('success')
    || s.includes('available') || s.includes('posted') || s.includes('published');
}

function generateSummaryLine(tracker: Tracker): string {
  const parts: string[] = [];
  const freqLabel = tracker.checkFrequency === 'hourly' ? 'hourly'
    : tracker.checkFrequency === 'weekly' ? 'weekly' : 'daily';
  parts.push(`Monitoring ${freqLabel}`);
  if (tracker.lastChecked) parts.push(`checked ${timeAgo(tracker.lastChecked)}`);
  if (tracker.trackerType === 'multi_step' && tracker.stepsConfig) {
    try {
      const steps: StepDef[] = JSON.parse(tracker.stepsConfig);
      const idx = tracker.currentStepId ? steps.findIndex((s) => s.id === tracker.currentStepId) : -1;
      if (steps.length > 0) parts.push(`step ${idx >= 0 ? idx + 1 : '?'} of ${steps.length}`);
    } catch {}
  } else if (tracker.lastChanged) {
    parts.push(`changed ${timeAgo(tracker.lastChanged)}`);
  }
  return parts.join(' · ');
}

// ── TrackerModal ──────────────────────────────────────────────────────────────

function TrackerModal({
  trackers,
  initialId,
  initialAddMode,
  onClose,
  onRefresh,
}: {
  trackers: Tracker[];
  initialId: string | null;
  initialAddMode?: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { overlayStyle } = useModalPosition();
  const [mounted, setMounted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? trackers[0]?.id ?? null);
  const [checking, setChecking] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Body scroll lock + hide underlying chat hero
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => { document.body.classList.remove('modal-open'); };
  }, []);
  const [editMode, setEditMode] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [addMode, setAddMode] = useState(initialAddMode ?? false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [updatedId, setUpdatedId] = useState<string | null>(null);

  // Edit form state
  const selected = trackers.find((t) => t.id === selectedId) ?? null;
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editColor, setEditColor] = useState('yellow');
  const [editFrequency, setEditFrequency] = useState('daily');
  const [editNotes, setEditNotes] = useState('');

  // New tracker form state (simplified — title + description only)
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<string>('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (selected) {
      setEditTitle(selected.title);
      setEditDesc(selected.description ?? '');
      setEditCategory(selected.category ?? '');
      setEditColor(selected.color);
      setEditFrequency(selected.checkFrequency);
      setEditNotes(selected.notes ?? '');
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkNow() {
    if (!selectedId) return;
    setChecking(true);
    try {
      await fetch(`/api/trackers/${selectedId}/check`, { method: 'POST' });
      onRefresh();
    } catch {}
    setChecking(false);
  }

  async function saveEdit() {
    if (!selectedId) return;
    setReanalyzing(true);
    try {
      const res = await fetch(`/api/trackers/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          description: editDesc || null,
          category: editCategory || null,
          color: editColor,
          checkFrequency: editFrequency,
          notes: editNotes || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.reanalyzed) {
        setUpdatedId(selectedId);
        setTimeout(() => setUpdatedId(null), 3000);
      }
    } finally {
      setReanalyzing(false);
      setEditMode(false);
      onRefresh();
    }
  }

  async function togglePause() {
    if (!selected) return;
    await fetch(`/api/trackers/${selectedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !selected.isActive }),
    });
    onRefresh();
  }

  async function deleteTracker() {
    if (!selectedId) return;
    await fetch(`/api/trackers/${selectedId}`, { method: 'DELETE' });
    onRefresh();
    const remaining = trackers.filter((t) => t.id !== selectedId);
    setSelectedId(remaining[0]?.id ?? null);
    setDeleteConfirm(false);
  }

  async function addTracker() {
    if (!newTitle.trim() || !newDesc.trim()) return;
    setAdding(true);
    setAddStatus('Analyzing…');
    try {
      const res = await fetch('/api/trackers/smart-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), description: newDesc.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAddStatus('Running first check…');
      // Give the background check a moment
      await new Promise((r) => setTimeout(r, 1500));
      setAddMode(false);
      setNewTitle('');
      setNewDesc('');
      setAddStatus('');
      onRefresh();
    } catch {
      setAddStatus('Failed — try again');
    }
    setAdding(false);
  }

  const palette = selected ? (COLOR_MAP[selected.color] ?? COLOR_MAP.yellow) : COLOR_MAP.yellow;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid rgba(255,235,210,0.12)',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'inherit',
    color: '#FBF5EC',
    background: '#17141C',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: '#766D62',
    fontFamily: 'var(--font-jetbrains-mono)',
    letterSpacing: '0.04em',
    marginBottom: 3,
    display: 'block',
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      style={{ ...overlayStyle, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10, 8, 14, 0.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      onClick={onClose}
    >
      <div
        className="modal-panel"
        style={{ background: '#1C1822', borderRadius: 16, width: 720, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar: tracker list */}
        <div style={{ width: 200, borderRight: '1px solid rgba(255,235,210,0.07)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '16px 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em' }}>TRACKERS</span>
            <button
              onClick={() => { setAddMode(true); setSelectedId(null); setEditMode(false); }}
              style={{ background: 'rgba(255,235,210,0.08)', border: 'none', borderRadius: 5, width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A89E91', fontSize: 14, fontWeight: 600 }}
            >+</button>
          </div>
          <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
            {trackers.map((t) => {
              const p = COLOR_MAP[t.color] ?? COLOR_MAP.yellow;
              const sc = statusColor(t.currentStatus);
              const isNew = changedRecently(t.lastChanged) && t.previousStatus !== t.currentStatus;
              return (
                <div
                  key={t.id}
                  onClick={() => { setSelectedId(t.id); setEditMode(false); setDeleteConfirm(false); setAddMode(false); }}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    background: selectedId === t.id ? p.bg : 'transparent',
                    border: selectedId === t.id ? `1px solid ${p.border}` : '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    marginBottom: 2,
                    opacity: t.isActive ? 1 : 0.5,
                    transition: 'background 150ms ease',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: '#FBF5EC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {t.title}
                  </span>
                  {(isNew || updatedId === t.id) && (
                    <span style={{ fontSize: 8, fontWeight: 700, color: '#17141C', background: '#E8B87A', borderRadius: 3, padding: '1px 4px', fontFamily: 'var(--font-jetbrains-mono)', flexShrink: 0 }}>NEW</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
          {/* Reanalyzing overlay */}
          {reanalyzing && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10,
              background: 'rgba(28,24,34,0.88)',
              backdropFilter: 'blur(3px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '0 16px 16px 0',
            }}>
              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7EB8D6" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#EADFD0' }}>Reanalyzing…</div>
                <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>Updating monitor config + running fresh check</div>
              </div>
            </div>
          )}

          {/* Header */}
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,235,210,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#FBF5EC', fontFamily: 'var(--font-display)' }}>
              {addMode ? 'Add Tracker' : (selected?.title ?? 'No tracker selected')}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#766D62', display: 'flex', alignItems: 'center', padding: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 20 }}>
            {addMode ? (
              /* Add new tracker form — simplified */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#A89E91', lineHeight: 1.5, marginBottom: 14 }}>
                    Describe what you want to monitor and AI will figure out the rest — monitor type, frequency, and how to check it.
                  </div>
                  <label style={labelStyle}>TITLE *</label>
                  <input
                    style={inputStyle}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Anthropic job posting"
                    autoFocus
                  />
                </div>
                <div>
                  <label style={labelStyle}>WHAT TO WATCH FOR *</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 140, resize: 'vertical', lineHeight: 1.6 }}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="e.g. Check if the Anthropic research engineer role at anthropic.com/careers is still open and if any requirements have changed"
                  />
                </div>
                {addStatus && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: addStatus.includes('Failed') ? '#D88878' : '#7EB8D6', fontFamily: 'var(--font-jetbrains-mono)' }}>
                    {!addStatus.includes('Failed') && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    )}
                    {addStatus}
                  </div>
                )}
              </div>
            ) : editMode && selected ? (
              /* Edit form */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>TITLE</label>
                  <input style={inputStyle} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>WHAT SHOULD I WATCH FOR?</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 140, maxHeight: 320, resize: 'vertical', lineHeight: 1.6, fontSize: 13, padding: 12 }}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                  />
                  <div style={{ fontSize: 10, color: '#766D62', marginTop: 4 }}>Be specific — include URLs, what changes matter, what "good" vs "bad" looks like.</div>
                </div>
                <div>
                  <label style={labelStyle}>CATEGORY</label>
                  <input style={inputStyle} value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>FREQUENCY</label>
                    <select style={{ ...inputStyle }} value={editFrequency} onChange={(e) => setEditFrequency(e.target.value)}>
                      {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>COLOR</label>
                    <div style={{ display: 'flex', gap: 6, paddingTop: 6 }}>
                      {COLORS.map((c) => (
                        <button key={c} onClick={() => setEditColor(c)} style={{ width: 20, height: 20, borderRadius: '50%', background: (COLOR_MAP[c] ?? COLOR_MAP.yellow).dot, border: editColor === c ? '2px solid #FBF5EC' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>NOTES</label>
                  <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
                </div>
              </div>
            ) : selected ? (
              /* Tracker detail view */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* STATUS HERO */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0 8px', gap: 10 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 10,
                    background: palette.bg, border: `1px solid ${palette.border}`,
                    borderRadius: 40, padding: '10px 22px',
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor(selected.currentStatus), flexShrink: 0 }} />
                    <span style={{ fontSize: 17, fontWeight: 700, color: '#FBF5EC', fontFamily: 'var(--font-display)' }}>
                      {selected.currentStatus ?? 'Not yet checked'}
                    </span>
                    {selected.lastCheckError && (
                      <span
                        title={`Last check failed: ${selected.lastCheckError}`}
                        style={{ fontSize: 15, color: '#E8B87A', cursor: 'help', marginLeft: 2, lineHeight: 1 }}
                      >⚠</span>
                    )}
                  </div>
                  {selected.lastCheckError && (
                    <div style={{ fontSize: 10, color: '#E8B87A', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.02em' }}>
                      Last check failed · showing last-known-good status
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>
                    {selected.lastChecked && (
                      <span>Checked {new Date(selected.lastChecked).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                    {selected.lastChanged && (
                      <span>· Changed {new Date(selected.lastChanged).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </div>
                </div>

                {/* ACTION BUTTONS */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={checkNow}
                    disabled={checking}
                    style={{
                      flex: 1, height: 40,
                      background: checking ? 'rgba(255,235,210,0.06)' : '#7EB8D6',
                      color: checking ? '#766D62' : '#17141C',
                      border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600,
                      cursor: checking ? 'default' : 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      transition: 'all 150ms ease',
                    }}
                  >
                    {checking ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        Checking…
                      </>
                    ) : (
                      <>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
                        </svg>
                        Check now
                      </>
                    )}
                  </button>
                  {(() => {
                    try {
                      const cfg = JSON.parse(selected.monitorConfig) as { url?: string };
                      if (cfg.url) return (
                        <a
                          href={cfg.url} target="_blank" rel="noopener noreferrer"
                          style={{
                            height: 40, padding: '0 18px',
                            background: 'rgba(255,235,210,0.08)', color: '#EADFD0',
                            border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 500,
                            cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none',
                            display: 'flex', alignItems: 'center', gap: 7,
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15,3 21,3 21,9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                          Take me there
                        </a>
                      );
                    } catch {}
                    return null;
                  })()}
                </div>

                {/* SUMMARY LINE — AI-generated if available, mechanical fallback */}
                {(selected.summaryLine || selected.description) && (
                  <div style={{ fontSize: 13, color: '#A89E91', lineHeight: 1.6 }}>
                    {selected.summaryLine
                      ? selected.summaryLine.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                          part.startsWith('**') && part.endsWith('**')
                            ? <strong key={i} style={{ color: '#EADFD0', fontWeight: 600 }}>{part.slice(2, -2)}</strong>
                            : <span key={i}>{part}</span>
                        )
                      : selected.description}
                  </div>
                )}

                {/* BINARY STATUS CARD */}
                {selected.trackerType !== 'multi_step' && (
                  <div style={{
                    background: 'rgba(255,235,210,0.04)',
                    border: '1px solid rgba(255,235,210,0.08)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}>
                    {selected.tailoredMessage ? (
                      <div style={{ fontSize: 13, color: '#EADFD0', lineHeight: 1.6 }}>{selected.tailoredMessage}</div>
                    ) : null}
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', flexWrap: 'wrap' }}>
                      <span>Checking {selected.checkFrequency}</span>
                      {selected.lastChecked && (
                        <span>· verified {timeAgo(selected.lastChecked)}
                          {isPositiveBinaryState(selected.currentStatus)
                            ? <span style={{ color: '#8FC89A', marginLeft: 6 }}>✓</span>
                            : selected.currentStatus
                              ? <span style={{ color: '#E8B87A', marginLeft: 6 }}>!</span>
                              : null}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* MULTI-STEP TIMELINE — same visual language as History section below */}
                {selected.trackerType === 'multi_step' && selected.stepsConfig && (() => {
                  let steps: StepDef[] = [];
                  try { steps = JSON.parse(selected.stepsConfig); } catch { return null; }
                  const currentIdx = selected.currentStepId ? steps.findIndex((s) => s.id === selected.currentStepId) : -1;
                  return (
                    <div>
                      <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', marginBottom: 12 }}>PROGRESS</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
                        {/* Vertical connector line — same as History */}
                        <div style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 1, background: 'rgba(255,235,210,0.07)' }} />
                        {steps.map((step, i) => {
                          const isCompleted = currentIdx >= 0 && i < currentIdx;
                          const isCurrent = i === currentIdx;
                          const isUpcoming = currentIdx < 0 ? i > 0 : i > currentIdx;
                          // Dot colors match History dot logic
                          const dotBg = isCompleted ? '#8FC89A' : isCurrent ? palette.dot : 'transparent';
                          const dotBorder = isCurrent
                            ? `2px solid ${palette.dot}`
                            : isUpcoming
                              ? '2px solid rgba(255,235,210,0.2)'
                              : '2px solid #8FC89A';
                          const dotShadow = isCurrent ? `0 0 0 3px ${palette.dot}33` : 'none';
                          const stateLabel = isCompleted ? 'completed' : isCurrent ? 'in progress' : 'upcoming';
                          const stateLabelColor = isCompleted ? '#8FC89A' : isCurrent ? palette.dot : '#4A4540';
                          return (
                            <div key={step.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
                              {/* Dot — same size as History dots */}
                              <span style={{
                                width: 15, height: 15, borderRadius: '50%',
                                background: dotBg,
                                flexShrink: 0,
                                border: dotBorder,
                                boxShadow: dotShadow,
                                zIndex: 1,
                                marginTop: 2,
                                display: 'inline-block',
                              }} />
                              {/* Content */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: isCurrent ? 600 : isCompleted ? 500 : 400, color: isCurrent ? '#FBF5EC' : isCompleted ? '#C8C0B4' : '#766D62', marginBottom: 2 }}>
                                  {step.title}
                                </div>
                                {step.description && (
                                  <div style={{ fontSize: 11, color: isUpcoming ? '#4A4540' : '#A89E91', lineHeight: 1.5, marginBottom: 4 }}>
                                    {step.description}
                                  </div>
                                )}
                                <div style={{ fontSize: 10, color: stateLabelColor, fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                  {stateLabel}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* HISTORY */}
                {(() => {
                  const visibleHistory = selected.history.filter((h) => h.status !== 'check_failed');
                  if (visibleHistory.length === 0) return null;
                  return (
                  <div>
                    <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', marginBottom: 10 }}>HISTORY</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 1, background: 'rgba(255,235,210,0.07)' }} />
                      {visibleHistory.map((h, i) => {
                        // Color logic: compare to next entry (older). green=no change, amber=changed, red=flipped bad
                        const older = visibleHistory[i + 1] ?? null;
                        let dotColor = statusColor(h.status);
                        if (older) {
                          if (h.status === older.status) {
                            dotColor = '#8FC89A';
                          } else {
                            const wasGood = statusColor(older.status) === '#8FC89A';
                            const nowGood = statusColor(h.status) === '#8FC89A';
                            dotColor = wasGood && !nowGood ? '#D88878' : '#E8B87A';
                          }
                        }
                        return (
                          <div key={h.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingBottom: i < visibleHistory.length - 1 ? 12 : 0 }}>
                            <span style={{ width: 15, height: 15, borderRadius: '50%', background: dotColor, flexShrink: 0, border: '2px solid #1C1822', boxShadow: '0 0 0 1px rgba(255,235,210,0.07)', zIndex: 1 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, color: '#FBF5EC', fontWeight: 500, marginBottom: 2 }}>{h.status}</div>
                              {h.details && <div style={{ fontSize: 11, color: '#A89E91', lineHeight: 1.5, wordBreak: 'break-word' }}>{h.details}</div>}
                              <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginTop: 2 }}>
                                {new Date(h.checkedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  );
                })()}

                {/* SETTINGS */}
                <div style={{ background: 'rgba(255,235,210,0.04)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', marginBottom: 10 }}>SETTINGS</div>
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 3 }}>FREQUENCY</div>
                      <div style={{ fontSize: 13, color: '#EADFD0', textTransform: 'capitalize' }}>{selected.checkFrequency}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 3 }}>NOTIFICATIONS</div>
                      <div style={{ fontSize: 13, color: selected.notifyOnChange ? '#8FC89A' : '#766D62' }}>{selected.notifyOnChange ? 'On' : 'Off'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 3 }}>STATUS</div>
                      <div style={{ fontSize: 13, color: selected.isActive ? '#8FC89A' : '#766D62' }}>{selected.isActive ? 'Active' : 'Paused'}</div>
                    </div>
                  </div>
                </div>

                {/* NOTES */}
                {selected.notes && (
                  <div>
                    <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', marginBottom: 6 }}>NOTES</div>
                    <div style={{ fontSize: 13, color: '#A89E91', lineHeight: 1.6 }}>{selected.notes}</div>
                  </div>
                )}

              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#766D62', textAlign: 'center', padding: '40px 0' }}>Select a tracker</div>
            )}
          </div>

          {/* Sticky footer */}
          {(addMode || editMode || selected) && (
            <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,235,210,0.07)', padding: '14px 20px', background: '#1C1822', display: 'flex', gap: 8 }}>
              {addMode ? (
                <>
                  <button
                    onClick={addTracker}
                    disabled={adding || !newTitle.trim() || !newDesc.trim()}
                    style={{ flex: 1, height: 36, background: '#7EB8D6', color: '#17141C', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: adding || !newTitle.trim() || !newDesc.trim() ? 'default' : 'pointer', fontFamily: 'inherit', opacity: adding || !newTitle.trim() || !newDesc.trim() ? 0.5 : 1, transition: 'opacity 150ms ease' }}
                  >
                    {adding ? 'Creating…' : 'Create Tracker'}
                  </button>
                  <button
                    onClick={() => { setAddMode(false); setNewTitle(''); setNewDesc(''); setAddStatus(''); setSelectedId(trackers[0]?.id ?? null); }}
                    disabled={adding}
                    style={{ height: 36, padding: '0 16px', background: 'rgba(255,235,210,0.08)', color: '#A89E91', border: 'none', borderRadius: 8, fontSize: 13, cursor: adding ? 'default' : 'pointer', fontFamily: 'inherit', opacity: adding ? 0.5 : 1 }}
                  >
                    Cancel
                  </button>
                </>
              ) : editMode && selected ? (
                <>
                  <button onClick={saveEdit} style={{ flex: 1, height: 36, background: '#7EB8D6', color: '#17141C', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Save
                  </button>
                  <button onClick={() => setEditMode(false)} style={{ height: 36, padding: '0 16px', background: 'rgba(255,235,210,0.08)', color: '#A89E91', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                </>
              ) : selected ? (
                <>
                  <button
                    onClick={() => setEditMode(true)}
                    style={{ height: 32, padding: '0 14px', background: 'rgba(255,235,210,0.08)', color: '#FBF5EC', border: 'none', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                  >Edit</button>
                  <button
                    onClick={togglePause}
                    style={{ height: 32, padding: '0 14px', background: 'rgba(255,235,210,0.08)', color: selected.isActive ? '#E8B87A' : '#8FC89A', border: 'none', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                  >{selected.isActive ? 'Pause' : 'Resume'}</button>
                  {deleteConfirm ? (
                    <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                      <button onClick={deleteTracker} style={{ height: 32, padding: '0 12px', background: '#D88878', color: '#17141C', border: 'none', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Confirm</button>
                      <button onClick={() => setDeleteConfirm(false)} style={{ height: 32, padding: '0 12px', background: 'rgba(255,235,210,0.08)', color: '#A89E91', border: 'none', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(true)}
                      style={{ height: 32, padding: '0 14px', background: 'rgba(216,136,120,0.12)', color: '#D88878', border: 'none', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' }}
                    >Delete</button>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── TrackersModule ────────────────────────────────────────────────────────────

export default function TrackersModule({ onModalOpenChange }: { onModalOpenChange?: (open: boolean) => void }) {
  const { data: rawTrackers, isLoading: loading, mutate: mutateTrackers } = useLiveData<Tracker[]>('/api/trackers');
  const trackers = Array.isArray(rawTrackers) ? rawTrackers : [];
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialId, setModalInitialId] = useState<string | null>(null);
  const [modalInitialAddMode, setModalInitialAddMode] = useState(false);

  useEffect(() => { onModalOpenChange?.(modalOpen); }, [modalOpen, onModalOpenChange]);

  function openModal(id?: string, addMode?: boolean) {
    setModalInitialId(id ?? null);
    setModalInitialAddMode(addMode ?? false);
    setModalOpen(true);
  }

  const active = trackers.filter((t) => t.isActive);

  const addButton = (
    <button
      onClick={(e) => { e.stopPropagation(); openModal(undefined, true); }}
      style={{
        width: 20, height: 20, borderRadius: 5,
        background: 'rgba(255,235,210,0.08)',
        border: 'none',
        color: '#A89E91',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
      }}
      title="Add tracker"
    >+</button>
  );

  return (
    <>
      <CollapsibleModule title="Trackers" index="04" action={addButton} onExpand={() => openModal()}>
        <div style={{ padding: '0 12px 10px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 24, borderRadius: 6 }} />)}
            </div>
          ) : active.length === 0 ? (
            <div style={{ fontSize: 12, color: '#766D62', textAlign: 'center', padding: '8px 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
              No active trackers
            </div>
          ) : (
            <div className="thin-scroll" style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {active.map((t) => {
                const sc = statusColor(t.currentStatus);
                const isNew = changedRecently(t.lastChanged) && t.previousStatus !== t.currentStatus;
                return (
                  <button
                    key={t.id}
                    onClick={() => openModal(t.id)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      border: 'none',
                      borderRadius: 6,
                      background: 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'left',
                      transition: 'background 150ms ease',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,235,210,0.05)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12, color: '#EADFD0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {t.title}
                    </span>
                    {isNew && (
                      <span style={{ fontSize: 8, fontWeight: 700, color: '#17141C', background: '#E8B87A', borderRadius: 3, padding: '1px 4px', fontFamily: 'var(--font-jetbrains-mono)', flexShrink: 0 }}>NEW</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </CollapsibleModule>

      {modalOpen && (
        <TrackerModal
          trackers={trackers}
          initialId={modalInitialId}
          initialAddMode={modalInitialAddMode}
          onClose={() => setModalOpen(false)}
          onRefresh={() => mutateTrackers()}
        />
      )}
    </>
  );
}
