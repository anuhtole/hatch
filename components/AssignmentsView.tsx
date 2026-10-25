'use client';

import { useState, useEffect } from 'react';
import CanvasTokenBanner from './CanvasTokenBanner';

type Assignment = {
  id: number;
  courseName: string;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  submission: { workflow_state: string } | null;
};

function urgencyInfo(dueAt: string | null) {
  if (!dueAt) return { label: 'No due date', color: '#9B9BAB', bg: '#F0EDEA', badgeClass: 'badge-gray' };
  const diff = new Date(dueAt).getTime() - Date.now();
  const hours = diff / (1000 * 60 * 60);
  if (diff < 0) return { label: 'Overdue', color: '#C0392B', bg: '#FDE8E8', badgeClass: 'badge-red' };
  if (hours < 24) return { label: `Due in ${Math.floor(hours)}h`, color: '#C0392B', bg: '#FDE8E8', badgeClass: 'badge-red' };
  if (hours < 72) return { label: `Due in ${Math.floor(hours / 24)}d`, color: '#B8860B', bg: '#FFF2CC', badgeClass: 'badge-low' };
  return { label: `Due in ${Math.floor(hours / 24)}d`, color: '#1E8449', bg: '#D4F4E1', badgeClass: 'badge-high' };
}

function statusInfo(submission: { workflow_state: string } | null) {
  if (!submission) return { label: 'Not submitted', badgeClass: 'badge-gray' };
  const s = submission.workflow_state;
  if (s === 'submitted' || s === 'graded') return { label: 'Submitted', badgeClass: 'badge-high' };
  return { label: 'Not submitted', badgeClass: 'badge-gray' };
}

function formatDueDate(dueAt: string | null) {
  if (!dueAt) return null;
  return new Date(dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function SkeletonCard() {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.04)' }}>
      <div className="skeleton" style={{ width: '40%', height: 10, borderRadius: 6, marginBottom: 12 }} />
      <div className="skeleton" style={{ width: '90%', height: 14, borderRadius: 6, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: '70%', height: 14, borderRadius: 6, marginBottom: 16 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="skeleton" style={{ width: 80, height: 22, borderRadius: 999 }} />
        <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 999 }} />
      </div>
    </div>
  );
}

export default function AssignmentsView() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'upcoming' | 'submitted' | 'overdue'>('upcoming');

  useEffect(() => {
    fetch('/api/canvas/assignments')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAssignments(data.assignments);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const upcoming = assignments.filter(a => {
    const submitted = a.submission?.workflow_state === 'submitted' || a.submission?.workflow_state === 'graded';
    if (submitted) return false;
    if (!a.due_at) return true;
    return new Date(a.due_at).getTime() > Date.now();
  });

  const submitted = assignments.filter(a =>
    a.submission?.workflow_state === 'submitted' || a.submission?.workflow_state === 'graded'
  );

  const overdue = assignments.filter(a => {
    const sub = a.submission?.workflow_state === 'submitted' || a.submission?.workflow_state === 'graded';
    if (sub) return false;
    return a.due_at && new Date(a.due_at).getTime() < Date.now();
  });

  const filtered = filter === 'upcoming' ? upcoming : filter === 'submitted' ? submitted : overdue;

  // Group upcoming by urgency
  const urgent = upcoming.filter(a => {
    if (!a.due_at) return false;
    const h = (new Date(a.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
    return h < 72;
  });
  const later = upcoming.filter(a => {
    if (!a.due_at) return true;
    const h = (new Date(a.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
    return h >= 72;
  });

  const columns = filter === 'upcoming'
    ? [
        ...(urgent.length > 0 ? [{ label: 'Due Soon', count: urgent.length, items: urgent, accent: '#D4645C' }] : []),
        { label: 'Due Later', count: later.length, items: later, accent: '#5BB98C' },
      ]
    : [{ label: filter === 'submitted' ? 'Submitted' : 'Overdue', count: filtered.length, items: filtered, accent: filter === 'submitted' ? '#5BB98C' : '#D4645C' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F8F6F4' }}>

      {/* Header */}
      <div style={{ padding: '24px 32px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 600, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em' }}>Assignments</h1>
            {!loading && !error && (
              <p style={{ fontSize: 13, color: '#9B9BAB', margin: '2px 0 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
                {upcoming.length} upcoming · {overdue.length} overdue
              </p>
            )}
          </div>
        </div>

        {/* Pill tabs */}
        <div className="pill-tabs" style={{ marginBottom: 24 }}>
          {(['upcoming', 'submitted', 'overdue'] as const).map((tab) => (
            <button
              key={tab}
              className={`pill-tab${filter === tab ? ' active' : ''}`}
              onClick={() => setFilter(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'overdue' && overdue.length > 0 && (
                <span style={{ marginLeft: 6, background: filter === tab ? 'rgba(255,255,255,0.25)' : '#FDE8E8', color: filter === tab ? '#fff' : '#C0392B', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                  {overdue.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <CanvasTokenBanner />

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px' }}>
        {loading && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }} className="card-stagger">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {error && (
          <div style={{ padding: '16px 20px', borderRadius: 12, background: '#FDE8E8', color: '#C0392B', fontSize: 13 }}>
            Could not load assignments: {error}
          </div>
        )}

        {!loading && !error && assignments.length === 0 && (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🎒</div>
            <p style={{ color: '#9B9BAB', fontSize: 14, margin: 0 }}>No active courses on bCourses</p>
          </div>
        )}

        {!loading && !error && columns.map((col) => (
          <div key={col.label} style={{ marginBottom: 32 }}>
            {/* Column header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: col.accent, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6B6B7B', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-jetbrains-mono)' }}>
                {col.label}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#9B9BAB', background: '#F0EDEA', borderRadius: 999, padding: '2px 8px' }}>
                {col.count}
              </span>
            </div>

            {col.items.length === 0 && (
              <p style={{ color: '#9B9BAB', fontSize: 13, padding: '12px 0' }}>None</p>
            )}

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }} className="card-stagger">
              {col.items.map((a) => {
                const { label: dueLabel, color: dueColor, bg: dueBg } = urgencyInfo(a.due_at);
                const { label: subLabel, badgeClass: subClass } = statusInfo(a.submission);
                const isHovered = hoveredId === a.id;

                return (
                  <div
                    key={a.id}
                    className="fade-up"
                    onClick={() => setSelected(a)}
                    onMouseEnter={() => setHoveredId(a.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      background: '#fff',
                      borderRadius: 16,
                      padding: '18px 20px',
                      cursor: 'pointer',
                      border: '1px solid rgba(0,0,0,0.04)',
                      boxShadow: isHovered ? '0 8px 24px rgba(0,0,0,0.1)' : '0 1px 4px rgba(0,0,0,0.04)',
                      transform: isHovered ? 'translateY(-2px)' : 'none',
                      transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  >
                    {/* Course badge */}
                    <div style={{ marginBottom: 10 }}>
                      <span className="badge badge-blue" style={{ fontSize: 10.5, fontFamily: 'var(--font-jetbrains-mono)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {a.courseName.length > 30 ? a.courseName.slice(0, 30) + '…' : a.courseName}
                      </span>
                    </div>

                    {/* Name */}
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1A1A1A', marginBottom: 14, lineHeight: 1.4 }}>
                      {a.name}
                    </div>

                    {/* Meta row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: dueColor, background: dueBg, padding: '3px 10px', borderRadius: 999 }}>
                        {dueLabel}
                      </span>
                      {a.points_possible !== null && (
                        <span style={{ fontSize: 11.5, color: '#9B9BAB' }}>{a.points_possible} pts</span>
                      )}
                      <span className={`badge ${subClass}`} style={{ marginLeft: 'auto', fontSize: 11 }}>
                        {subLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Slide-over: Assignment Detail ── */}
      {selected && (
        <>
          <div className="slideover-overlay" onClick={() => setSelected(null)} />
          <div className="slideover-panel">
            <div style={{ padding: 32 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                <div style={{ flex: 1, marginRight: 16 }}>
                  <span className="badge badge-blue" style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 10, display: 'inline-block' }}>
                    {selected.courseName.length > 40 ? selected.courseName.slice(0, 40) + '…' : selected.courseName}
                  </span>
                  <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A1A', margin: '8px 0 0', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                    {selected.name}
                  </h2>
                </div>
                <button onClick={() => setSelected(null)} style={{ width: 32, height: 32, borderRadius: 999, border: 'none', background: '#F0EDEA', color: '#6B6B7B', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 150ms ease' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#E8E4DF'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#F0EDEA'; }}>
                  ×
                </button>
              </div>

              {/* Details grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
                {[
                  { label: 'Due', value: formatDueDate(selected.due_at) ?? 'No due date' },
                  { label: 'Time left', value: urgencyInfo(selected.due_at).label },
                  { label: 'Points', value: selected.points_possible !== null ? `${selected.points_possible} pts` : 'Ungraded' },
                  { label: 'Status', value: statusInfo(selected.submission).label },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: '#F8F6F4', borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1A1A' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Urgency bar */}
              {(() => {
                const { color, bg } = urgencyInfo(selected.due_at);
                return (
                  <div style={{ background: bg, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${color}22` }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color }}>{urgencyInfo(selected.due_at).label}</span>
                    {selected.due_at && <span style={{ fontSize: 13, color: '#6B6B7B', marginLeft: 'auto' }}>{formatDueDate(selected.due_at)}</span>}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
