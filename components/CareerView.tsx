'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  useDndMonitor,
} from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import NetworkView from './wiki/NetworkView';
import LivingResume from './wiki/LivingResume';
import ResumeStudio from '@/components/resume/ResumeStudio';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CareerTab = 'dashboard' | 'opportunities' | 'pipeline' | 'outreach' | 'materials' | 'connections' | 'suggestions' | 'resume';

interface ScanJob {
  url: string;
  title: string;
  company: string;
  portal: string;
  scannedAt: string;
}

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  followupsOverdue: number;
  newJobsToday: number;
  outreachToday?: number;
  outreachPending?: number;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={{
      background: '#1C1822',
      border: '1px solid rgba(255,235,210,0.07)',
      borderRadius: 12,
      padding: '16px 20px',
      flex: 1,
      minWidth: 120,
    }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: accent ?? '#FBF5EC', fontFamily: 'var(--font-jetbrains-mono)' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: '#766D62', marginTop: 2, fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  );
}

// ── Dashboard tab ──────────────────────────────────────────────────────────────

function DashboardTab({ stats, onNavigate }: { stats: Stats | null; onNavigate: (tab: CareerTab) => void }) {
  const CARDS: { label: string; value: string | number; accent?: string; tab?: CareerTab }[] = stats ? [
    { label: 'Applications', value: stats.total, tab: 'pipeline' },
    { label: 'Active', value: (stats.byStatus['applied'] ?? 0) + (stats.byStatus['interviewing'] ?? 0), accent: '#7EB8D6', tab: 'pipeline' },
    { label: 'Interviews', value: stats.byStatus['interviewing'] ?? 0, accent: '#E8B87A', tab: 'pipeline' },
    { label: 'Offers', value: stats.byStatus['offer'] ?? 0, accent: '#8FC89A', tab: 'pipeline' },
    { label: 'Follow-ups Due', value: stats.followupsOverdue, accent: stats.followupsOverdue > 0 ? '#D4645C' : '#8FC89A', tab: 'pipeline' },
    { label: 'New Jobs Today', value: stats.newJobsToday, accent: '#8FC89A', tab: 'opportunities' },
    { label: 'Outreach Pending', value: stats.outreachPending ?? 0, accent: stats.outreachPending ? '#E8B87A' : '#766D62', tab: 'outreach' },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Stats */}
      {stats && (
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', color: '#766D62', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Overview
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {CARDS.map((c) => (
              <div
                key={c.label}
                onClick={() => c.tab && onNavigate(c.tab)}
                style={{ flex: 1, minWidth: 120, cursor: c.tab ? 'pointer' : 'default' }}
              >
                <StatCard label={c.label} value={c.value} accent={c.accent} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick-nav cards */}
      <div>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', color: '#766D62', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
          Sections
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {([
            { tab: 'opportunities' as CareerTab, label: 'Opportunities', desc: 'Jobs, fellowships, research, grants, policy' },
            { tab: 'pipeline'      as CareerTab, label: 'Pipeline',      desc: 'Kanban by status — applied to offer' },
            { tab: 'outreach'      as CareerTab, label: 'Outreach',      desc: 'Cold email campaigns and follow-ups' },
            { tab: 'materials'     as CareerTab, label: 'Materials',     desc: 'CV, LinkedIn, network, resume variants' },
            { tab: 'connections'   as CareerTab, label: 'Connections',   desc: 'LinkedIn contacts — import, browse, enrich' },
            { tab: 'suggestions'   as CareerTab, label: 'Suggestions',   desc: 'Claude-curated weekly career moves' },
            { tab: 'resume'        as CareerTab, label: 'Resume Studio', desc: 'Vault-grounded tailoring, guarded end-to-end' },
          ] as const).map(({ tab, label, desc }) => (
            <button
              key={tab}
              onClick={() => onNavigate(tab)}
              style={{
                background: '#1C1822',
                border: '1px solid rgba(255,235,210,0.07)',
                borderRadius: 12,
                padding: '14px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'border-color 150ms ease, background 150ms ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = '#221E2A';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(126,184,214,0.25)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = '#1C1822';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,235,210,0.07)';
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: '#766D62', lineHeight: 1.4 }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Pipeline tab ───────────────────────────────────────────────────────────────

interface PipelineCard {
  id: string;
  org: string;
  role: string;
  type: string;
  status: string;
  url?: string | null;
  deadline?: string | null;
  score?: string | null;
  notes?: string | null;
  sourceId?: string | null;
  createdAt?: string;
  source?: 'db' | 'markdown';
}

const PIPELINE_COLS: { id: string; label: string }[] = [
  { id: 'discovered',  label: 'Discovered'  },
  { id: 'evaluated',   label: 'Evaluated'   },
  { id: 'applied',     label: 'Applied'     },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer',       label: 'Offer'       },
  { id: 'closed',      label: 'Closed'      },
];

const COL_ACCENT: Record<string, string> = {
  discovered:   '#766D62',
  evaluated:    '#9B9BAB',
  applied:      '#7EB8D6',
  interviewing: '#E8B87A',
  offer:        '#8FC89A',
  closed:       '#D4645C',
};

const TYPE_COLORS: Record<string, string> = {
  job:        '#E8B87A',
  fellowship: '#B8A0E8',
  research:   '#7EB8D6',
  grant:      '#8FC89A',
  policy:     '#E87A7A',
};

const TYPE_LABELS: Record<string, string> = {
  job:        'JOB',
  fellowship: 'FELLOWSHIP',
  research:   'RESEARCH',
  grant:      'GRANT',
  policy:     'POLICY',
};

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? '#766D62';
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 9,
      fontFamily: 'var(--font-jetbrains-mono)',
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color,
      background: `${color}18`,
      border: `1px solid ${color}30`,
      flexShrink: 0,
    }}>
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

// Card detail modal
function CardModal({
  card,
  onClose,
  onStatusChange,
  onDelete,
  onNotesChange,
}: {
  card: PipelineCard;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onNotesChange: (id: string, notes: string) => void;
}) {
  const [notes, setNotes] = useState(card.notes ?? '');
  const [editingNotes, setEditingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const isReadonly = card.source === 'markdown';

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await fetch(`/api/career/pipeline/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      onNotesChange(card.id, notes);
      setEditingNotes(false);
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1C1822',
          border: '1px solid rgba(255,235,210,0.1)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 560,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <TypeBadge type={card.type} />
              {card.score && (
                <span style={{ fontSize: 11, color: '#E8B87A', fontFamily: 'var(--font-jetbrains-mono)' }}>
                  {card.score}
                </span>
              )}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#FBF5EC', marginBottom: 2 }}>
              {card.org}
            </div>
            <div style={{ fontSize: 14, color: '#9B9BAB' }}>{card.role}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#766D62', cursor: 'pointer', fontSize: 18, padding: 4, flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {card.deadline && (
            <div style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>
              Deadline: <span style={{ color: '#E8B87A' }}>{card.deadline}</span>
            </div>
          )}
          {card.url && (
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: '#7EB8D6', textDecoration: 'none', fontFamily: 'var(--font-jetbrains-mono)' }}
            >
              Open ↗
            </a>
          )}
        </div>

        {/* Status selector */}
        {!isReadonly && (
          <div>
            <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Status
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PIPELINE_COLS.map((col) => {
                const active = card.status === col.id;
                const accent = COL_ACCENT[col.id];
                return (
                  <button
                    key={col.id}
                    onClick={() => onStatusChange(card.id, col.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: `1px solid ${active ? accent : 'rgba(255,235,210,0.12)'}`,
                      background: active ? `${accent}18` : 'transparent',
                      color: active ? accent : '#766D62',
                      fontSize: 11,
                      fontFamily: 'var(--font-jetbrains-mono)',
                      cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                      transition: 'all 150ms',
                    }}
                  >
                    {col.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Notes
            </span>
            {!isReadonly && !editingNotes && (
              <button
                onClick={() => setEditingNotes(true)}
                style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(126,184,214,0.3)', background: 'transparent', color: '#7EB8D6', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
              >
                Edit
              </button>
            )}
          </div>
          {editingNotes ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{
                  width: '100%', minHeight: 120,
                  background: '#221E2A',
                  border: '1px solid rgba(126,184,214,0.3)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: '#FBF5EC',
                  fontSize: 13,
                  fontFamily: 'var(--font-jetbrains-mono)',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setNotes(card.notes ?? ''); setEditingNotes(false); }}
                  style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(255,235,210,0.12)', background: 'transparent', color: '#766D62', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#7EB8D6', color: '#17141C', fontSize: 12, fontWeight: 600, cursor: savingNotes ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
                >
                  {savingNotes ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: notes ? '#EADFD0' : '#766D62', fontFamily: 'var(--font-jetbrains-mono)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {notes || 'No notes yet.'}
            </div>
          )}
        </div>

        {/* Delete */}
        {!isReadonly && (
          <div style={{ borderTop: '1px solid rgba(255,235,210,0.07)', paddingTop: 12 }}>
            <button
              onClick={() => { onDelete(card.id); onClose(); }}
              style={{
                padding: '6px 14px',
                borderRadius: 7,
                border: '1px solid rgba(212,100,92,0.3)',
                background: 'transparent',
                color: '#D4645C',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'var(--font-jetbrains-mono)',
              }}
            >
              Remove from pipeline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Droppable column wrapper
function KanbanColumn({
  colId,
  label,
  cards,
  onCardClick,
}: {
  colId: string;
  label: string;
  cards: PipelineCard[];
  onCardClick: (card: PipelineCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: colId });
  const accent = COL_ACCENT[colId] ?? '#766D62';
  const [isDragging, setIsDragging] = useState(false);
  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd:   () => setIsDragging(false),
    onDragCancel:() => setIsDragging(false),
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 220,
        width: 220,
        flexShrink: 0,
        background: isOver ? 'rgba(126,184,214,0.04)' : '#1C1822',
        border: `1px solid ${isOver ? 'rgba(126,184,214,0.3)' : 'rgba(255,235,210,0.10)'}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 12,
        overflow: 'hidden',
        transition: 'border-color 150ms, background 150ms',
      }}
    >
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,235,210,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: `linear-gradient(180deg, ${accent}12 0%, transparent 100%)`,
      }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {label}
        </span>
        <span style={{
          fontSize: 11,
          color: '#FBF5EC',
          fontFamily: 'var(--font-jetbrains-mono)',
          background: `${accent}22`,
          border: `1px solid ${accent}44`,
          borderRadius: 999,
          padding: '1px 7px',
          fontWeight: 600,
        }}>
          {cards.length}
        </span>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 80 }}>
        {cards.length === 0 && isDragging && (
          <div style={{
            margin: '4px 0',
            padding: '14px 6px',
            fontSize: 11,
            color: 'rgba(118,109,98,0.45)',
            textAlign: 'center',
            fontFamily: 'var(--font-jetbrains-mono)',
            border: '1px dashed rgba(118,109,98,0.20)',
            borderRadius: 6,
          }}>
            Drop here
          </div>
        )}
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} onClick={() => onCardClick(card)} />
        ))}
      </div>
    </div>
  );
}

// Draggable card
function DraggableCard({ card, onClick }: { card: PipelineCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });

  const style = {
    // position: relative establishes a containing block for the absolute-
    // positioned click overlay below. Without this, every card's overlay
    // resolves inset:0 against the viewport, so the last-rendered card's
    // overlay covers the whole page and intercepts every click.
    position: 'relative' as const,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    cursor: 'grab',
    background: '#221E2A',
    border: '1px solid rgba(255,235,210,0.06)',
    borderRadius: 8,
    padding: '10px 12px',
    userSelect: 'none' as const,
    transition: 'opacity 150ms',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <TypeBadge type={card.type} />
        {card.score && (
          <span style={{ fontSize: 10, color: '#E8B87A', fontFamily: 'var(--font-jetbrains-mono)' }}>
            {card.score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#FBF5EC', marginBottom: 1 }}>
        {card.org}
      </div>
      <div style={{ fontSize: 11, color: '#9B9BAB', lineHeight: 1.3, marginBottom: card.deadline ? 4 : 0 }}>
        {card.role.length > 36 ? card.role.slice(0, 36) + '…' : card.role}
      </div>
      {card.deadline && (
        <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>
          {card.deadline}
        </div>
      )}
      {/* Click zone overlay (separate from drag to avoid conflict) */}
      <div
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 8,
          cursor: 'pointer',
        }}
      />
    </div>
  );
}

// New card form
function AddCardModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (card: PipelineCard) => void;
}) {
  const [form, setForm] = useState({ org: '', role: '', type: 'job', url: '', deadline: '', notes: '' });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.org || !form.role) return;
    setSaving(true);
    try {
      const res = await fetch('/api/career/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, status: 'discovered' }),
      });
      const data = await res.json();
      if (res.ok) { onAdd(data.card); onClose(); }
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: '100%', background: '#221E2A',
    border: '1px solid rgba(255,235,210,0.1)',
    borderRadius: 7, padding: '8px 10px',
    color: '#FBF5EC', fontSize: 13,
    fontFamily: 'var(--font-jetbrains-mono)',
    outline: 'none', boxSizing: 'border-box' as const,
  };
  const labelStyle = { fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.05em', textTransform: 'uppercase' as const, marginBottom: 4, display: 'block' };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#1C1822', border: '1px solid rgba(255,235,210,0.1)', borderRadius: 16, width: '100%', maxWidth: 440, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: '#FBF5EC' }}>Add to pipeline</div>

        <div>
          <label style={labelStyle}>Organization *</label>
          <input required value={form.org} onChange={(e) => setForm((f) => ({ ...f, org: e.target.value }))} placeholder="Anthropic" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Role / Program *</label>
          <input required value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="Product Manager Intern" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Type</label>
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} style={{ ...inputStyle, appearance: 'none' }}>
            <option value="job">Job</option>
            <option value="fellowship">Fellowship</option>
            <option value="research">Research</option>
            <option value="grant">Grant</option>
            <option value="policy">Policy</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>URL</label>
            <input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://…" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Deadline</label>
            <input value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} placeholder="Oct 1" style={inputStyle} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(255,235,210,0.12)', background: 'transparent', color: '#766D62', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: '#7EB8D6', color: '#17141C', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PipelineTab() {
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [modalCard, setModalCard] = useState<PipelineCard | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const draggingRef = useRef<PipelineCard | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  async function loadCards() {
    setLoading(true);
    try {
      const res = await fetch('/api/career/pipeline');
      const data = await res.json();
      setCards(data.cards ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCards(); }, []);

  function handleDragStart(event: DragStartEvent) {
    const card = cards.find((c) => c.id === event.active.id);
    draggingRef.current = card ?? null;
    setActiveCard(card ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    draggingRef.current = null;
    const { active, over } = event;
    if (!over) return;

    const card = cards.find((c) => c.id === active.id);
    if (!card) return;

    // Determine target column — over.id is the column id (from useDroppable)
    const targetCol = PIPELINE_COLS.find((c) => c.id === over.id);
    if (!targetCol || targetCol.id === card.status) return;

    // Markdown-sourced cards can't be moved via DB
    if (card.source === 'markdown') return;

    // Optimistic update
    setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, status: targetCol.id } : c));

    try {
      await fetch(`/api/career/pipeline/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetCol.id }),
      });
    } catch {
      // Revert on failure
      setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, status: card.status } : c));
    }
  }

  function handleStatusChange(id: string, status: string) {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
    if (modalCard?.id === id) setModalCard((m) => m ? { ...m, status } : m);
    fetch(`/api/career/pipeline/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => {});
  }

  function handleDelete(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    fetch(`/api/career/pipeline/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  function handleNotesChange(id: string, notes: string) {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, notes } : c));
  }

  const grouped: Record<string, PipelineCard[]> = {};
  for (const col of PIPELINE_COLS) grouped[col.id] = [];
  for (const card of cards) {
    const key = card.status;
    if (grouped[key]) grouped[key].push(card);
    else grouped['discovered'].push(card);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        {loading && <span style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>loading…</span>}
        {!loading && <span style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>{cards.length} total</span>}
        <button
          onClick={() => setShowAdd(true)}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: 'none',
            background: '#7EB8D6',
            color: '#17141C',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--font-jetbrains-mono)',
          }}
        >
          + Add
        </button>
      </div>

      {/* Kanban board */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', flex: 1, alignItems: 'flex-start', paddingBottom: 8 }}>
          {PIPELINE_COLS.map((col) => (
            <KanbanColumn
              key={col.id}
              colId={col.id}
              label={col.label}
              cards={grouped[col.id] ?? []}
              onCardClick={setModalCard}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard && (
            <div style={{
              background: '#221E2A',
              border: '1px solid rgba(126,184,214,0.3)',
              borderRadius: 8,
              padding: '10px 12px',
              opacity: 0.9,
              width: 200,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              <TypeBadge type={activeCard.type} />
              <div style={{ fontSize: 12, fontWeight: 600, color: '#FBF5EC', marginTop: 4 }}>{activeCard.org}</div>
              <div style={{ fontSize: 11, color: '#9B9BAB' }}>{activeCard.role.slice(0, 36)}</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Card detail modal */}
      {modalCard && (
        <CardModal
          card={modalCard}
          onClose={() => setModalCard(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onNotesChange={handleNotesChange}
        />
      )}

      {/* Add card modal */}
      {showAdd && (
        <AddCardModal
          onClose={() => setShowAdd(false)}
          onAdd={(card) => setCards((prev) => [card, ...prev])}
        />
      )}
    </div>
  );
}

// ── Opportunities tab ──────────────────────────────────────────────────────────

interface CatalogOpportunity {
  id: string;
  name: string;
  org: string;
  category: string;
  url: string;
  deadline: string | null;
  cycle: string;
  fit: 'primary' | 'secondary' | 'adjacent';
  notes: string;
  dismissed?: boolean;
}

type OpportunitiesSubTab = 'jobs' | 'fellowships' | 'research' | 'grants' | 'policy';

const FIT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  primary:   { bg: 'rgba(143,200,154,0.12)', text: '#8FC89A', border: 'rgba(143,200,154,0.3)' },
  secondary: { bg: 'rgba(232,184,122,0.12)', text: '#E8B87A', border: 'rgba(232,184,122,0.3)' },
  adjacent:  { bg: 'rgba(118,109,98,0.12)',  text: '#766D62', border: 'rgba(118,109,98,0.25)' },
};

function FitPill({ fit }: { fit: string }) {
  const c = FIT_COLORS[fit] ?? FIT_COLORS['adjacent'];
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 5,
      fontSize: 10,
      fontFamily: 'var(--font-jetbrains-mono)',
      fontWeight: 600,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      background: c.bg,
      color: c.text,
      border: `1px solid ${c.border}`,
      flexShrink: 0,
    }}>
      {fit}
    </span>
  );
}

function CatalogTab({ category }: { category: string }) {
  const [items, setItems] = useState<CatalogOpportunity[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetch(`/api/career/opportunities?category=${category}`)
      .then((r) => r.json())
      .then((d) => setItems(d.opportunities ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [category]);

  async function handleAddToPipeline(item: CatalogOpportunity) {
    try {
      const res = await fetch('/api/career/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: item.org,
          role: item.name,
          status: 'saved',
          notes: item.notes,
          url: item.url,
        }),
      });
      if (res.ok) setAddedIds((prev) => new Set(prev).add(item.id));
    } catch {
      // silent
    }
  }

  const visible = items.filter((it) => !dismissed.has(it.id));

  if (loading) return (
    <div style={{ padding: '32px 0', fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', textAlign: 'center' }}>
      loading…
    </div>
  );

  if (visible.length === 0) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: '#766D62', fontSize: 13 }}>
      No {category} opportunities in catalog.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.map((item) => (
        <div key={item.id} style={{
          background: '#1C1822',
          border: '1px solid rgba(255,235,210,0.07)',
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC' }}>{item.name}</span>
                <FitPill fit={item.fit} />
              </div>
              <div style={{ fontSize: 12, color: '#9B9BAB' }}>
                {item.org}
                {item.deadline && (
                  <span style={{ marginLeft: 8, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11 }}>
                    · deadline: {item.deadline}
                  </span>
                )}
                <span style={{ marginLeft: 8, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11 }}>
                  · {item.cycle}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,235,210,0.12)',
                  background: 'transparent',
                  color: '#9B9BAB',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-jetbrains-mono)',
                  textDecoration: 'none',
                  lineHeight: '16px',
                  display: 'inline-block',
                }}
              >
                Open ↗
              </a>
              {addedIds.has(item.id) ? (
                <span style={{ padding: '5px 10px', fontSize: 11, color: '#8FC89A', fontFamily: 'var(--font-jetbrains-mono)' }}>
                  Added ✓
                </span>
              ) : (
                <button
                  onClick={() => handleAddToPipeline(item)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid rgba(126,184,214,0.3)',
                    background: 'transparent',
                    color: '#7EB8D6',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-jetbrains-mono)',
                  }}
                >
                  + Pipeline
                </button>
              )}
              <button
                onClick={() => setDismissed((prev) => new Set(prev).add(item.id))}
                style={{
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,235,210,0.08)',
                  background: 'transparent',
                  color: '#766D62',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-jetbrains-mono)',
                }}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
          {item.notes && (
            <div style={{ fontSize: 12, color: '#766D62', lineHeight: 1.5, paddingTop: 4, borderTop: '1px solid rgba(255,235,210,0.05)' }}>
              {item.notes}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function JobsTab() {
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [scanning, setScanning] = useState(false);
  const [evaluatingUrl, setEvaluatingUrl] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<{ url: string; score: number; archetype: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/career/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Scan failed');
      setJobs(data.newJobs ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setScanning(false);
    }
  }

  async function handleEvaluate(url: string) {
    setEvaluatingUrl(url);
    setError(null);
    setEvalResult(null);
    try {
      const res = await fetch('/api/career/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Evaluation failed');
      setEvalResult({ url, score: data.score, archetype: data.archetype });
    } catch (err) {
      setError(String(err));
    } finally {
      setEvaluatingUrl(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: scanning ? 'rgba(126,184,214,0.1)' : '#7EB8D6',
            color: scanning ? '#766D62' : '#17141C',
            fontSize: 13,
            fontWeight: 600,
            cursor: scanning ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-jetbrains-mono)',
            transition: 'all 200ms ease',
          }}
        >
          {scanning ? 'Scanning…' : 'Scan now'}
        </button>
        <span style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>
          Hits Greenhouse / Ashby / Lever portals directly
        </span>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(212,100,92,0.1)', border: '1px solid rgba(212,100,92,0.25)', color: '#D4645C', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {evalResult && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(143,200,154,0.1)', border: '1px solid rgba(143,200,154,0.25)', color: '#8FC89A', fontSize: 13, marginBottom: 12, fontFamily: 'var(--font-jetbrains-mono)' }}>
          Evaluated — Score: {evalResult.score}/5 · Archetype: {evalResult.archetype}
        </div>
      )}

      {jobs.length === 0 && !scanning && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#766D62', fontSize: 13 }}>
          Run a scan to see new job postings from your portal watchlist.
        </div>
      )}

      {jobs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {jobs.map((job) => (
            <div key={job.url} style={{
              background: '#1C1822',
              border: '1px solid rgba(255,235,210,0.07)',
              borderRadius: 10,
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC', marginBottom: 2 }}>
                  {job.title || job.company}
                </div>
                <div style={{ fontSize: 12, color: '#9B9BAB' }}>
                  {job.company} · {job.portal}
                </div>
              </div>
              <button
                onClick={() => handleEvaluate(job.url)}
                disabled={evaluatingUrl === job.url}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(126,184,214,0.3)',
                  background: 'transparent',
                  color: '#7EB8D6',
                  fontSize: 12,
                  cursor: evaluatingUrl === job.url ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-jetbrains-mono)',
                  flexShrink: 0,
                  opacity: evaluatingUrl === job.url ? 0.5 : 1,
                }}
              >
                {evaluatingUrl === job.url ? 'Evaluating…' : 'Evaluate'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OpportunitiesTab() {
  const [sub, setSub] = useState<OpportunitiesSubTab>('jobs');

  const subTabs: { id: OpportunitiesSubTab; label: string }[] = [
    { id: 'jobs',        label: 'Jobs' },
    { id: 'fellowships', label: 'Fellowships' },
    { id: 'research',    label: 'Research' },
    { id: 'grants',      label: 'Grants' },
    { id: 'policy',      label: 'Policy' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid rgba(255,235,210,0.07)', overflowX: 'auto', flexShrink: 0 }}>
        {subTabs.map((t) => {
          const isActive = t.id === sub;
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              style={{
                padding: '6px 14px',
                border: 'none',
                borderBottom: isActive ? '2px solid #7EB8D6' : '2px solid transparent',
                background: 'transparent',
                color: isActive ? '#7EB8D6' : '#766D62',
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                fontFamily: 'var(--font-jetbrains-mono)',
                transition: 'all 150ms ease',
                marginBottom: -1,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {sub === 'jobs'        && <JobsTab />}
      {sub === 'fellowships' && <CatalogTab category="fellowship" />}
      {sub === 'research'    && <CatalogTab category="research" />}
      {sub === 'grants'      && <CatalogTab category="grant" />}
      {sub === 'policy'      && <CatalogTab category="policy" />}
    </div>
  );
}

// ── Outreach tab ───────────────────────────────────────────────────────────────

interface OutreachMessage {
  id: string;
  campaignId: string;
  recipientName: string;
  recipientEmail: string;
  recipientTitle?: string | null;
  recipientOrg?: string | null;
  subject: string;
  body: string;
  status: string; // draft | approved | sent | replied | bounced
  sentAt?: string | null;
  repliedAt?: string | null;
  followupDue?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface OutreachCampaign {
  id: string;
  name: string;
  goal: string;
  status: string; // draft | active | paused | done
  targetOrg?: string | null;
  targetRole?: string | null;
  notes?: string | null;
  createdAt: string;
  messages: OutreachMessage[];
}

const MSG_STATUS_COLORS: Record<string, string> = {
  draft:    '#766D62',
  approved: '#7EB8D6',
  sent:     '#E8B87A',
  replied:  '#8FC89A',
  bounced:  '#D4645C',
};

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  draft:  '#766D62',
  active: '#8FC89A',
  paused: '#E8B87A',
  done:   '#9B9BAB',
};

function OutreachTab() {
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<OutreachCampaign | null>(null);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [showNewMessage, setShowNewMessage]   = useState(false);

  // New campaign form state
  const [ncName, setNcName]       = useState('');
  const [ncGoal, setNcGoal]       = useState('fellowship referral');
  const [ncOrg, setNcOrg]         = useState('');
  const [ncRole, setNcRole]       = useState('');
  const [ncNotes, setNcNotes]     = useState('');
  const [ncSaving, setNcSaving]   = useState(false);

  // New message form state
  const [nmName, setNmName]       = useState('');
  const [nmEmail, setNmEmail]     = useState('');
  const [nmTitle, setNmTitle]     = useState('');
  const [nmOrg, setNmOrg]         = useState('');
  const [nmSubject, setNmSubject] = useState('');
  const [nmBody, setNmBody]       = useState('');
  const [nmNotes, setNmNotes]     = useState('');
  const [nmDrafting, setNmDrafting] = useState(false);
  const [nmSaving, setNmSaving]   = useState(false);

  // Message detail state
  const [editingMsg, setEditingMsg] = useState<OutreachMessage | null>(null);
  const [emSubject, setEmSubject] = useState('');
  const [emBody, setEmBody]       = useState('');
  const [emSaving, setEmSaving]   = useState(false);
  const [pendingSend, setPendingSend] = useState<OutreachMessage | null>(null);
  const [sendAccount, setSendAccount] = useState<'berkeley' | 'personal'>('berkeley');
  const [sending, setSending]         = useState(false);
  const [sendError, setSendError]     = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/career/outreach');
      const data = await res.json() as { campaigns: OutreachCampaign[] };
      setCampaigns(data.campaigns ?? []);
      // refresh selected if open
      if (selected) {
        const fresh = data.campaigns.find((c) => c.id === selected.id);
        if (fresh) setSelected(fresh);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [selected]);

  useEffect(() => { loadCampaigns(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function createCampaign() {
    if (!ncName.trim()) return;
    setNcSaving(true);
    try {
      const res = await fetch('/api/career/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ncName, goal: ncGoal, targetOrg: ncOrg || undefined, targetRole: ncRole || undefined, notes: ncNotes || undefined }),
      });
      const data = await res.json() as { campaign: OutreachCampaign };
      setCampaigns((prev) => [{ ...data.campaign, messages: [] }, ...prev]);
      setNcName(''); setNcGoal('fellowship referral'); setNcOrg(''); setNcRole(''); setNcNotes('');
      setShowNewCampaign(false);
    } catch { /* silent */ }
    finally { setNcSaving(false); }
  }

  async function autoDraftMessage() {
    if (!selected || !nmName.trim() || !nmEmail.trim()) return;
    setNmDrafting(true);
    try {
      const res = await fetch(`/api/career/outreach/${selected.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: nmName,
          recipientEmail: nmEmail,
          recipientTitle: nmTitle || undefined,
          recipientOrg: nmOrg || undefined,
          notes: nmNotes || undefined,
          autoDraft: true,
          campaignGoal: selected.goal,
          senderName: 'Anatole Seychal',
          senderContext: 'UC Berkeley junior studying Applied Math, Data Science, and Political Economy. Interested in AI policy and fellowships.',
        }),
      });
      const data = await res.json() as { message: OutreachMessage };
      setNmSubject(data.message.subject);
      setNmBody(data.message.body);
      // Remove the auto-created draft so we can show it in the form for review
      await fetch(`/api/career/outreach/${selected.id}/messages/${data.message.id}`, { method: 'DELETE' });
    } catch { /* silent */ }
    finally { setNmDrafting(false); }
  }

  async function saveMessage() {
    if (!selected || !nmName.trim() || !nmEmail.trim() || !nmSubject.trim()) return;
    setNmSaving(true);
    try {
      const res = await fetch(`/api/career/outreach/${selected.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: nmName,
          recipientEmail: nmEmail,
          recipientTitle: nmTitle || undefined,
          recipientOrg: nmOrg || undefined,
          subject: nmSubject,
          body: nmBody,
          notes: nmNotes || undefined,
        }),
      });
      const data = await res.json() as { message: OutreachMessage };
      setSelected((prev) => prev ? { ...prev, messages: [...prev.messages, data.message] } : prev);
      setCampaigns((prev) => prev.map((c) => c.id === selected.id ? { ...c, messages: [...c.messages, data.message] } : c));
      setNmName(''); setNmEmail(''); setNmTitle(''); setNmOrg(''); setNmSubject(''); setNmBody(''); setNmNotes('');
      setShowNewMessage(false);
    } catch { /* silent */ }
    finally { setNmSaving(false); }
  }

  async function approveMessage(msg: OutreachMessage) {
    try {
      await fetch(`/api/career/outreach/${msg.campaignId}/messages/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      updateMsgInState(msg.id, msg.campaignId, { status: 'approved' });
    } catch { /* silent */ }
  }

  async function confirmSend(msg: OutreachMessage) {
    setSending(true);
    setSendError(null);
    try {
      // 1. Send via Gmail
      const gmailRes = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: sendAccount,
          to: `${msg.recipientName} <${msg.recipientEmail}>`,
          subject: msg.subject,
          body: msg.body,
        }),
      });
      const gmailData = await gmailRes.json().catch(() => ({})) as { error?: string; requiresApproval?: boolean; pendingActionId?: string };
      if (!gmailRes.ok) {
        throw new Error(gmailData.error ?? `Gmail error ${gmailRes.status}`);
      }
      // Sends are queued as a PendingAction (B-10); this confirm modal showed the
      // full message, so the user's click is the explicit per-message approval.
      if (gmailData.requiresApproval && gmailData.pendingActionId) {
        const ap = await fetch(`/api/pending-actions/${gmailData.pendingActionId}/approve`, { method: 'POST' });
        if (!ap.ok) {
          const apErr = await ap.json().catch(() => ({})) as { error?: string };
          throw new Error(apErr.error ?? 'Send approval failed');
        }
      }

      // 2. Mark as sent in DB
      await fetch(`/api/career/outreach/${msg.campaignId}/messages/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent', sentAt: new Date().toISOString() }),
      });
      updateMsgInState(msg.id, msg.campaignId, { status: 'sent', sentAt: new Date().toISOString() });
      setPendingSend(null);
      setSendError(null);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function saveEditedMessage() {
    if (!editingMsg) return;
    setEmSaving(true);
    try {
      await fetch(`/api/career/outreach/${editingMsg.campaignId}/messages/${editingMsg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: emSubject, body: emBody }),
      });
      updateMsgInState(editingMsg.id, editingMsg.campaignId, { subject: emSubject, body: emBody });
      setEditingMsg(null);
    } catch { /* silent */ }
    finally { setEmSaving(false); }
  }

  async function deleteMessage(msg: OutreachMessage) {
    try {
      await fetch(`/api/career/outreach/${msg.campaignId}/messages/${msg.id}`, { method: 'DELETE' });
      setSelected((prev) => prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== msg.id) } : prev);
      setCampaigns((prev) => prev.map((c) => c.id === msg.campaignId ? { ...c, messages: c.messages.filter((m) => m.id !== msg.id) } : c));
    } catch { /* silent */ }
  }

  async function deleteCampaign(campaign: OutreachCampaign) {
    try {
      await fetch(`/api/career/outreach/${campaign.id}`, { method: 'DELETE' });
      setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
      if (selected?.id === campaign.id) setSelected(null);
    } catch { /* silent */ }
  }

  async function setCampaignStatus(campaign: OutreachCampaign, status: string) {
    try {
      await fetch(`/api/career/outreach/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const updated = { ...campaign, status };
      setCampaigns((prev) => prev.map((c) => c.id === campaign.id ? updated : c));
      if (selected?.id === campaign.id) setSelected(updated);
    } catch { /* silent */ }
  }

  function updateMsgInState(msgId: string, campaignId: string, patch: Partial<OutreachMessage>) {
    const patchMsg = (m: OutreachMessage) => m.id === msgId ? { ...m, ...patch } : m;
    setSelected((prev) => prev ? { ...prev, messages: prev.messages.map(patchMsg) } : prev);
    setCampaigns((prev) => prev.map((c) => c.id === campaignId ? { ...c, messages: c.messages.map(patchMsg) } : c));
  }

  const inputStyle: React.CSSProperties = {
    background: '#17141C',
    border: '1px solid rgba(255,235,210,0.12)',
    borderRadius: 8,
    padding: '7px 10px',
    color: '#FBF5EC',
    fontSize: 13,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#766D62',
    fontFamily: 'var(--font-jetbrains-mono)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: 4,
    display: 'block',
  };

  const btnPrimary: React.CSSProperties = {
    background: '#7EB8D6',
    color: '#17141C',
    border: 'none',
    borderRadius: 8,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'var(--font-jetbrains-mono)',
  };

  const btnGhost: React.CSSProperties = {
    background: 'transparent',
    color: '#766D62',
    border: '1px solid rgba(255,235,210,0.10)',
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'var(--font-jetbrains-mono)',
  };

  // ── Send confirmation overlay ─────────────────────────────────────────────────
  if (pendingSend) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#1C1822', borderRadius: 16, padding: 28, maxWidth: 560, width: '100%', border: '1px solid rgba(255,235,210,0.12)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#FBF5EC', marginBottom: 4 }}>Send via Gmail</div>
          <div style={{ fontSize: 13, color: '#766D62', marginBottom: 16 }}>
            This will send the email through your Gmail account and mark it sent.
          </div>

          {/* Account picker */}
          <div style={{ marginBottom: 12 }}>
            <span style={labelStyle}>Send from</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['berkeley', 'personal'] as const).map((acct) => (
                <button
                  key={acct}
                  onClick={() => setSendAccount(acct)}
                  style={{
                    background: sendAccount === acct ? '#7EB8D6' : '#17141C',
                    color: sendAccount === acct ? '#17141C' : '#766D62',
                    border: `1px solid ${sendAccount === acct ? '#7EB8D6' : 'rgba(255,235,210,0.12)'}`,
                    borderRadius: 6,
                    padding: '5px 12px',
                    fontSize: 12,
                    fontFamily: 'var(--font-jetbrains-mono)',
                    cursor: 'pointer',
                    fontWeight: sendAccount === acct ? 600 : 400,
                  }}
                >
                  {acct}
                </button>
              ))}
            </div>
          </div>

          {/* Email preview */}
          <div style={{ background: '#17141C', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#766D62', marginBottom: 4 }}>To: <span style={{ color: '#FBF5EC' }}>{pendingSend.recipientName} &lt;{pendingSend.recipientEmail}&gt;</span></div>
            <div style={{ fontSize: 12, color: '#766D62', marginBottom: 8 }}>Subject: <span style={{ color: '#FBF5EC' }}>{pendingSend.subject}</span></div>
            <div style={{ fontSize: 12, color: '#9B9BAB', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 200, overflowY: 'auto' }}>{pendingSend.body}</div>
          </div>

          {sendError && (
            <div style={{ background: 'rgba(212,100,92,0.12)', border: '1px solid rgba(212,100,92,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#D4645C' }}>
              {sendError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={btnGhost} onClick={() => { setPendingSend(null); setSendError(null); }} disabled={sending}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }}
              onClick={() => confirmSend(pendingSend)}
              disabled={sending}
            >
              {sending ? 'Sending…' : 'Send via Gmail'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Edit message overlay ──────────────────────────────────────────────────────
  if (editingMsg) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#1C1822', borderRadius: 16, padding: 28, maxWidth: 640, width: '100%', border: '1px solid rgba(255,235,210,0.12)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#FBF5EC' }}>Edit Email</div>
          <div>
            <span style={labelStyle}>Subject</span>
            <input style={inputStyle} value={emSubject} onChange={(e) => setEmSubject(e.target.value)} />
          </div>
          <div>
            <span style={labelStyle}>Body</span>
            <textarea
              style={{ ...inputStyle, minHeight: 200, resize: 'vertical' }}
              value={emBody}
              onChange={(e) => setEmBody(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={btnGhost} onClick={() => setEditingMsg(null)}>Cancel</button>
            <button style={btnPrimary} onClick={saveEditedMessage} disabled={emSaving}>
              {emSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 0 }}>

      {/* Campaign list */}
      <div style={{
        width: 260,
        flexShrink: 0,
        borderRight: '1px solid rgba(255,235,210,0.07)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        overflowY: 'auto',
        paddingRight: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0 12px 0' }}>
          <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Campaigns {campaigns.length > 0 && `(${campaigns.length})`}
          </div>
          <button style={btnPrimary} onClick={() => setShowNewCampaign((v) => !v)}>+ New</button>
        </div>

        {/* New campaign form */}
        {showNewCampaign && (
          <div style={{ background: '#221E2A', borderRadius: 10, padding: 14, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={labelStyle}>Name</span>
              <input style={inputStyle} placeholder="e.g. AI Policy Spring 2026" value={ncName} onChange={(e) => setNcName(e.target.value)} />
            </div>
            <div>
              <span style={labelStyle}>Goal</span>
              <select style={inputStyle} value={ncGoal} onChange={(e) => setNcGoal(e.target.value)}>
                <option value="fellowship referral">Fellowship referral</option>
                <option value="job referral">Job referral</option>
                <option value="informational">Informational</option>
                <option value="research collaboration">Research collaboration</option>
                <option value="mentorship">Mentorship</option>
              </select>
            </div>
            <div>
              <span style={labelStyle}>Target Org</span>
              <input style={inputStyle} placeholder="Optional" value={ncOrg} onChange={(e) => setNcOrg(e.target.value)} />
            </div>
            <div>
              <span style={labelStyle}>Target Role</span>
              <input style={inputStyle} placeholder="Optional" value={ncRole} onChange={(e) => setNcRole(e.target.value)} />
            </div>
            <div>
              <span style={labelStyle}>Notes</span>
              <input style={inputStyle} placeholder="Optional" value={ncNotes} onChange={(e) => setNcNotes(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
              <button style={btnGhost} onClick={() => setShowNewCampaign(false)}>Cancel</button>
              <button style={btnPrimary} onClick={createCampaign} disabled={ncSaving || !ncName.trim()}>
                {ncSaving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', padding: '8px 0' }}>loading…</div>
        )}

        {!loading && campaigns.length === 0 && (
          <div style={{ fontSize: 12, color: '#766D62', padding: '16px 0', lineHeight: 1.6 }}>
            No campaigns yet. Create one to start drafting outreach emails.
          </div>
        )}

        {campaigns.map((c) => {
          const sent    = c.messages.filter((m) => m.status === 'sent' || m.status === 'replied').length;
          const pending = c.messages.filter((m) => m.status === 'draft' || m.status === 'approved').length;
          const isActive = selected?.id === c.id;
          return (
            <div
              key={c.id}
              onClick={() => setSelected(isActive ? null : c)}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                marginBottom: 4,
                cursor: 'pointer',
                background: isActive ? '#221E2A' : 'transparent',
                border: isActive ? '1px solid rgba(126,184,214,0.2)' : '1px solid transparent',
                transition: 'all 120ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: CAMPAIGN_STATUS_COLORS[c.status] ?? '#766D62',
                  flexShrink: 0,
                }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginLeft: 13 }}>
                {c.goal} · {sent} sent{pending > 0 ? ` · ${pending} pending` : ''}
              </div>
            </div>
          );
        })}
      </div>

      {/* Campaign detail */}
      <div style={{ flex: 1, overflowY: 'auto', paddingLeft: 20, minWidth: 0 }}>
        {!selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: '#766D62', fontSize: 13 }}>
            Select a campaign to manage messages
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Campaign header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: '#FBF5EC', marginBottom: 4 }}>{selected.name}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>{selected.goal}</span>
                  {selected.targetOrg && <span style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>· {selected.targetOrg}</span>}
                  {selected.targetRole && <span style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>· {selected.targetRole}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {/* Status selector */}
                <select
                  value={selected.status}
                  onChange={(e) => setCampaignStatus(selected, e.target.value)}
                  style={{ ...inputStyle, width: 'auto', fontSize: 11, padding: '4px 8px', fontFamily: 'var(--font-jetbrains-mono)' }}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="done">Done</option>
                </select>
                <button
                  style={{ ...btnGhost, color: '#D4645C', borderColor: 'rgba(212,100,92,0.3)', fontSize: 11, padding: '4px 8px' }}
                  onClick={() => { if (confirm(`Delete campaign "${selected.name}"?`)) deleteCampaign(selected); }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Add message */}
            <div>
              <button
                style={btnPrimary}
                onClick={() => setShowNewMessage((v) => !v)}
              >
                + Add Target
              </button>
            </div>

            {showNewMessage && (
              <div style={{ background: '#221E2A', borderRadius: 12, padding: 16, border: '1px solid rgba(255,235,210,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC' }}>New Outreach Email</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <span style={labelStyle}>Name *</span>
                    <input style={inputStyle} placeholder="Jane Doe" value={nmName} onChange={(e) => setNmName(e.target.value)} />
                  </div>
                  <div>
                    <span style={labelStyle}>Email *</span>
                    <input style={inputStyle} placeholder="jane@org.com" type="email" value={nmEmail} onChange={(e) => setNmEmail(e.target.value)} />
                  </div>
                  <div>
                    <span style={labelStyle}>Title</span>
                    <input style={inputStyle} placeholder="Program Director" value={nmTitle} onChange={(e) => setNmTitle(e.target.value)} />
                  </div>
                  <div>
                    <span style={labelStyle}>Organization</span>
                    <input style={inputStyle} placeholder="RAND Corporation" value={nmOrg} onChange={(e) => setNmOrg(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    style={{ ...btnGhost, fontSize: 11, color: '#B8A0E8', borderColor: 'rgba(184,160,232,0.3)' }}
                    onClick={autoDraftMessage}
                    disabled={nmDrafting || !nmName.trim() || !nmEmail.trim()}
                  >
                    {nmDrafting ? 'Drafting…' : 'AI Draft'}
                  </button>
                  <span style={{ fontSize: 11, color: '#766D62' }}>or write manually below</span>
                </div>
                <div>
                  <span style={labelStyle}>Subject *</span>
                  <input style={inputStyle} placeholder="Subject line" value={nmSubject} onChange={(e) => setNmSubject(e.target.value)} />
                </div>
                <div>
                  <span style={labelStyle}>Body</span>
                  <textarea
                    style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
                    placeholder="Email body…"
                    value={nmBody}
                    onChange={(e) => setNmBody(e.target.value)}
                  />
                </div>
                <div>
                  <span style={labelStyle}>Notes</span>
                  <input style={inputStyle} placeholder="Optional context" value={nmNotes} onChange={(e) => setNmNotes(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button style={btnGhost} onClick={() => setShowNewMessage(false)}>Cancel</button>
                  <button style={btnPrimary} onClick={saveMessage} disabled={nmSaving || !nmName.trim() || !nmEmail.trim() || !nmSubject.trim()}>
                    {nmSaving ? 'Saving…' : 'Save as Draft'}
                  </button>
                </div>
              </div>
            )}

            {/* Message list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Messages ({selected.messages.length})
              </div>

              {selected.messages.length === 0 && (
                <div style={{ fontSize: 13, color: '#766D62', padding: '12px 0' }}>
                  No messages yet. Add a target above.
                </div>
              )}

              {selected.messages.map((msg) => (
                <div key={msg.id} style={{
                  background: '#221E2A',
                  borderRadius: 10,
                  padding: 14,
                  border: `1px solid ${msg.status === 'replied' ? 'rgba(143,200,154,0.25)' : 'rgba(255,235,210,0.07)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-jetbrains-mono)',
                          background: MSG_STATUS_COLORS[msg.status] ? `${MSG_STATUS_COLORS[msg.status]}22` : 'transparent',
                          color: MSG_STATUS_COLORS[msg.status] ?? '#766D62',
                          border: `1px solid ${MSG_STATUS_COLORS[msg.status] ?? '#766D62'}44`,
                          borderRadius: 4,
                          padding: '2px 6px',
                          flexShrink: 0,
                        }}>
                          {msg.status.toUpperCase()}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {msg.recipientName}
                        </span>
                        {msg.recipientTitle && (
                          <span style={{ fontSize: 12, color: '#766D62' }}>· {msg.recipientTitle}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#7EB8D6', marginBottom: 4 }}>{msg.recipientEmail}</div>
                      <div style={{ fontSize: 12, color: '#9B9BAB', marginBottom: 6 }}>
                        <strong style={{ color: '#FBF5EC' }}>{msg.subject}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: '#766D62', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 80, overflow: 'hidden' }}>
                        {msg.body}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, alignItems: 'flex-end' }}>
                      {msg.status === 'draft' && (
                        <button
                          style={{ ...btnPrimary, fontSize: 11, padding: '4px 10px', background: '#8FC89A', color: '#17141C' }}
                          onClick={() => approveMessage(msg)}
                        >
                          Approve
                        </button>
                      )}
                      {msg.status === 'approved' && (
                        <button
                          style={{ ...btnPrimary, fontSize: 11, padding: '4px 10px' }}
                          onClick={() => setPendingSend(msg)}
                        >
                          Send
                        </button>
                      )}
                      {msg.status === 'sent' && (
                        <button
                          style={{ ...btnGhost, fontSize: 11, padding: '3px 8px', color: '#8FC89A', borderColor: 'rgba(143,200,154,0.3)' }}
                          onClick={() => {
                            fetch(`/api/career/outreach/${msg.campaignId}/messages/${msg.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'replied', repliedAt: new Date().toISOString() }),
                            }).then(() => updateMsgInState(msg.id, msg.campaignId, { status: 'replied', repliedAt: new Date().toISOString() }));
                          }}
                        >
                          Mark Replied
                        </button>
                      )}
                      <button
                        style={{ ...btnGhost, fontSize: 11, padding: '3px 8px' }}
                        onClick={() => {
                          setEmSubject(msg.subject);
                          setEmBody(msg.body);
                          setEditingMsg(msg);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        style={{ ...btnGhost, fontSize: 11, padding: '3px 8px', color: '#D4645C', borderColor: 'rgba(212,100,92,0.25)' }}
                        onClick={() => { if (confirm('Delete this message?')) deleteMessage(msg); }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared file editor ─────────────────────────────────────────────────────────

function FileEditor({
  apiPath,
  filename,
  emptyMsg,
  lang = 'markdown',
}: {
  apiPath: string;
  filename: string;
  emptyMsg: string;
  lang?: string;
}) {
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(apiPath)
      .then((r) => r.json())
      .then((d) => setContent(d.content ?? ''))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiPath]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(apiPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error('Save failed');
      setContent(draft);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div style={{ padding: '24px 0', fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>
      loading…
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC', fontFamily: 'var(--font-jetbrains-mono)' }}>
          {filename}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ fontSize: 12, color: '#8FC89A', fontFamily: 'var(--font-jetbrains-mono)' }}>Saved</span>}
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,235,210,0.15)', background: 'transparent', color: '#766D62', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#7EB8D6', color: '#17141C', fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button
              onClick={() => { setDraft(content); setEditing(true); setSaved(false); }}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(126,184,214,0.3)', background: 'transparent', color: '#7EB8D6', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{
            width: '100%',
            flex: 1,
            minHeight: 480,
            background: '#1C1822',
            border: '1px solid rgba(126,184,214,0.3)',
            borderRadius: 10,
            padding: '14px 16px',
            color: '#FBF5EC',
            fontSize: 13,
            fontFamily: lang === 'yaml' ? 'var(--font-jetbrains-mono)' : 'var(--font-jetbrains-mono)',
            lineHeight: 1.6,
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <div style={{
          background: '#1C1822',
          border: '1px solid rgba(255,235,210,0.07)',
          borderRadius: 10,
          padding: '14px 16px',
          minHeight: 200,
          color: content ? '#EADFD0' : '#766D62',
          fontSize: 13,
          fontFamily: 'var(--font-jetbrains-mono)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          overflowY: 'auto',
          maxHeight: 520,
        }}>
          {content || emptyMsg}
        </div>
      )}
    </div>
  );
}

// ── Materials tab ──────────────────────────────────────────────────────────────

type MaterialsSubTab = 'cv' | 'linkedin' | 'profile' | 'star-stories' | 'network' | 'resume';

function MaterialsTab() {
  const [sub, setSub] = useState<MaterialsSubTab>('cv');

  const subTabs: { id: MaterialsSubTab; label: string }[] = [
    { id: 'cv',           label: 'CV / Resume' },
    { id: 'linkedin',     label: 'LinkedIn' },
    { id: 'profile',      label: 'Profile & Archetypes' },
    { id: 'star-stories', label: 'STAR Stories' },
    { id: 'network',      label: 'Network' },
    { id: 'resume',       label: 'Living Resume' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid rgba(255,235,210,0.07)', overflowX: 'auto', flexShrink: 0 }}>
        {subTabs.map((t) => {
          const isActive = t.id === sub;
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              style={{
                padding: '6px 14px',
                border: 'none',
                borderBottom: isActive ? '2px solid #7EB8D6' : '2px solid transparent',
                background: 'transparent',
                color: isActive ? '#7EB8D6' : '#766D62',
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                fontFamily: 'var(--font-jetbrains-mono)',
                transition: 'all 150ms ease',
                marginBottom: -1,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {sub === 'cv' && (
        <FileEditor
          apiPath="/api/career/materials/cv"
          filename="cv.md"
          emptyMsg="No cv.md found at career-ops/cv.md — create one to get started."
        />
      )}

      {sub === 'linkedin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(126,184,214,0.08)', border: '1px solid rgba(126,184,214,0.18)', color: '#A8D4E8', fontSize: 12, lineHeight: 1.5 }}>
            Paste your LinkedIn About, Experience, and Skills sections below. Use this to track how your LinkedIn narrative differs from your CV and keep them in sync.
          </div>
          <FileEditor
            apiPath="/api/career/materials/linkedin"
            filename="linkedin.md"
            emptyMsg="Paste your LinkedIn profile text here to track it alongside your CV."
          />
        </div>
      )}

      {sub === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(232,184,122,0.08)', border: '1px solid rgba(232,184,122,0.18)', color: '#C8A87A', fontSize: 12, lineHeight: 1.5 }}>
            Raw YAML profile — contains narrative, archetypes, proof points, compensation, and target roles. Career-ops reads this on every scan and evaluation.
          </div>
          <FileEditor
            apiPath="/api/career/materials/profile"
            filename="config/profile.yml"
            emptyMsg="No profile.yml found at career-ops/config/profile.yml."
            lang="yaml"
          />
        </div>
      )}

      {sub === 'star-stories' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(143,200,154,0.08)', border: '1px solid rgba(143,200,154,0.18)', color: '#8FC89A', fontSize: 12, lineHeight: 1.5 }}>
            STAR interview stories — Situation, Task, Action, Result. One story per header. These are injected into Claude evaluations and interview prep.
          </div>
          <FileEditor
            apiPath="/api/career/materials/star-stories"
            filename="data/star-stories.md"
            emptyMsg={'No STAR stories yet. Start with:\n\n## Microsoft AI Reviewer Agent\n**Situation:** ...\n**Task:** ...\n**Action:** ...\n**Result:** ...'}
          />
        </div>
      )}

      {sub === 'network' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <NetworkView />
        </div>
      )}

      {sub === 'resume' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <LivingResume />
        </div>
      )}
    </div>
  );
}

// ── Suggestions tab ────────────────────────────────────────────────────────────

interface CareerSuggestion {
  id: string;
  category: string; // skill | network | content | application | research
  title: string;
  body: string;
  priority: string; // high | medium | low
  status: string;   // open | done | dismissed
  weekOf: string;
  actionLabel?: string | null;
  createdAt: string;
}

const SUGG_CAT_COLORS: Record<string, string> = {
  skill:       '#7EB8D6',
  network:     '#E8B87A',
  content:     '#B8A0E8',
  application: '#8FC89A',
  research:    '#D4645C',
};

function SuggestionsTab() {
  const [suggestions, setSuggestions] = useState<CareerSuggestion[]>([]);
  const [loading, setLoading]         = useState(true);
  const [generating, setGenerating]   = useState(false);
  const [showDone, setShowDone]       = useState(false);
  const [weekOf, setWeekOf]           = useState('');

  const load = useCallback(async (includeDone = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/career/suggestions${includeDone ? '?all=true' : ''}`);
      const data = await res.json() as { suggestions: CareerSuggestion[]; weekOf: string };
      setSuggestions(data.suggestions ?? []);
      setWeekOf(data.weekOf ?? '');
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(showDone); }, [showDone]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch('/api/career/suggestions/generate', { method: 'POST' });
      const data = await res.json() as { suggestions: CareerSuggestion[] };
      setSuggestions(data.suggestions ?? []);
    } catch { /* silent */ }
    finally { setGenerating(false); }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await fetch(`/api/career/suggestions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setSuggestions((prev) =>
        showDone ? prev.map((s) => s.id === id ? { ...s, status } : s)
                 : prev.filter((s) => s.id !== id)
      );
    } catch { /* silent */ }
  }

  const byCategory = ['skill', 'network', 'content', 'application', 'research'].reduce<Record<string, CareerSuggestion[]>>((acc, cat) => {
    acc[cat] = suggestions.filter((s) => s.category === cat);
    return acc;
  }, {});

  const activeCats = Object.entries(byCategory).filter(([, items]) => items.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC' }}>Weekly Career Suggestions</div>
          {weekOf && (
            <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginTop: 2 }}>
              Week {weekOf}
            </div>
          )}
        </div>
        <button
          style={{ fontSize: 11, color: showDone ? '#7EB8D6' : '#766D62', background: 'transparent', border: '1px solid rgba(255,235,210,0.10)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? 'Hide done' : 'Show done'}
        </button>
        <button
          style={{ background: '#B8A0E8', color: '#17141C', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
          onClick={generate}
          disabled={generating}
        >
          {generating ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>loading…</div>
      )}

      {!loading && suggestions.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 10, color: '#766D62' }}>
          <div style={{ fontSize: 13 }}>No suggestions yet for this week.</div>
          <div style={{ fontSize: 12 }}>Hit Generate to get Claude-curated career moves.</div>
        </div>
      )}

      {activeCats.map(([cat, items]) => (
        <div key={cat}>
          <div style={{ fontSize: 11, color: SUGG_CAT_COLORS[cat] ?? '#766D62', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            {cat}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {items.map((s) => (
              <div
                key={s.id}
                style={{
                  background: '#1C1822',
                  border: `1px solid ${s.status === 'done' ? 'rgba(143,200,154,0.15)' : 'rgba(255,235,210,0.07)'}`,
                  borderRadius: 12,
                  padding: '14px 16px',
                  opacity: s.status === 'dismissed' ? 0.45 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: s.status === 'done' ? '#766D62' : '#FBF5EC', textDecoration: s.status === 'done' ? 'line-through' : 'none', marginBottom: 5, lineHeight: 1.4 }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 12, color: '#766D62', lineHeight: 1.6 }}>{s.body}</div>
                  </div>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                    background: s.priority === 'high' ? '#D4645C' : s.priority === 'medium' ? '#E8B87A' : '#766D62',
                  }} />
                </div>
                {s.actionLabel && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: 'var(--font-jetbrains-mono)',
                    color: SUGG_CAT_COLORS[s.category] ?? '#7EB8D6',
                    background: `${SUGG_CAT_COLORS[s.category] ?? '#7EB8D6'}18`,
                    border: `1px solid ${SUGG_CAT_COLORS[s.category] ?? '#7EB8D6'}30`,
                    borderRadius: 6,
                    padding: '3px 8px',
                    letterSpacing: '0.04em',
                    alignSelf: 'flex-start',
                  }}>
                    → {s.actionLabel}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {s.status === 'open' && (
                    <>
                      <button
                        style={{ fontSize: 10, background: 'transparent', border: '1px solid rgba(255,235,210,0.10)', borderRadius: 6, padding: '3px 8px', color: '#766D62', cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
                        onClick={() => updateStatus(s.id, 'dismissed')}
                      >
                        Dismiss
                      </button>
                      <button
                        style={{ fontSize: 10, background: 'rgba(143,200,154,0.15)', border: '1px solid rgba(143,200,154,0.25)', borderRadius: 6, padding: '3px 8px', color: '#8FC89A', cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
                        onClick={() => updateStatus(s.id, 'done')}
                      >
                        Done
                      </button>
                    </>
                  )}
                  {s.status === 'done' && (
                    <button
                      style={{ fontSize: 10, background: 'transparent', border: '1px solid rgba(255,235,210,0.10)', borderRadius: 6, padding: '3px 8px', color: '#766D62', cursor: 'pointer', fontFamily: 'var(--font-jetbrains-mono)' }}
                      onClick={() => updateStatus(s.id, 'open')}
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────

const TABS: { id: CareerTab; label: string }[] = [
  { id: 'dashboard',     label: 'Dashboard' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'pipeline',      label: 'Pipeline' },
  { id: 'outreach',      label: 'Outreach' },
  { id: 'materials',     label: 'Materials' },
  { id: 'connections',   label: 'Connections' },
  { id: 'suggestions',   label: 'Suggestions' },
  { id: 'resume',        label: 'Resume Studio' },
];

const VALID_TABS = new Set<CareerTab>(TABS.map((t) => t.id));

const TAB_TO_PATH: Record<CareerTab, string> = {
  dashboard:     '/career',
  opportunities: '/career/opportunities',
  pipeline:      '/career/pipeline',
  outreach:      '/career/outreach',
  materials:     '/career/materials',
  connections:   '/career/connections',
  suggestions:   '/career/suggestions',
  resume:        '/career/resume',
};

function readTabFromUrl(): CareerTab {
  if (typeof window === 'undefined') return 'dashboard';
  const params = new URLSearchParams(window.location.search);
  const t = params.get('tab') as CareerTab | null;
  return t && VALID_TABS.has(t) ? t : 'dashboard';
}

export default function CareerView({ initialTab, routerNav }: { initialTab?: CareerTab; routerNav?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const isCareerRoute = pathname?.startsWith('/career') ?? false;
  const useRouterNav = routerNav ?? isCareerRoute;

  const [tab, setTab] = useState<CareerTab>(() => initialTab ?? readTabFromUrl());
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/career/stats');
      const statsData = await res.json();
      setStats(statsData);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Sync tab → URL (SPA mode only — router mode lets Next.js own the URL)
  useEffect(() => {
    if (useRouterNav) return;
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    params.set('view', 'career');
    window.history.pushState({}, '', `?${params.toString()}`);
  }, [tab, useRouterNav]);

  useEffect(() => {
    if (useRouterNav) return;
    function onPop() {
      const t = readTabFromUrl();
      setTab(t);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [useRouterNav]);

  // Sync tab state with initialTab prop in router-nav mode.
  // Why: Next.js App Router reuses the CareerView instance across sibling
  // sub-routes (every /career/*/page.tsx renders <CareerView /> at the same
  // tree position), so useState's initializer doesn't re-fire on route change.
  // Without this effect, the previous tab's content + modal stick around.
  useEffect(() => {
    if (useRouterNav && initialTab && initialTab !== tab) {
      setTab(initialTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, useRouterNav]);

  function navigate(t: CareerTab) {
    // Update local tab state synchronously in BOTH modes. In router-nav mode the
    // existing initialTab→tab useEffect was supposed to handle this on the next
    // render, but the route transition can defer that update long enough that
    // PipelineTab stays mounted with its open modalCard — which is what the user
    // sees as "the modal stays visible after switching tabs". Setting tab here
    // unmounts PipelineTab immediately, destroying its local modalCard state.
    setTab(t);
    if (useRouterNav) {
      router.push(TAB_TO_PATH[t]);
    }
  }


  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#17141C',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px 0',
        borderBottom: '1px solid rgba(255,235,210,0.07)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#FBF5EC' }}>Career</h1>
          {loading && (
            <span style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>loading…</span>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0 }}>
          {TABS.map((t) => {
            const isActive = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => navigate(t.id)}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderBottom: isActive ? '2px solid #7EB8D6' : '2px solid transparent',
                  background: 'transparent',
                  color: isActive ? '#7EB8D6' : '#766D62',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-jetbrains-mono)',
                  transition: 'all 150ms ease',
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {tab === 'dashboard'     && <DashboardTab stats={stats} onNavigate={navigate} />}
        {tab === 'opportunities' && <OpportunitiesTab />}
        {tab === 'pipeline'      && <PipelineTab />}
        {tab === 'outreach'      && <OutreachTab />}
        {tab === 'materials'     && <MaterialsTab />}
        {tab === 'connections'   && <NetworkView />}
        {tab === 'suggestions'   && <SuggestionsTab />}
        {tab === 'resume'        && <ResumeStudio />}
      </div>
    </div>
  );
}
