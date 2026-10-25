'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStableData } from '@/lib/swr-config';
import CollapsibleModule from './CollapsibleModule';

type CanvasAssignment = {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  points_possible: number | null;
  submission: { workflow_state: string } | null;
  courseName: string;
};

type FilterStatus = 'all' | 'pending' | 'submitted' | 'overdue';
type SortKey = 'due' | 'course' | 'priority';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUrgency(due_at: string | null): 'overdue' | 'urgent' | 'soon' | 'normal' {
  if (!due_at) return 'normal';
  const diff = new Date(due_at).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 24 * 60 * 60 * 1000) return 'urgent';
  if (diff < 3 * 24 * 60 * 60 * 1000) return 'soon';
  return 'normal';
}

function urgencyColor(u: ReturnType<typeof getUrgency>): string {
  if (u === 'overdue') return '#D88878';
  if (u === 'urgent' || u === 'soon') return '#E8B87A';
  return '#8FC89A';
}

function urgencyScore(a: CanvasAssignment): number {
  const u = getUrgency(a.due_at);
  if (u === 'overdue') return 0;
  if (u === 'urgent') return 1;
  if (u === 'soon') return 2;
  return 3;
}

function stripHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function fmtDue(due_at: string | null): React.ReactNode {
  if (!due_at) return <span style={{ color: '#766D62' }}>No due date</span>;
  const d = new Date(due_at);
  const diff = d.getTime() - Date.now();
  const diffH = Math.floor(diff / (1000 * 60 * 60));
  const diffD = Math.floor(diffH / 24);
  const u = getUrgency(due_at);
  const color = urgencyColor(u);
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (diff < 0) return <span style={{ color }}>Overdue · {d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>;
  if (diffH < 1) return <span style={{ color }}>Due soon</span>;
  if (diffH < 24) return <span style={{ color }}>In {diffH}h · {date}</span>;
  if (diffD === 1) return <span style={{ color }}>Tomorrow · {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
  if (diffD < 4) return <span style={{ color }}>In {diffD}d · {date}</span>;
  return <span style={{ color: '#766D62' }}>{date}</span>;
}

function SubmissionBadge({ state }: { state: string | null | undefined }) {
  if (!state || state === 'unsubmitted') return null;
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    submitted:      { label: 'Submitted', bg: 'rgba(143,200,154,0.15)', color: '#8FC89A' },
    graded:         { label: 'Graded',    bg: 'rgba(143,200,154,0.15)', color: '#8FC89A' },
    pending_review: { label: 'In Review', bg: 'rgba(232,184,122,0.15)', color: '#E8B87A' },
  };
  const c = cfg[state];
  if (!c) return null;
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--font-jetbrains-mono)',
      background: c.bg, color: c.color,
      padding: '2px 6px', borderRadius: 4, fontWeight: 600, flexShrink: 0,
    }}>
      {c.label}
    </span>
  );
}

// ── Sidebar compact card ───────────────────────────────────────────────────────

function SidebarCard({ a }: { a: CanvasAssignment }) {
  const u = getUrgency(a.due_at);
  const isHot = u === 'urgent' || u === 'overdue';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px',
      background: isHot ? 'rgba(232,184,122,0.08)' : '#221E2A',
      border: `1px solid ${isHot ? 'rgba(232,184,122,0.2)' : 'rgba(255,235,210,0.07)'}`,
      borderRadius: 10,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: isHot ? '#E8B87A' : 'rgba(255,235,210,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke={isHot ? '#17141C' : '#766D62'} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#FBF5EC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.name}
        </div>
        <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{a.courseName}</span>
          <span>·</span>
          {fmtDue(a.due_at)}
        </div>
      </div>
    </div>
  );
}

// ── Modal assignment card ──────────────────────────────────────────────────────

function ModalCard({ a, onComplete }: {
  a: CanvasAssignment;
  onComplete: (a: CanvasAssignment) => void;
}) {
  const u = getUrgency(a.due_at);
  const color = urgencyColor(u);
  const excerpt = stripHtml(a.description);
  const bcUrl = `https://bcourses.berkeley.edu/courses/${a.course_id}/assignments/${a.id}`;

  return (
    <div style={{
      background: '#221E2A', border: '1px solid rgba(255,235,210,0.07)',
      borderRadius: 10, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Urgency indicator */}
        <div style={{
          width: 4, borderRadius: 2, alignSelf: 'stretch', flexShrink: 0,
          background: color, minHeight: 16,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC', lineHeight: 1.4, marginBottom: 4 }}>
            {a.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', color }}>
              {fmtDue(a.due_at)}
            </span>
            {a.points_possible != null && (
              <span style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', color: '#766D62' }}>
                {a.points_possible} pts
              </span>
            )}
            <SubmissionBadge state={a.submission?.workflow_state} />
          </div>
        </div>
        {/* Complete checkbox */}
        <button
          onClick={() => onComplete(a)}
          title="Mark as complete"
          style={{
            width: 20, height: 20, borderRadius: 5,
            border: '1.5px solid rgba(255,235,210,0.2)', background: 'transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, padding: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#766D62" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 6 5 9 10 3"/>
          </svg>
        </button>
      </div>

      {/* Description excerpt */}
      {excerpt && (
        <div style={{ fontSize: 11, color: '#A89E91', lineHeight: 1.5, paddingLeft: 14 }}>
          {excerpt}{excerpt.length === 140 ? '…' : ''}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 14 }}>
        <a
          href={bcUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)',
            color: '#7EB8D6', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          Open in bCourses
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────────

function AssignmentsModal({
  assignments,
  loading,
  onClose,
  onRefresh,
  onComplete,
}: {
  assignments: CanvasAssignment[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onComplete: (a: CanvasAssignment) => void;
}) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCourse, setFilterCourse] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortKey>('due');
  const [collapsedCourses, setCollapsedCourses] = useState<Set<string>>(new Set());

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Unique courses for dropdown
  const courses = Array.from(new Set(assignments.map((a) => a.courseName))).sort();

  // Filter
  const filtered = assignments.filter((a) => {
    if (filterCourse !== 'all' && a.courseName !== filterCourse) return false;
    const state = a.submission?.workflow_state;
    const u = getUrgency(a.due_at);
    if (filterStatus === 'pending') return (!state || state === 'unsubmitted') && u !== 'overdue';
    if (filterStatus === 'submitted') return state === 'submitted' || state === 'graded' || state === 'pending_review';
    if (filterStatus === 'overdue') return u === 'overdue' && (!state || state === 'unsubmitted');
    return true;
  });

  // Sort within each course
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'course') return a.courseName.localeCompare(b.courseName) || (a.due_at ?? '').localeCompare(b.due_at ?? '');
    if (sortBy === 'priority') return urgencyScore(a) - urgencyScore(b);
    // due (default)
    const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
    const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
    return da - db;
  });

  // Group by course
  const groups: Record<string, CanvasAssignment[]> = {};
  for (const a of sorted) {
    if (!groups[a.courseName]) groups[a.courseName] = [];
    groups[a.courseName].push(a);
  }
  const groupNames = Object.keys(groups).sort((a, b) => {
    if (sortBy === 'course') return a.localeCompare(b);
    const earliest = (name: string) => {
      const first = groups[name][0];
      return first?.due_at ? new Date(first.due_at).getTime() : Infinity;
    };
    return earliest(a) - earliest(b);
  });

  const toggleCourse = (name: string) => {
    setCollapsedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const statusTabs: { key: FilterStatus; label: string }[] = [
    { key: 'all',       label: 'All' },
    { key: 'pending',   label: 'Pending' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'overdue',   label: 'Overdue' },
  ];

  const selectStyle = {
    padding: '5px 10px', borderRadius: 8, fontSize: 12,
    border: '1px solid rgba(255,235,210,0.13)', background: '#221E2A',
    color: '#FBF5EC', cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1C1822', borderRadius: 16,
          width: '100%', maxWidth: 780, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(255,235,210,0.07)',
          background: '#221E2A',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#FBF5EC', fontFamily: 'var(--font-display)', marginBottom: 2 }}>
              Assignments
            </div>
            <div style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>
              {assignments.length} across {courses.length} course{courses.length !== 1 ? 's' : ''}
            </div>
          </div>
          {/* Refresh */}
          <button
            onClick={onRefresh}
            style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,235,210,0.13)',
              background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A89E91',
            }}
            title="Refresh"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,235,210,0.13)',
              background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A89E91',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Filter bar */}
        <div style={{
          padding: '12px 24px', background: '#1C1822',
          borderBottom: '1px solid rgba(255,235,210,0.07)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          {/* Status tabs */}
          <div style={{ display: 'flex', gap: 4 }}>
            {statusTabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterStatus(key)}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12,
                  border: filterStatus === key ? '1px solid rgba(126,184,214,0.4)' : '1px solid rgba(255,235,210,0.13)',
                  background: filterStatus === key ? 'rgba(126,184,214,0.12)' : 'transparent',
                  color: filterStatus === key ? '#7EB8D6' : '#766D62',
                  cursor: 'pointer', fontWeight: filterStatus === key ? 600 : 400,
                  fontFamily: 'var(--font-jetbrains-mono)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Course dropdown */}
          <select value={filterCourse} onChange={(e) => setFilterCourse(e.target.value)} style={selectStyle}>
            <option value="all">All courses</option>
            {courses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Sort dropdown */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>Sort:</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} style={selectStyle}>
              <option value="due">Due date</option>
              <option value="course">Course</option>
              <option value="priority">Priority</option>
            </select>
          </div>
        </div>

        {/* Content */}
        <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 80, borderRadius: 10 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>No new assignments</div>
              <div style={{ fontSize: 11 }}>New assignments from bCourses will appear here</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {groupNames.map((courseName) => {
                const courseAssignments = groups[courseName];
                const isCollapsed = collapsedCourses.has(courseName);
                return (
                  <div key={courseName}>
                    {/* Course header */}
                    <button
                      onClick={() => toggleCourse(courseName)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 0', background: 'transparent', border: 'none',
                        cursor: 'pointer', marginBottom: isCollapsed ? 0 : 8, textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                        {courseName}
                      </span>
                      <span style={{
                        fontSize: 10, fontFamily: 'var(--font-jetbrains-mono)',
                        background: 'rgba(255,235,210,0.08)', color: '#766D62',
                        padding: '2px 7px', borderRadius: 10,
                      }}>
                        {courseAssignments.length}
                      </span>
                      <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="#766D62" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 200ms ease' }}
                      >
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                    {/* Assignments */}
                    {!isCollapsed && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {courseAssignments.map((a) => (
                          <ModalCard key={a.id} a={a} onComplete={onComplete} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main module ───────────────────────────────────────────────────────────────

export default function AssignmentsModule({ onModalOpenChange }: { onModalOpenChange?: (open: boolean) => void } = {}) {
  const { data: assignmentsData, isLoading: loading, error: fetchError, mutate: mutateAssignments } = useStableData<{ assignments: CanvasAssignment[] }>('/api/canvas/assignments?days=14');
  const [assignments, setAssignments] = useState<CanvasAssignment[]>([]);
  const [error, setError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Mirror modal-open state up to HomeView so it can add the body.modal-open
  // class. Without this the right-rail stacking context stays at z-10 and the
  // EmptyHero (in the center column's z-20 context) renders through this modal.
  useEffect(() => { onModalOpenChange?.(modalOpen); }, [modalOpen, onModalOpenChange]);

  useEffect(() => {
    if (assignmentsData) {
      if (Array.isArray(assignmentsData.assignments)) {
        setAssignments(assignmentsData.assignments);
        setError(false);
      } else {
        setError(true);
      }
    }
    if (fetchError) setError(true);
  }, [assignmentsData, fetchError]);

  const handleComplete = useCallback(async (a: CanvasAssignment) => {
    // Optimistic removal
    setAssignments((prev) => prev.filter((x) => x.id !== a.id));
    try {
      await fetch(`/api/assignments/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userCompleted: true,
          title: a.name,
          courseId: String(a.course_id),
          courseName: a.courseName,
          dueAt: a.due_at,
          pointsPossible: a.points_possible,
          submissionStatus: a.submission?.workflow_state ?? null,
          description: a.description,
        }),
      });
    } catch {
      // Restore on failure
      setAssignments((prev) => [...prev, a]);
    }
  }, []);

  // Sidebar: urgent first, cap at 5
  const urgentFirst = [
    ...assignments.filter((a) => {
      const u = getUrgency(a.due_at);
      return u === 'overdue' || u === 'urgent';
    }),
    ...assignments.filter((a) => {
      const u = getUrgency(a.due_at);
      return u !== 'overdue' && u !== 'urgent';
    }),
  ].slice(0, 5);

  return (
    <>
      <CollapsibleModule
        title="Assignments"
        index="02"
        count={assignments.length || undefined}
        onExpand={() => setModalOpen(true)}
      >
        <div style={{ padding: '0 16px 14px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1].map((i) => (
                <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10 }} />
              ))}
            </div>
          ) : error ? (
            <div style={{ fontSize: 12, color: '#766D62', textAlign: 'center', padding: '8px 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
              Unavailable
            </div>
          ) : urgentFirst.length === 0 ? (
            <div style={{ fontSize: 12, color: '#766D62', textAlign: 'center', padding: '8px 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
              <div>No new assignments</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>New assignments from bCourses will appear here</div>
            </div>
          ) : (
            <div className="thin-scroll" style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {urgentFirst.map((a) => (
                <SidebarCard key={a.id} a={a} />
              ))}
              {assignments.length > 5 && (
                <button
                  onClick={() => setModalOpen(true)}
                  style={{
                    fontSize: 11, color: '#7EB8D6', background: 'transparent', border: 'none',
                    cursor: 'pointer', padding: '4px 0', textAlign: 'center',
                    fontFamily: 'var(--font-jetbrains-mono)',
                  }}
                >
                  +{assignments.length - 5} more · View all
                </button>
              )}
            </div>
          )}
        </div>
      </CollapsibleModule>

      {modalOpen && (
        <AssignmentsModal
          assignments={assignments}
          loading={loading}
          onClose={() => setModalOpen(false)}
          onRefresh={async () => {
            await fetch('/api/canvas/assignments?days=14&force=true');
            mutateAssignments();
          }}
          onComplete={handleComplete}
        />
      )}
    </>
  );
}
