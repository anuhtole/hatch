'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import BriefingModule from './BriefingModule';
import AssignmentsModule from './AssignmentsModule';
import StocksModule from './StocksModule';
import TrackersModule from './TrackersModule';
import TodoModule from './TodoModule';
import { FEATURES, ANY_RAIL_MODULE_ENABLED } from '@/lib/feature-flags';
import DraftInlineCard from '../chat/DraftInlineCard';
import PendingActionCard from '../chat/PendingActionCard';
import ArtifactCard from '../chat/ArtifactCard';
import DiscoveryCard from '../chat/DiscoveryCard';
import EmptyHero from '@/components/shell/EmptyHero';
import { useLayout } from '@/lib/layout-context';
import { useLiveData } from '@/lib/swr-config';

// ── Types (moved to lib/chat-context to keep chat state above route boundary) ─

import {
  useChat,
  type Segment,
  type TextSegment,
  type ToolSegment,
  type DraftSegment,
  type PendingActionSegment,
  type ArtifactSegment,
  type DiscoverySegment,
  type ChatMessage,
  type ConvSummary,
  type ContextLayerReport,
  type ContextLayerName,
} from '@/lib/chat-context';

// ── Streaming markdown (live render during stream, with safe-tail mitigation) ─

/** Pads partial markdown so an in-flight unclosed code fence / inline-code
 *  span doesn't make the rest of the message render as raw text. The closer
 *  is added for render only; the underlying stored text is unchanged. */
function safeStreamingMarkdown(text: string): string {
  let out = text;
  // Triple-backtick code fences. If odd count, append a synthetic closer.
  const fenceMatches = out.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 !== 0) out += '\n```';
  // Inline backticks — count single backticks OUTSIDE fenced blocks so an
  // open code fence's content backticks don't trip this heuristic.
  const withoutFences = out.replace(/```[\s\S]*?```/g, '');
  const inlineMatches = withoutFences.match(/`/g);
  if (inlineMatches && inlineMatches.length % 2 !== 0) out += '`';
  return out;
}

function StreamingMarkdown({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const safe = isStreaming ? safeStreamingMarkdown(content) : content;
  return (
    <div className="md-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: D.accent, fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: '2px' }}
            >
              {children}
            </a>
          ),
        }}
      >
        {safe}
      </ReactMarkdown>
      {isStreaming && (
        <span
          style={{
            display: 'inline-block', width: 2, height: 14,
            background: D.accent, marginLeft: 2, verticalAlign: 'text-bottom',
          }}
          className="animate-blink"
        />
      )}
    </div>
  );
}

// ── Animated message wrapper (RAF-gated entrance) ─────────────────────────────

function AnimatedMessage({ role, isNew, children }: {
  role: 'user' | 'assistant'; isNew: boolean; children: React.ReactNode;
}) {
  const [entered, setEntered] = useState(!isNew);
  useEffect(() => {
    if (!isNew) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const xOffset = role === 'user' ? 16 : -16;
  return (
    <div style={{
      opacity:    entered ? 1 : 0,
      transform:  entered ? 'translateX(0)' : `translateX(${xOffset}px)`,
      transition: isNew
        ? 'opacity 300ms cubic-bezier(0.16,1,0.3,1), transform 300ms cubic-bezier(0.16,1,0.3,1)'
        : 'none',
    }}>
      {children}
    </div>
  );
}

// ── Notion-pivot palette ─────────────────────────────────────────────────────
// Same key set as the prior Warm-Dusk constants so every existing inline
// style reference (D.bg, D.ink, D.accent, …) flips to the new light theme
// without touching call sites. Keys retain their original semantic role:
//   bg/paper/card/cardHi → backgrounds, light→lighter
//   line/line2 → hairlines, faint→stronger
//   ink/body/dim/mute → text, primary→tertiary
//   accent/amber → accents, blue (default) / warm (Deep mode)
const D = {
  bg:         '#FAFAF9',
  paper:      '#FAFAF9',
  card:       '#FCFCFB',
  cardHi:     '#F4F3F0',
  line:       '#E8E6E1',
  line2:      '#DEDCD6',
  ink:        '#1F1F1F',
  body:       '#1F1F1F',
  dim:        '#6B6B6B',
  mute:       '#9B9BAB',
  accent:     '#3A5A9F',
  accentSoft: '#EAEFF8',
  amber:      '#B2860D',
  amberSoft:  '#F5EAD3',
  userBubble: '#E8A35C',

  red:        '#B23A2E',
  green:      '#4B7A52',
  serif:      'Georgia, "Times New Roman", serif',
  sans:       'Inter, system-ui, sans-serif',
  mono:       'JetBrains Mono, ui-monospace, Menlo, monospace',
};

// ── Clock helpers ─────────────────────────────────────────────────────────────

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    // Align to next 30s boundary
    const ms = 30000 - (Date.now() % 30000);
    const first = setTimeout(() => { tick(); const id = setInterval(tick, 30000); return () => clearInterval(id); }, ms);
    return () => clearTimeout(first);
  }, []);
  return now;
}

function formatHeaderDate(d: Date): string {
  const day  = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  const mon  = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const date = d.getDate();
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${ampm} · ${mon} ${date} · ${time}`;
}

// ── Paper grain overlay ───────────────────────────────────────────────────────

function PaperGrain() {
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0, opacity: 0.5, mixBlendMode: 'overlay' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  );
}

// ── Chevron icon (for column toggles) ────────────────────────────────────────

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return direction === 'left' ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

// ── Tool execution group (collapsible pill) ───────────────────────────────────

function ToolExecutionGroup({ segments, loading }: { segments: ToolSegment[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (segments.length === 0) return null;

  const lastLabel = segments[segments.length - 1].label;
  const summaryLabel = loading
    ? `Thinking — ${lastLabel}…`
    : `Checked ${segments.length} source${segments.length !== 1 ? 's' : ''}`;

  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={() => !loading && setExpanded((e) => !e)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: D.card,
          border: `1px solid ${D.line2}`,
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 11,
          color: D.dim,
          fontFamily: D.mono,
          cursor: loading ? 'default' : 'pointer',
          outline: 'none',
          userSelect: 'none',
        }}
      >
        <span style={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
          background: loading ? D.accent : D.amber,
        }} />
        {summaryLabel}
        {!loading && (
          <span style={{ marginLeft: 2, fontSize: 9, opacity: 0.5 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </button>

      {expanded && !loading && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 10 }}>
          {segments.map((s) => (
            <div key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: D.dim, fontFamily: D.mono }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: D.amber, opacity: 0.6, flexShrink: 0, display: 'inline-block' }} />
              {s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Context-status pill (retrieval health) ────────────────────────────────────
// Audit risk #2 — turns the prior silent-fail try/catch wall into a small
// pill under the assistant message. Hover shows each layer's status, item
// count, and duration. Click pins it open.

const LAYER_LABEL: Record<ContextLayerName, string> = {
  vault:         'vault',
  memory:        'memory',
  legacy_memory: 'legacy memory',
  project:       'project',
  knowledge:     'knowledge',
  canvas_gmail:  'canvas/gmail',
};

function describeLayer(layer: ContextLayerReport): string {
  const dur = `${layer.durationMs}ms`;
  switch (layer.status) {
    case 'fetched': {
      const n = layer.itemCount ?? 0;
      const noun = n === 1 ? 'item' : 'items';
      return `fetched (${n} ${noun}, ${dur})`;
    }
    case 'empty':   return `empty (${dur})`;
    case 'error':   return `error${layer.error ? `: ${layer.error}` : ''} (${dur})`;
    case 'skipped': return `skipped`;
  }
}

function ContextStatusPill({ layers }: { layers: ContextLayerReport[] }) {
  const [pinned, setPinned] = useState(false);
  const [hover,  setHover]  = useState(false);
  const expanded = pinned || hover;

  if (!layers || layers.length === 0) return null;

  const hasError = layers.some((l) => l.status === 'error');
  const hasEmpty = layers.some((l) => l.status === 'empty');
  const allFetched = layers.every((l) => l.status === 'fetched');

  // Avoid noise — only render when ALL fetched (positive signal) OR when
  // there's a degraded state worth flagging (error / partial).
  if (!allFetched && !hasError && !hasEmpty) return null;

  const tone: 'ok' | 'warn' = allFetched ? 'ok' : 'warn';
  const label = allFetched ? 'All context loaded' : 'Partial context';

  return (
    <div
      className={`sb-ctx-pill ${tone}${expanded ? ' open' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); setPinned((p) => !p); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned((p) => !p); } }}
      aria-expanded={expanded}
      aria-label={`Retrieval health — ${label}`}
    >
      <span className={`sb-ctx-dot ${tone}`} />
      <span className="sb-ctx-label">{allFetched ? '✓ ' : '⚠ '}{label}</span>
      {expanded && (
        <div className="sb-ctx-panel" onClick={(e) => e.stopPropagation()}>
          {layers.map((l) => (
            <div key={l.name} className={`sb-ctx-row ${l.status}`}>
              <span className="sb-ctx-row-name">{LAYER_LABEL[l.name]}</span>
              <span className="sb-ctx-row-desc">{describeLayer(l)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  // Defensive: a loaded conversation might have messages whose `segments`
  // field hasn't been populated by the server normalizer yet (legacy data
  // path). Treat absent segments as empty so the entire chat tree doesn't
  // crash on a single old row.
  const segments = msg?.segments ?? [];
  const textContent = segments
    .filter((s): s is TextSegment => s.type === 'text')
    .map((s) => s.content)
    .join('');

  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      {!isUser && (
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: D.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: 11,
          fontFamily: D.mono,
          flexShrink: 0,
          marginTop: 2,
          boxShadow: '0 0 12px rgba(126,184,214,0.3)',
        }}>H</div>
      )}

      <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        {/* Tool execution group */}
        <ToolExecutionGroup
          segments={segments.filter((s): s is ToolSegment => s.type === 'tool_call')}
          loading={msg.loading}
        />

        {/* Draft cards */}
        {segments.filter((s) => s.type === 'draft').map((s) => {
          const d = s as DraftSegment;
          return (
            <DraftInlineCard
              key={d.id}
              draftId={d.id}
              initialTo={d.to}
              initialSubject={d.subject}
              initialStatus={d.status}
              sentAt={d.sentAt ?? null}
              fromHistory={d.fromHistory ?? false}
            />
          );
        })}

        {/* Pending-action approval cards (confirmation gate for write tools) */}
        {segments.filter((s) => s.type === 'pending_action').map((s) => {
          const p = s as PendingActionSegment;
          return (
            <PendingActionCard
              key={p.id}
              actionId={p.id}
              actionType={p.actionType}
              summary={p.summary}
            />
          );
        })}

        {/* B-13: verified resume artifact cards (display-only; hash-verified) */}
        {segments.filter((s) => s.type === 'artifact').map((s, i) => {
          const a = s as ArtifactSegment;
          return <ArtifactCard key={`${a.target}-${a.sha256}-${i}`} seg={a} />;
        })}

        {/* B-13: lab discovery shortlist cards (published pages, cited, verbatim contacts) */}
        {segments.filter((s) => s.type === 'discovery').map((s, i) => {
          const d = s as DiscoverySegment;
          return <DiscoveryCard key={`${d.lab}-${d.generatedAt}-${i}`} seg={d} />;
        })}

        {/* Text */}
        {(textContent || msg.loading) && (
          <div style={{
            // Assistant text renders borderless/inline (clean chat content);
            // only the user bubble keeps its softer amber shaded container.
            background: isUser ? D.userBubble : 'transparent',
            color: isUser ? '#17141C' : D.body,
            borderRadius: isUser ? '16px 16px 4px 16px' : 0,
            padding: isUser ? '10px 14px' : '2px 0',
            fontSize: 13,
            lineHeight: 1.6,
            fontFamily: 'inherit',
            boxShadow: isUser ? `0 0 16px rgba(232,184,122,0.2)` : 'none',
            border: 'none',
          }}>
            {msg.loading && !textContent ? (
              <span>
                <span className="thinking-dot" style={{ color: D.accent }} />
                <span className="thinking-dot" style={{ color: D.accent, animationDelay: '0.2s' }} />
                <span className="thinking-dot" style={{ color: D.accent, animationDelay: '0.4s' }} />
              </span>
            ) : (
              <StreamingMarkdown content={textContent} isStreaming={msg.loading && !!textContent} />
            )}
          </div>
        )}

        {/* Retrieval-health pill (assistant turns only) */}
        {!isUser && msg.contextStatus && msg.contextStatus.length > 0 && (
          <ContextStatusPill layers={msg.contextStatus} />
        )}
      </div>
    </div>
  );
}

// ── Landing state ─────────────────────────────────────────────────────────────
// Hero now lives in components/shell/EmptyHero.tsx (Phase 2 redesign).

// ── Ingestion modal ───────────────────────────────────────────────────────────

type PendingFileShape = {
  docId: string; filename: string; mimeType: string; size: number;
  extractedText: string; wordCount: number; pageCount?: number; method: string;
  summary: string; tags: string[];
};

function IngestionModal({
  file, onConfirm, onCancel,
}: {
  file: PendingFileShape;
  onConfirm: (summary: string, tags: string[]) => Promise<void>;
  onCancel:  () => void;
}) {
  const [summary, setSummary] = useState(file.summary);
  const [tagInput, setTagInput] = useState(file.tags.join(', '));
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    await onConfirm(summary, tags);
    setSaving(false);
  }

  const fmtSize = (n: number) => n < 1024 * 1024
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(23,20,28,0.8)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: D.paper, border: `1px solid ${D.line2}`,
        borderRadius: 16, width: 520, maxWidth: '90vw', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 20 }}>📄</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: D.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file.filename}
            </div>
            <div style={{ fontSize: 10, color: D.mute, fontFamily: D.mono, marginTop: 2 }}>
              {fmtSize(file.size)} · {file.wordCount.toLocaleString()} words
              {file.pageCount ? ` · ${file.pageCount} pages` : ''}
              {' · '}{file.method}
            </div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: D.mute, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Summary */}
          <div>
            <div style={{ fontSize: 10, color: D.mute, fontFamily: D.mono, letterSpacing: '0.08em', marginBottom: 6 }}>SUMMARY</div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              style={{
                width: '100%', background: D.card, border: `1px solid ${D.line2}`,
                borderRadius: 8, padding: '8px 10px', fontSize: 12,
                color: D.body, fontFamily: 'inherit', resize: 'vertical',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          {/* Tags */}
          <div>
            <div style={{ fontSize: 10, color: D.mute, fontFamily: D.mono, letterSpacing: '0.08em', marginBottom: 6 }}>TAGS (comma-separated)</div>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              style={{
                width: '100%', background: D.card, border: `1px solid ${D.line2}`,
                borderRadius: 8, padding: '8px 10px', fontSize: 12,
                color: D.body, fontFamily: D.mono, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          {/* Preview */}
          {file.extractedText && (
            <div>
              <div style={{ fontSize: 10, color: D.mute, fontFamily: D.mono, letterSpacing: '0.08em', marginBottom: 6 }}>TEXT PREVIEW</div>
              <div style={{
                background: D.card, borderRadius: 8, padding: '8px 10px',
                fontSize: 11, color: D.dim, fontFamily: D.mono,
                whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto',
                lineHeight: 1.5,
              }}>
                {file.extractedText.slice(0, 600)}{file.extractedText.length > 600 ? '…' : ''}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${D.line}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '7px 16px', borderRadius: 8, border: `1px solid ${D.line2}`,
            background: 'none', color: D.dim, cursor: 'pointer', fontSize: 12,
          }}>Cancel</button>
          <button onClick={confirm} disabled={saving} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none',
            background: D.accent, color: '#17141C', cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 12, fontWeight: 600, opacity: saving ? 0.7 : 1,
          }}>{saving ? 'Saving…' : 'Add to knowledge base'}</button>
        </div>
      </div>
    </div>
  );
}

// ── HomeView ──────────────────────────────────────────────────────────────────

export default function HomeView({ onNavigateToCareer }: { onNavigateToCareer?: (tab?: string) => void }) {
  const now = useNow();
  // Chat state lives in ChatProvider so streams survive route navigation.
  const {
    messages, setMessages,
    streaming,
    conversationId, setConversationId,
    conversations, setConversations,
    sendMessage: ctxSendMessage,
  } = useChat();
  const [input, setInput] = useState('');
  const convsSwrInitRef = useRef(false);
  const { data: convsData, isLoading: convLoading } = useLiveData<{ conversations: ConvSummary[] }>('/api/conversations');
  const { data: todosSwrData } = useLiveData<{ todos: { completed: boolean }[] }>('/api/todos');
  const { data: trackersSwrData } = useLiveData<{ isActive: boolean }[]>('/api/trackers');
  const [hoverConvId, setHoverConvId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [stats, setStats] = useState({ emails: '—', tasks: '—', assignments: '—', trackers: '—' });
  const { leftCollapsed, setLeftCollapsed, rightCollapsed, setRightCollapsed } = useLayout();
  const [briefingModalOpen, setBriefingModalOpen] = useState(false);
  const [trackersModalOpen, setTrackersModalOpen] = useState(false);
  const [assignmentsModalOpen, setAssignmentsModalOpen] = useState(false);
  const anyModalOpen = briefingModalOpen || trackersModalOpen || assignmentsModalOpen;
  const bottomRef         = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newMessageIdsRef  = useRef<Set<string>>(new Set());

  const [stickToBottom,   setStickToBottom]   = useState(true);
  const [isDraggingOver,  setIsDraggingOver]  = useState(false);
  const [convOpacity,     setConvOpacity]     = useState(1);
  type PendingFile = {
    docId: string; filename: string; mimeType: string; size: number;
    extractedText: string; wordCount: number; pageCount?: number; method: string;
    summary: string; tags: string[];
  };
  const [pendingFile,   setPendingFile]   = useState<PendingFile | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Sync modal-open body class for column-toggle CSS hiding
  useEffect(() => {
    if (anyModalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => { document.body.classList.remove('modal-open'); };
  }, [anyModalOpen]);

  // Sync SWR conversations into local state (local state owns optimistic mutations)
  useEffect(() => {
    if (convsData && !convsSwrInitRef.current) {
      convsSwrInitRef.current = true;
      setConversations(convsData.conversations ?? []);
    }
  }, [convsData]);

  // Derive quick stats from SWR data (deduped with TodoModule/TrackersModule fetches)
  useEffect(() => {
    const todos    = todosSwrData?.todos ?? [];
    const trackers = Array.isArray(trackersSwrData) ? trackersSwrData : [];
    if (todos.length > 0 || trackers.length > 0) {
      setStats((s) => ({
        ...s,
        tasks:    String(todos.filter((t) => !t.completed).length),
        trackers: String(trackers.filter((t) => t.isActive).length),
      }));
    }
  }, [todosSwrData, trackersSwrData]);

  // Auto-scroll (direct scrollTop during stream; smooth after)
  useEffect(() => {
    if (!stickToBottom) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const isStreaming = messages.some((m) => m.loading);
    if (isStreaming) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, stickToBottom]);

  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setStickToBottom(nearBottom);
  }

  // Load a past conversation
  async function loadConversation(id: string) {
    newMessageIdsRef.current.clear();
    setConvOpacity(0);
    await new Promise((r) => setTimeout(r, 150));
    const res  = await fetch(`/api/conversations/${id}/messages`);
    const data = await res.json();
    setConversationId(id);
    setMessages(
      (data.messages ?? []).map((m: { id: string; role: 'user' | 'assistant'; segments?: Segment[]; content?: string }) => ({
        id:       m.id,
        role:     m.role,
        // The messages route returns fully-formed segments (text + any
        // persisted draft card). Fall back to a text segment for legacy
        // rows that predate the segment normalizer.
        segments: m.segments ?? [{ type: 'text', content: m.content ?? '' }],
        loading:  false,
      }))
    );
    setConvOpacity(1);
  }

  const sendMessage = useCallback(async (text: string) => {
    if (streaming) return;
    const cleaned = text.trim();
    if (!cleaned) return;
    setInput('');
    setStickToBottom(true);
    await ctxSendMessage(
      cleaned,
      ({ userMsgId, assistantMsgId }) => {
        newMessageIdsRef.current.add(userMsgId);
        newMessageIdsRef.current.add(assistantMsgId);
      },
    );
  }, [streaming, ctxSendMessage]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function autoResize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '1px';
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }

  // Shrink back to single line after send clears the input
  useEffect(() => { autoResize(); }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  function newConversation() {
    newMessageIdsRef.current.clear();
    setConversationId(null);
    setMessages([]);
    inputRef.current?.focus();
  }

  // ── File upload pipeline ───────────────────────────────────────────────────

  async function handleFileUpload(file: File) {
    setUploadingFile(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Upload failed'); return; }

      // Kick off AI analysis
      let summary = '';
      let tags: string[] = [];
      try {
        const ar  = await fetch('/api/knowledge/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: data.extractedText, filename: data.filename }),
        });
        const ad = await ar.json();
        summary = ad.summary ?? '';
        tags    = ad.suggestedTags ?? [];
      } catch { /* non-fatal */ }

      setPendingFile({
        docId: data.id, filename: data.filename, mimeType: data.mimeType,
        size: data.size, extractedText: data.extractedText ?? '',
        wordCount: data.wordCount ?? 0, pageCount: data.pageCount,
        method: data.method ?? '', summary, tags,
      });
    } catch (err) {
      alert('Upload error: ' + String(err));
    } finally {
      setUploadingFile(false);
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!isDraggingOver) setIsDraggingOver(true);
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => setIsDraggingOver(false), 150);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (dragTimeoutRef.current) { clearTimeout(dragTimeoutRef.current); dragTimeoutRef.current = null; }
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  }

  async function handleIngest(summary: string, tags: string[]) {
    if (!pendingFile) return;
    await fetch('/api/knowledge/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: pendingFile.docId, title: pendingFile.filename,
        content: pendingFile.extractedText, summary, tags,
      }),
    });
    setPendingFile(null);
  }

  return (
    <div style={{
      display:    'flex',
      flexDirection: 'column',
      height:     '100%',
      overflow:   'hidden',
      background: 'var(--bg-paper)',
      position:   'relative',
      minWidth:   0,
    }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >

      {/* C1 Notion pivot: the left conversation list and right ambient rail
          have been removed. NotionSidebar at the page level owns conversation
          state; the center column is the only content here.

          Legacy left/right rail + top-bar JSX preserved below behind
          `false &&` so the diff stays readable and the state hooks it used
          stay tree-shake-safe. C-future will delete that dead block. */}
      {false && (
      <>
      {/* ── Left Column (legacy, dead) ───────────────────────────────── */}
      <div style={{
        position:  'relative',
        flexShrink: 0,
        overflow:  'visible',
        zIndex:    10,
      }}>
        {/* Inner clip div: animates width 0↔260 */}
        <div style={{
          width:          leftCollapsed ? 0 : 260,
          height:         '100%',
          overflow:       'hidden',
          display:        'flex',
          flexDirection:  'column',
          background:     D.paper,
          borderRight:    leftCollapsed ? 'none' : `1px solid ${D.line}`,
          transition:     'width 240ms cubic-bezier(0.4,0,0.2,1)',
          position:       'relative',
        }}>
          <PaperGrain />
          {/* Fixed-width content — doesn't squish during animation */}
          <div style={{
            width:         260,
            display:       'flex',
            flexDirection: 'column',
            flex:          1,
            overflow:      'hidden',
            opacity:       leftCollapsed ? 0 : 1,
            transition:    'opacity 200ms ease',
            pointerEvents: leftCollapsed ? 'none' : 'auto',
            position:      'relative',
            zIndex:        1,
          }}>
            {/* Brand header */}
            <div style={{ padding: '16px 16px 10px', borderBottom: `1px solid ${D.line}` }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: D.ink, fontFamily: D.serif, fontStyle: 'italic', lineHeight: 1 }}>Hatch</div>
              <div style={{ fontSize: 9, color: D.mute, fontFamily: D.mono, letterSpacing: '0.1em', marginTop: 3 }}>SECRETARY OF SORTS</div>
            </div>

            {/* Conversations header */}
            <div style={{ padding: '10px 16px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: D.mute, fontFamily: D.mono, letterSpacing: '0.1em' }}>CONVERSATIONS</span>
              <button
                onClick={newConversation}
                style={{
                  width:           20,
                  height:          20,
                  borderRadius:    5,
                  border:          `1px solid ${D.line2}`,
                  background:      D.card,
                  color:           D.dim,
                  cursor:          'pointer',
                  fontSize:        14,
                  fontWeight:      600,
                  display:         'flex',
                  alignItems:      'center',
                  justifyContent:  'center',
                }}
              >+</button>
            </div>

            {/* Conversation list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }} className="thin-scroll">
              {convLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
                  {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 30, borderRadius: 6 }} />)}
                </div>
              ) : conversations.length === 0 ? (
                <div style={{ fontSize: 11, color: D.mute, textAlign: 'center', padding: '16px 8px', fontFamily: D.mono }}>
                  No conversations yet
                </div>
              ) : (() => {
                const starred = conversations.filter((c) => c.favorited);
                const regular = conversations.filter((c) => !c.favorited);

                async function toggleFavorite(e: React.MouseEvent, c: ConvSummary) {
                  e.stopPropagation();
                  const newVal = !c.favorited;
                  setConversations((prev) => prev.map((x) => x.id === c.id ? { ...x, favorited: newVal } : x));
                  await fetch(`/api/conversations/${c.id}`, {
                    method:  'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ favorited: newVal }),
                  });
                }

                async function startRename(e: React.MouseEvent, c: ConvSummary) {
                  e.stopPropagation();
                  setRenameId(c.id);
                  setRenameVal(c.title);
                }

                async function commitRename(id: string) {
                  const val = renameVal.trim() || 'Untitled';
                  setConversations((prev) => prev.map((x) => x.id === id ? { ...x, title: val } : x));
                  setRenameId(null);
                  await fetch(`/api/conversations/${id}`, {
                    method:  'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ title: val }),
                  });
                }

                async function confirmDelete(e: React.MouseEvent, id: string) {
                  e.stopPropagation();
                  if (deleteConfirmId === id) {
                    setConversations((prev) => prev.filter((x) => x.id !== id));
                    setDeleteConfirmId(null);
                    if (conversationId === id) { setConversationId(null); setMessages([]); }
                    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
                  } else {
                    setDeleteConfirmId(id);
                  }
                }

                function renderConv(c: ConvSummary) {
                  const isActive       = conversationId === c.id;
                  const isHovered      = hoverConvId === c.id;
                  const isRenaming     = renameId === c.id;
                  const isDeleteConfirm = deleteConfirmId === c.id;

                  return (
                    <div
                      key={c.id}
                      style={{
                        width:      '100%',
                        padding:    '3px 6px',
                        borderRadius: 6,
                        background: isActive ? D.card : isHovered ? D.cardHi : 'transparent',
                        cursor:     'pointer',
                        display:    'flex',
                        alignItems: 'center',
                        gap:        4,
                        minHeight:  28,
                        transition: 'background 150ms ease',
                        position:   'relative',
                        borderLeft: isActive ? `2px solid ${D.accent}` : '2px solid transparent',
                      }}
                      onClick={() => !isRenaming && loadConversation(c.id)}
                      onMouseEnter={() => setHoverConvId(c.id)}
                      onMouseLeave={() => { setHoverConvId(null); setDeleteConfirmId(null); }}
                    >
                      {/* Star */}
                      <button
                        onClick={(e) => toggleFavorite(e, c)}
                        style={{
                          background: 'none',
                          border:     'none',
                          cursor:     'pointer',
                          padding:    2,
                          flexShrink: 0,
                          color:      c.favorited ? D.amber : isHovered ? D.mute : 'transparent',
                          transition: 'color 150ms ease',
                          display:    'flex',
                          alignItems: 'center',
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill={c.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      </button>

                      {/* Title / rename input */}
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(c.id);
                            if (e.key === 'Escape') setRenameId(null);
                          }}
                          onBlur={() => commitRename(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            flex:       1,
                            fontSize:   11,
                            border:     `1px solid ${D.accent}`,
                            borderRadius: 4,
                            padding:    '1px 4px',
                            outline:    'none',
                            fontFamily: 'inherit',
                            color:      D.ink,
                            background: D.cardHi,
                          }}
                        />
                      ) : (
                        <span style={{
                          flex:         1,
                          fontSize:     11,
                          fontWeight:   500,
                          color:        isActive ? D.ink : D.body,
                          overflow:     'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace:   'nowrap',
                          minWidth:     0,
                        }}>
                          {c.title}
                        </span>
                      )}

                      {/* Hover actions */}
                      {(isHovered || isDeleteConfirm) && !isRenaming && (
                        <>
                          <button
                            onClick={(e) => startRename(e, c)}
                            style={{
                              background: 'none',
                              border:     'none',
                              cursor:     'pointer',
                              padding:    2,
                              flexShrink: 0,
                              color:      D.mute,
                              display:    'flex',
                              alignItems: 'center',
                              transition: 'color 150ms ease',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = D.ink; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = D.mute; }}
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          <button
                            onClick={(e) => confirmDelete(e, c.id)}
                            style={{
                              background: 'none',
                              border:     'none',
                              cursor:     'pointer',
                              padding:    2,
                              flexShrink: 0,
                              color:      isDeleteConfirm ? D.red : D.mute,
                              display:    'flex',
                              alignItems: 'center',
                              fontSize:   isDeleteConfirm ? 9 : undefined,
                              fontFamily: isDeleteConfirm ? D.mono : undefined,
                              transition: 'color 150ms ease',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = D.red; }}
                            onMouseLeave={(e) => { if (!isDeleteConfirm) (e.currentTarget as HTMLElement).style.color = D.mute; }}
                          >
                            {isDeleteConfirm ? '✕?' : (
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14H6L5 6"/>
                                <path d="M10 11v6M14 11v6"/>
                                <path d="M9 6V4h6v2"/>
                              </svg>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  );
                }

                return (
                  <>
                    {starred.length > 0 && (
                      <>
                        <div style={{ fontSize: 8, color: D.mute, fontFamily: D.mono, letterSpacing: '0.1em', padding: '6px 6px 2px' }}>STARRED</div>
                        {starred.map(renderConv)}
                        {regular.length > 0 && <div style={{ height: 1, background: D.line, margin: '4px 6px' }} />}
                      </>
                    )}
                    {regular.map(renderConv)}
                  </>
                );
              })()}
            </div>

            {/* User footer */}
            <div style={{ padding: '10px 14px', borderTop: `1px solid ${D.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width:           26,
                height:          26,
                borderRadius:    8,
                background:      D.amber,
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                color:           '#17141C',
                fontWeight:      700,
                fontSize:        11,
                fontFamily:      D.mono,
                flexShrink:      0,
              }}>A</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: D.body, lineHeight: 1.2 }}>Anatole</div>
                <div style={{ fontSize: 9, color: D.mute, fontFamily: D.mono, letterSpacing: '0.06em' }}>UC BERKELEY</div>
              </div>
            </div>
          </div>
        </div>

      </div>
      </>
      )}

      {/* ── Live chat surface (C1) ─────────────────────────────────────── */}

      {/* Legacy column-toggles + dashboard top-bar — dead in C1. */}
      {false && (
      <>
        <button
          className="column-toggle column-toggle-left"
          onClick={() => setLeftCollapsed((v) => !v)}
          aria-label={leftCollapsed ? 'Expand conversations' : 'Collapse conversations'}
        >
          <ChevronIcon direction={leftCollapsed ? 'right' : 'left'} />
        </button>
        {ANY_RAIL_MODULE_ENABLED && (
          <button
            className="column-toggle column-toggle-right"
            onClick={() => setRightCollapsed((v) => !v)}
            aria-label={rightCollapsed ? 'Expand dashboard' : 'Collapse dashboard'}
          >
            <ChevronIcon direction={rightCollapsed ? 'left' : 'right'} />
          </button>
        )}

        {/* Top bar */}
        <div style={{
          padding:        '10px 18px',
          borderBottom:   `1px solid ${D.line}`,
          background:     D.paper,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          flexShrink:     0,
          position:       'relative',
          zIndex:         1,
        }}>
          {/* Date/time */}
          <div style={{ fontSize: 10, color: D.mute, fontFamily: D.mono, letterSpacing: '0.08em' }}>
            {formatHeaderDate(now)}
          </div>
          {/* Stat badge */}
          <div style={{
            display:        'flex',
            alignItems:     'center',
            gap:            6,
            background:     D.card,
            border:         `1px solid ${D.line}`,
            borderRadius:   20,
            padding:        '4px 10px',
            fontSize:       11,
            fontFamily:     D.mono,
          }}>
            <span style={{ color: D.ink, fontWeight: 600 }}>{stats.tasks}</span>
            <span style={{ color: D.mute }}>tasks</span>
            <span style={{ color: D.line2, margin: '0 2px' }}>·</span>
            <span style={{ color: D.accent, fontWeight: 600 }}>{stats.trackers}</span>
            <span style={{ color: D.mute }}>trackers</span>
          </div>
          {/* Avatar */}
          <div style={{
            width:           30,
            height:          30,
            borderRadius:    9,
            background:      D.amber,
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            color:           '#17141C',
            fontWeight:      700,
            fontSize:        12,
            fontFamily:      D.mono,
            flexShrink:      0,
          }}>A</div>
        </div>
      </>
      )}

      {/* Drop overlay — restyled light theme */}
      {isDraggingOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: 'rgba(250,250,249,0.92)', backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
          border: `2px dashed ${D.accent}`, pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 48 }}>📂</div>
            <div style={{ fontSize: 16, color: D.accent, fontWeight: 600 }}>Drop to add to knowledge base</div>
            <div style={{ fontSize: 12, color: D.mute, fontFamily: D.mono }}>PDF, DOCX, images, spreadsheets, and more</div>
          </div>
        )}

        {/* Jump-to-latest pill */}
        {!stickToBottom && (
          <button
            onClick={() => {
              setStickToBottom(true);
              const el = scrollContainerRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            }}
            style={{
              position: 'absolute', bottom: 80, left: '50%',
              transform: 'translateX(-50%)', zIndex: 30,
              background: D.card, border: `1px solid ${D.line2}`,
              borderRadius: 20, padding: '6px 14px',
              fontSize: 11, color: D.accent, cursor: 'pointer',
              fontFamily: D.mono, display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            }}
          >
            ↓ Jump to latest
          </button>
        )}

        {/* Chat area */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{
            flex:          1,
            overflowY:     'auto',
            display:       'flex',
            flexDirection: 'column',
          }} className="thin-scroll">
          {messages.length === 0 ? (
            <div className="sb-empty">
              <div className="sb-empty-inner">
                <h1 className="sb-hello">
                  {(() => {
                    const h = now.getHours();
                    const word = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
                    return `${word}, Anatole.`;
                  })()}
                </h1>
                <p className="sb-hello-sub">What&apos;s on your mind?</p>
                <div className="sb-pills">
                  <button
                    className="sb-pill"
                    onClick={() => { setInput('Triage my inbox'); sendMessage('Triage my inbox'); }}
                  >
                    Triage my inbox
                  </button>
                  <button
                    className="sb-pill"
                    onClick={() => { setInput("What's on my calendar tomorrow?"); sendMessage("What's on my calendar tomorrow?"); }}
                  >
                    What&apos;s on my calendar tomorrow?
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, opacity: convOpacity, transition: 'opacity 200ms ease' }}>
              {messages.map((msg) => {
                const isNew = newMessageIdsRef.current.has(msg.id);
                return (
                  <AnimatedMessage key={msg.id} role={msg.role} isNew={isNew}>
                    <MessageBubble msg={msg} />
                  </AnimatedMessage>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input bar — Notion-pivot light composer */}
        <div className="sb-composer-wrap">
          <div className="sb-composer">
            <div className="sb-input">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(); }}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything, or start with a thought…"
                rows={1}
                className="chat-textarea"
              />
              {/* Paperclip */}
              <input
                id="hv-file-input"
                type="file"
                accept="*/*"
                style={{ display: 'none' }}
                onChange={handleFileSelected}
                disabled={uploadingFile || !!pendingFile}
              />
              <label
                htmlFor={uploadingFile || !!pendingFile ? undefined : 'hv-file-input'}
                title="Attach a file to knowledge base"
                onMouseEnter={(e) => { if (!uploadingFile && !pendingFile) e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { if (!uploadingFile) e.currentTarget.style.color = 'var(--text-secondary)'; }}
                style={{
                  width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'none',
                  color: uploadingFile ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  cursor: uploadingFile || !!pendingFile ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'color 0.15s', userSelect: 'none',
                  opacity: uploadingFile ? 0.7 : 1,
                }}
              >
                {/* Clean line-style paperclip (lucide-style), thin stroke, no fill */}
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </label>

              <button
                className="sb-send"
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || streaming}
                aria-label="Send"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"/>
                  <polyline points="5 12 12 5 19 12"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

      {/* C1: AmbientPanel right-rail removed. Modules + wrapper preserved
          in git history at HEAD~. Restore by adding a feature flag and
          re-mounting under FEATURES.ANY_RAIL or similar. */}

      {/* Ingestion modal */}
      {pendingFile && (
        <IngestionModal
          file={pendingFile}
          onConfirm={handleIngest}
          onCancel={() => setPendingFile(null)}
        />
      )}
    </div>
  );
}
