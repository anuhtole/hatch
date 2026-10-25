'use client';

import { useState, useRef, useEffect, useCallback, Component, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import ChatHistoryPanel, { ConversationSummary } from './ChatHistoryPanel';
import DraftInlineCard from './chat/DraftInlineCard';
import { IngestionReviewModal, type UploadedFile, type IngestPayload } from './chat/IngestionReviewModal';

// ── Error boundary (catches render crashes in DraftInlineCard) ────────────────

class DraftErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: Error) {
    return { error: err.message };
  }
  componentDidCatch(err: Error, info: { componentStack: string }) {
    console.error('[DraftErrorBoundary] Caught error:', err.message, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(212,100,92,0.12)', border: '1px solid rgba(212,100,92,0.3)', fontSize: 12, color: '#D4645C', fontFamily: 'var(--font-jetbrains-mono)' }}>
          Draft render error: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── useSmoothStream ───────────────────────────────────────────────────────────
//
// Runs a continuous requestAnimationFrame loop while `streaming` is true.
// Each frame reveals Math.ceil(behind / 8) more characters — so it's fast
// when lagging and slows to ~1 char/frame as it catches up.

function useSmoothStream(target: string, streaming: boolean): string {
  const [displayed, setDisplayed] = useState(() => (streaming ? '' : target));
  const ref = useRef({ target, displayed: streaming ? '' : target, rafId: null as number | null });
  // Synchronously update target so the RAF loop always sees the latest value.
  ref.current.target = target;

  useEffect(() => {
    if (!streaming) {
      if (ref.current.rafId !== null) {
        cancelAnimationFrame(ref.current.rafId);
        ref.current.rafId = null;
      }
      // Flush immediately when streaming ends.
      const t = ref.current.target;
      ref.current.displayed = t;
      setDisplayed(t);
      return;
    }

    const tick = () => {
      const t = ref.current.target;
      const d = ref.current.displayed;
      if (d.length < t.length) {
        const behind = t.length - d.length;
        const speed = Math.max(1, Math.min(behind, Math.ceil(behind / 8)));
        const next = t.slice(0, d.length + speed);
        ref.current.displayed = next;
        setDisplayed(next);
      }
      // Always reschedule — new text may arrive on next frames.
      ref.current.rafId = requestAnimationFrame(tick);
    };

    ref.current.rafId = requestAnimationFrame(tick);
    return () => {
      if (ref.current.rafId !== null) {
        cancelAnimationFrame(ref.current.rafId);
        ref.current.rafId = null;
      }
    };
  }, [streaming]);

  return displayed;
}

// ── StreamingMarkdown ─────────────────────────────────────────────────────────
//
// During streaming: plain pre-wrap text only — ReactMarkdown + rehypeHighlight
// are far too expensive to run on every character and cause severe jitter.
// On completion: full markdown renders once.

function StreamingMarkdown({ content, streaming }: { content: string; streaming: boolean }) {
  const displayed = useSmoothStream(content, streaming);

  if (streaming) {
    return (
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {displayed}
        <span
          style={{ display: 'inline-block', width: 2, height: 14, background: '#7EB8D6', marginLeft: 2, verticalAlign: 'text-bottom' }}
          className="animate-blink"
        />
      </div>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {displayed}
    </ReactMarkdown>
  );
}

// ── AnimatedMessage ───────────────────────────────────────────────────────────
//
// CSS animation classes are unreliable when applied at the same render tick as
// element creation — browsers often skip the `from` keyframe. Instead we use
// React-controlled transitions: start invisible on mount, then after one RAF
// (guaranteeing the browser has painted the initial state) transition in.

function AnimatedMessage({
  role,
  isNew,
  isOptimistic,
  children,
}: {
  role: 'user' | 'assistant';
  isNew: boolean;
  isOptimistic: boolean;
  children: React.ReactNode;
}) {
  const [entered, setEntered] = useState(!isNew);

  useEffect(() => {
    if (!isNew) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const xOffset = role === 'user' ? 16 : -16;
  const opacity = !entered ? 0 : isOptimistic ? 0.72 : 1;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: role === 'user' ? 'flex-end' : 'flex-start',
        marginBottom: 18,
        alignItems: 'flex-start',
        gap: 10,
        opacity,
        transform: entered ? 'translateX(0)' : `translateX(${xOffset}px)`,
        transition: isNew
          ? 'opacity 300ms cubic-bezier(0.16,1,0.3,1), transform 300ms cubic-bezier(0.16,1,0.3,1)'
          : 'opacity 0.2s ease',
      }}
    >
      {children}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type AttachmentDetail = {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  pdfPageCount?: number;
  pdfTitle?: string;
  pdfAuthor?: string;
};

type TextSegment  = { type: 'text'; content: string };
type ToolSegment  = { type: 'tool_call'; name: string; label: string };
type DraftSegment = {
  type: 'draft';
  id: string;
  to: string;
  subject: string;
  body: string;
  attachments: string[];
  attachmentDetails: AttachmentDetail[];
};

type Segment = TextSegment | ToolSegment | DraftSegment;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  segments: Segment[];
  loading: boolean;
};

type NdjsonEvent =
  | { t: 'text'; v: string }
  | { t: 'tool_call'; name: string; label: string }
  | { t: 'draft'; id: string; to: string; subject: string; body: string; attachments: string[]; attachmentDetails?: AttachmentDetail[] }
  | { t: 'conv'; id: string; title: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  web_search:            '🌐',
  search_drive:          '📂',
  read_drive_file:       '📄',
  attach_drive_file:     '📎',
  search_emails:         '✉️',
  read_email:            '📧',
  get_email_attachments: '📎',
  draft_email:           '✏️',
  send_email:            '📤',
  forward_email:         '↗️',
  save_memory:           '🧠',
};

const QUICK_ACTIONS = [
  'Check my emails',
  'Upcoming assignments',
  'Draft an email to my professor',
  'Find a file in my Drive',
];

function uid() {
  return Math.random().toString(36).slice(2);
}

function appendText(segments: Segment[], text: string): Segment[] {
  const last = segments[segments.length - 1];
  if (last?.type === 'text') {
    return [...segments.slice(0, -1), { type: 'text', content: last.content + text }];
  }
  return [...segments, { type: 'text', content: text }];
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChatView() {
  const [messages, setMessages]               = useState<ChatMessage[]>([]);
  const [input, setInput]                     = useState('');
  const [loading, setLoading]                 = useState(false);
  const [historyOpen, setHistoryOpen]         = useState(true);
  const [conversations, setConversations]     = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId]       = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [memoryOn, setMemoryOn]               = useState(true);
  // 1d: conversation crossfade — key changes on each switch
  const [fadeKey, setFadeKey]                 = useState(0);
  // 1b: optimistic — track the last sent user msg
  const [lastSentMsgId, setLastSentMsgId]     = useState<string | null>(null);
  // 1e: scroll anchoring
  const [stickToBottom, setStickToBottom]     = useState(true);
  const [showJumpPill, setShowJumpPill]       = useState(false);

  // File ingestion
  const [pendingFile, setPendingFile]         = useState<UploadedFile | null>(null);
  const [uploadingFile, setUploadingFile]     = useState(false);
  const [isDraggingOver, setIsDraggingOver]   = useState(false);
  const dragTimeoutRef                        = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bottomRef          = useRef<HTMLDivElement>(null);
  const currentMsgIdRef    = useRef<string | null>(null);
  const textareaRef        = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 1c: only animate messages that were added in this session, not loaded from history
  const newMessageIdsRef   = useRef<Set<string>>(new Set());

  // ── Fetch conversations ───────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch {}
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ── 1e: Scroll anchoring ──────────────────────────────────────────────────

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    function onScroll() {
      const { scrollTop, scrollHeight, clientHeight } = el!;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setStickToBottom(isAtBottom);
      setShowJumpPill(!isAtBottom);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll only when stuck to bottom — drive the container directly so
  // user scroll events (which set stickToBottom=false) are never overridden.
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

  // ── Auto-resize textarea ──────────────────────────────────────────────────

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Set to 1px (not 'auto') — 'auto' is non-animatable and causes a reflow
    // that snaps the height before the transition can fire.
    ta.style.height = '1px';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, [input]);

  // ── Memory indicator — sync with active conversation ──────────────────────

  useEffect(() => {
    if (activeConvId === null) {
      setMemoryOn(true);
      return;
    }
    const conv = conversations.find((c) => c.id === activeConvId);
    setMemoryOn(conv ? !conv.memoryExcluded : true);
  }, [activeConvId, conversations]);

  async function toggleMemory() {
    const next = !memoryOn;
    setMemoryOn(next);
    if (activeConvId) {
      await fetch(`/api/conversations/${activeConvId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoryExcluded: !next }),
      }).catch(() => {});
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConvId ? { ...c, memoryExcluded: !next } : c))
      );
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'n') { e.preventDefault(); handleNew(); }
      if (meta && e.key === 'b') { e.preventDefault(); setHistoryOpen((v) => !v); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Conversation actions ──────────────────────────────────────────────────

  function handleNew() {
    setActiveConvId(null);
    setMessages([]);
    setInput('');
    setFadeKey((k) => k + 1);
    newMessageIdsRef.current.clear();
    textareaRef.current?.focus();
  }

  async function handleSelect(id: string) {
    if (id === activeConvId) return;
    setFadeKey((k) => k + 1);
    newMessageIdsRef.current.clear();
    setActiveConvId(id);
    setMessages([]);
    setLoadingMessages(true);
    setShowJumpPill(false);
    setStickToBottom(true);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      const data = await res.json();
      const loaded: ChatMessage[] = (data.messages ?? []).map(
        (m: { id: string; role: 'user' | 'assistant'; content: string }) => ({
          id: m.id,
          role: m.role,
          segments: [{ type: 'text' as const, content: m.content }],
          loading: false,
        })
      );
      setMessages(loaded);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) handleNew();
  }

  async function handleRename(id: string, title: string) {
    await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }

  // ── File upload ───────────────────────────────────────────────────────────

  async function handleFileUpload(file: File) {
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        console.error('[upload]', err.error);
        return;
      }
      const uploaded = (await res.json()) as UploadedFile;
      setPendingFile(uploaded);
    } catch (err) {
      console.error('[upload]', err);
    } finally {
      setUploadingFile(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await handleFileUpload(file);
  }

  // ── Drag-drop ─────────────────────────────────────────────────────────────
  // Use dragover + timeout instead of enter/leave counter — the counter
  // approach is unreliable because dragleave fires before dragenter on child
  // elements in separate event dispatches, causing brief counter=0 flashes.
  // dragover fires continuously while over the element; if it stops firing,
  // the timeout clears the overlay 150ms later.

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!isDraggingOver) setIsDraggingOver(true);
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => setIsDraggingOver(false), 150);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  }

  function handleIngestApprove(payload: IngestPayload) {
    setPendingFile(null);
    send(`I just ingested a file: **${payload.title}**\n\n${payload.summary}`);
  }

  function handleIngestReject() {
    setPendingFile(null);
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async function send(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: uid(), role: 'user',
      segments: [{ type: 'text', content: text.trim() }],
      loading: false,
    };

    const history = messages.map((m) => ({
      role: m.role,
      content: m.segments.filter((s) => s.type === 'text').map((s) => (s as TextSegment).content).join(''),
    }));

    const next = [...history, { role: 'user' as const, content: text.trim() }];

    // 1b: mark optimistic + track new message IDs for entrance animation
    newMessageIdsRef.current.add(userMsg.id);
    setLastSentMsgId(userMsg.id);
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setStickToBottom(true);

    const assistantId = uid();
    newMessageIdsRef.current.add(assistantId);
    currentMsgIdRef.current = assistantId;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', segments: [], loading: true },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, conversationId: activeConvId }),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: NdjsonEvent;
          try { event = JSON.parse(line); } catch (parseErr) {
            console.warn('[ChatView] NDJSON parse error:', parseErr, '| line:', line.slice(0, 200));
            continue;
          }

          console.log('[ChatView] NDJSON event received: t=' + (event as any).t);

          const targetId = currentMsgIdRef.current!;

          if (event.t === 'conv') {
            setActiveConvId(event.id);
            setConversations((prev) => {
              const exists = prev.find((c) => c.id === event.id);
              if (exists) return prev;
              const newConv: ConversationSummary = {
                id: event.id,
                title: event.title,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                preview: text.trim().slice(0, 80),
                messageCount: 1,
              };
              return [newConv, ...prev];
            });
          } else if (event.t === 'text') {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === targetId
                  ? { ...msg, segments: appendText(msg.segments, event.v) }
                  : msg
              )
            );
          } else if (event.t === 'tool_call') {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === targetId
                  ? { ...msg, segments: [...msg.segments, { type: 'tool_call', name: event.name, label: event.label }] }
                  : msg
              )
            );
          } else if (event.t === 'draft') {
            console.log('[ChatView] DRAFT EVENT RECEIVED:', JSON.stringify(event));
            console.log('[ChatView] targetId:', targetId);
            const draftSeg: DraftSegment = {
              type: 'draft', id: event.id, to: event.to, subject: event.subject, body: event.body,
              attachments: event.attachments ?? [],
              attachmentDetails: event.attachmentDetails ?? [],
            };
            setMessages((prev) => {
              const updated = prev.map((msg) =>
                msg.id === targetId
                  ? { ...msg, segments: [...msg.segments, draftSeg] }
                  : msg
              );
              console.log('[ChatView] After draft update, message segments:', updated.find(m => m.id === targetId)?.segments.length);
              return updated;
            });
          }
        }
      }

      loadConversations();
    } catch {
      const targetId = currentMsgIdRef.current!;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === targetId
            ? { ...msg, segments: [{ type: 'text', content: 'Something went wrong. Please try again.' }] }
            : msg
        )
      );
    } finally {
      const targetId = currentMsgIdRef.current!;
      setMessages((prev) =>
        prev.map((msg) => msg.id === targetId ? { ...msg, loading: false } : msg)
      );
      setLoading(false);
      setLastSentMsgId(null);
    }
  }

  // 1e: jump to latest
  function jumpToBottom() {
    setStickToBottom(true);
    setShowJumpPill(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  const isEmpty = messages.length === 0 && !loading && !loadingMessages;
  const canSend = !!input.trim() && !loading;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* History panel */}
      <ChatHistoryPanel
        open={historyOpen}
        onToggle={() => setHistoryOpen((v) => !v)}
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
      />

      {/* Chat area */}
      <div
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, background: '#17141C', position: 'relative' }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Header bar */}
        <div style={{
          padding: '13px 24px',
          borderBottom: '1px solid rgba(255,235,210,0.07)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
          background: 'rgba(23,20,28,0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 1px 0 rgba(255,235,210,0.05)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}>
          <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 12, color: '#7EB8D6', fontWeight: 700, letterSpacing: '0.04em' }}>HATCH</span>
          {activeConvId && (
            <>
              <span style={{ color: '#766D62', fontSize: 12 }}>·</span>
              <span style={{ fontSize: 13, color: '#A89E91', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {conversations.find((c) => c.id === activeConvId)?.title ?? 'Chat'}
              </span>
            </>
          )}
        </div>

        {/* Drop overlay */}
        {isDraggingOver && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            background: 'rgba(23,20,28,0.88)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            border: '2px dashed rgba(126,184,214,0.5)',
            pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 48 }}>📂</div>
            <div style={{ fontSize: 16, color: '#7EB8D6', fontWeight: 600 }}>Drop to add to knowledge base</div>
            <div style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>PDF, DOCX, images, spreadsheets, and more</div>
          </div>
        )}

        {/* Messages area — 1e: scroll container ref */}
        <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: 100 }}>
          {/* 1d: key changes on conv switch → remount with fade-in */}
          <div key={fadeKey} className="fade-in" style={{ maxWidth: 780, margin: '0 auto', padding: '28px 24px 8px' }}>

            {/* Skeleton loading state */}
            {loadingMessages && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 20 }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div className="skeleton" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div className="skeleton" style={{ height: 14, width: `${60 + i * 12}%` }} />
                      <div className="skeleton" style={{ height: 14, width: `${40 + i * 8}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loadingMessages && isEmpty && (
              <div style={{ textAlign: 'center', paddingTop: 80, animation: 'fade-up 0.35s cubic-bezier(0.4,0,0.2,1) both' }}>
                <div style={{
                  width: 80,
                  height: 80,
                  borderRadius: 24,
                  background: 'linear-gradient(135deg, #7EB8D6 0%, #5BA3C9 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 24px',
                  boxShadow: '0 8px 32px rgba(126,184,214,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
                  fontSize: 32,
                  animation: 'float 3s ease-in-out infinite',
                }}>
                  💬
                </div>
                <div style={{
                  fontSize: 36,
                  fontWeight: 300,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                  background: 'linear-gradient(135deg, #FBF5EC 0%, #7EB8D6 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  marginBottom: 10,
                }}>
                  Hatch
                </div>
                <p style={{ color: '#766D62', fontSize: 14, marginBottom: 48, lineHeight: 1.6 }}>Secretary of Sorts. What can I help with?</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 540, margin: '0 auto' }}>
                  {QUICK_ACTIONS.map((action, i) => (
                    <button
                      key={action}
                      onClick={() => send(action)}
                      className="fade-up"
                      style={{
                        padding: '9px 20px',
                        borderRadius: 999,
                        border: '1px solid rgba(255,235,210,0.1)',
                        background: 'rgba(255,235,210,0.06)',
                        color: '#A89E91',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        fontWeight: 500,
                        transition: 'all 0.18s cubic-bezier(0.4,0,0.2,1)',
                        boxShadow: 'none',
                        animationDelay: `${i * 50}ms`,
                      }}
                      onMouseEnter={(e) => {
                        const b = e.currentTarget as HTMLButtonElement;
                        b.style.borderColor = 'rgba(126,184,214,0.5)';
                        b.style.color = '#FBF5EC';
                        b.style.background = 'rgba(126,184,214,0.12)';
                        b.style.boxShadow = '0 2px 8px rgba(126,184,214,0.18)';
                        b.style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        const b = e.currentTarget as HTMLButtonElement;
                        b.style.borderColor = 'rgba(255,235,210,0.1)';
                        b.style.color = '#A89E91';
                        b.style.background = 'rgba(255,235,210,0.06)';
                        b.style.boxShadow = 'none';
                        b.style.transform = 'translateY(0)';
                      }}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {!loadingMessages && messages.map((msg) => {
              const isNew = newMessageIdsRef.current.has(msg.id);
              const isOptimistic = msg.id === lastSentMsgId;
              return (
                <AnimatedMessage key={msg.id} role={msg.role} isNew={isNew} isOptimistic={isOptimistic}>
                  {msg.role === 'assistant' && (
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #7EB8D6 0%, #5BA3C9 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: 1,
                      flexShrink: 0,
                      fontFamily: 'var(--font-jetbrains-mono)',
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#fff',
                      boxShadow: '0 2px 6px rgba(126,184,214,0.3)',
                    }}>
                      S
                    </div>
                  )}

                  {msg.role === 'user' ? (
                    <div style={{
                      maxWidth: '72%',
                      padding: '12px 18px',
                      borderRadius: '18px 18px 6px 18px',
                      background: 'linear-gradient(135deg, #E8B87A 0%, #D4A066 100%)',
                      color: '#17141C',
                      fontSize: 14,
                      lineHeight: 1.65,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      boxShadow: '0 2px 12px rgba(232,184,122,0.25)',
                      opacity: isOptimistic ? 0.75 : 1,
                      transition: 'opacity 0.2s ease',
                    }}>
                      {(msg.segments[0] as TextSegment)?.content}
                    </div>
                  ) : (
                    <div style={{ maxWidth: '78%', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {/* 1g: three-dot thinking indicator while waiting for first token */}
                      {msg.segments.length === 0 && msg.loading ? (
                        <div style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: 0 }}>
                          <span className="thinking-dot" style={{ color: '#7EB8D6', animationDelay: '0ms' }} />
                          <span className="thinking-dot" style={{ color: '#7EB8D6', animationDelay: '200ms' }} />
                          <span className="thinking-dot" style={{ color: '#7EB8D6', animationDelay: '400ms' }} />
                        </div>
                      ) : (
                        msg.segments.map((seg, si) => {
                          if (seg.type === 'text') {
                            // 1a: smooth streaming — only the last text seg is actively streaming
                            const isStreamingThisSeg = msg.loading && si === msg.segments.length - 1;
                            return (
                              <div
                                key={si}
                                className="md-prose"
                                style={{
                                  color: '#EADFD0',
                                  fontSize: 14,
                                  lineHeight: 1.65,
                                  wordBreak: 'break-word',
                                }}
                              >
                                <StreamingMarkdown content={seg.content} streaming={isStreamingThisSeg} />
                              </div>
                            );
                          }
                          if (seg.type === 'tool_call') {
                            return (
                              <div
                                key={si}
                                className="fade-in"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '4px 10px',
                                  borderRadius: 20,
                                  background: 'rgba(126,184,214,0.1)',
                                  border: '1px solid rgba(126,184,214,0.2)',
                                  alignSelf: 'flex-start',
                                }}
                              >
                                <span style={{ fontSize: 12 }}>{TOOL_ICONS[seg.name] ?? '🔧'}</span>
                                <span style={{ fontSize: 11, color: '#5BA3C9', fontFamily: 'var(--font-jetbrains-mono)' }}>{seg.label}</span>
                              </div>
                            );
                          }
                          if (seg.type === 'draft') {
                            console.log('[ChatView] Rendering DraftInlineCard for draftId:', seg.id);
                            return (
                              <DraftErrorBoundary key={seg.id}>
                                <DraftInlineCard
                                  draftId={seg.id}
                                  initialTo={seg.to}
                                  initialSubject={seg.subject}
                                />
                              </DraftErrorBoundary>
                            );
                          }
                          return null;
                        })
                      )}
                    </div>
                  )}
                </AnimatedMessage>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 1e: Jump to latest pill */}
        {showJumpPill && (
          <div style={{
            position: 'absolute',
            bottom: 112,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            animation: 'fade-up 0.2s cubic-bezier(0.16,1,0.3,1) both',
          }}>
            <button
              onClick={jumpToBottom}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 16px',
                borderRadius: 999,
                border: '1px solid rgba(126,184,214,0.3)',
                background: 'rgba(28,24,34,0.92)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                color: '#7EB8D6',
                fontSize: 12,
                fontFamily: 'var(--font-jetbrains-mono)',
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.15s ease',
                letterSpacing: '0.02em',
              }}
              onMouseEnter={(e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.background = 'rgba(126,184,214,0.15)';
                b.style.borderColor = 'rgba(126,184,214,0.5)';
              }}
              onMouseLeave={(e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.background = 'rgba(28,24,34,0.92)';
                b.style.borderColor = 'rgba(126,184,214,0.3)';
              }}
            >
              ↓ Jump to latest
            </button>
          </div>
        )}

        {/* Floating frosted input bar */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 24px 20px',
          background: 'linear-gradient(to top, rgba(23,20,28,1) 60%, rgba(23,20,28,0))',
          pointerEvents: 'none',
        }}>
          <div style={{ maxWidth: 780, margin: '0 auto', pointerEvents: 'all' }}>
            <div style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-end',
              background: 'rgba(28,24,34,0.92)',
              backdropFilter: 'blur(24px) saturate(1.8)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
              border: '1px solid rgba(255,235,210,0.12)',
              borderRadius: 18,
              padding: '10px 10px 10px 16px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
              transition: 'box-shadow 0.2s ease',
            }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Message Hatch…"
                rows={1}
                disabled={loading}
                className="chat-textarea"
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  color: '#FBF5EC',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  padding: 0,
                  resize: 'none',
                  outline: 'none',
                  lineHeight: 1.55,
                  maxHeight: 140,
                  overflowY: 'auto',
                }}
                onFocus={(e) => {
                  const parent = e.currentTarget.closest('div') as HTMLDivElement;
                  if (parent) {
                    parent.style.boxShadow = '0 4px 32px rgba(0,0,0,0.4), 0 0 0 3px rgba(126,184,214,0.18)';
                  }
                }}
                onBlur={(e) => {
                  const parent = e.currentTarget.closest('div') as HTMLDivElement;
                  if (parent) {
                    parent.style.boxShadow = '0 4px 24px rgba(0,0,0,0.3)';
                  }
                }}
              />
              {/* Hidden file input — label triggers it; more reliable than .click() */}
              <input
                id="chat-file-input"
                type="file"
                accept="*/*"
                style={{ display: 'none' }}
                onChange={handleFileSelected}
                disabled={uploadingFile || !!pendingFile}
              />
              <label
                htmlFor={uploadingFile || !!pendingFile ? undefined : 'chat-file-input'}
                title="Attach a file"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'none',
                  color: uploadingFile ? '#7EB8D6' : 'rgba(255,235,210,0.3)',
                  cursor: uploadingFile || !!pendingFile ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  flexShrink: 0,
                  transition: 'color 0.15s',
                  userSelect: 'none',
                }}
                onMouseEnter={(e) => {
                  if (!uploadingFile && !pendingFile)
                    (e.currentTarget as HTMLLabelElement).style.color = 'rgba(255,235,210,0.7)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLLabelElement).style.color = uploadingFile ? '#7EB8D6' : 'rgba(255,235,210,0.3)';
                }}
              >
                {uploadingFile ? '⏳' : '📎'}
              </label>
              <button
                onClick={() => send(input)}
                disabled={!canSend}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  border: 'none',
                  background: canSend
                    ? 'linear-gradient(135deg, #7EB8D6, #6BACC8)'
                    : 'rgba(255,235,210,0.08)',
                  color: canSend ? '#fff' : '#766D62',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  flexShrink: 0,
                  transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                  boxShadow: canSend ? '0 2px 8px rgba(126,184,214,0.4)' : 'none',
                }}
                onMouseEnter={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.05)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
                onMouseDown={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)'; }}
                onMouseUp={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = canSend ? 'scale(1.05)' : 'scale(1)'; }}
              >
                ↑
              </button>
            </div>

            {/* Pending file strip — shown while file awaits approval */}
            {pendingFile && (
              <div
                className="fade-in"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 8,
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: 'rgba(126,184,214,0.08)',
                  border: '1px solid rgba(126,184,214,0.2)',
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#A89E91', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pendingFile.filename}
                  </div>
                  <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>
                    {pendingFile.wordCount.toLocaleString()} words extracted · awaiting review
                  </div>
                </div>
                <button
                  onClick={() => setPendingFile(null)}
                  style={{ background: 'none', border: 'none', color: '#766D62', cursor: 'pointer', fontSize: 16, padding: 2 }}
                >
                  ×
                </button>
                <button
                  onClick={() => setPendingFile(pendingFile)} // re-trigger (modal already open from upload)
                  style={{
                    padding: '5px 14px',
                    borderRadius: 8,
                    border: '1px solid rgba(126,184,214,0.35)',
                    background: 'rgba(126,184,214,0.12)',
                    color: '#7EB8D6',
                    fontSize: 12,
                    fontFamily: 'var(--font-jetbrains-mono)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Review &amp; ingest
                </button>
              </div>
            )}

            {/* Memory indicator pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, paddingLeft: 4 }}>
              <button
                onClick={toggleMemory}
                title={memoryOn ? 'Memory is on — click to disable for this conversation' : 'Memory is off — click to enable'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'none',
                  border: 'none',
                  padding: '2px 8px 2px 6px',
                  borderRadius: 20,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'var(--font-jetbrains-mono)',
                  color: memoryOn ? 'rgba(255,235,210,0.5)' : 'rgba(255,235,210,0.25)',
                  transition: 'color 0.15s',
                  letterSpacing: '0.02em',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,235,210,0.75)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = memoryOn ? 'rgba(255,235,210,0.5)' : 'rgba(255,235,210,0.25)'; }}
              >
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: memoryOn ? '#5BB98C' : '#555060',
                  display: 'inline-block',
                  flexShrink: 0,
                  boxShadow: memoryOn ? '0 0 4px rgba(91,185,140,0.6)' : 'none',
                  transition: 'background 0.15s, box-shadow 0.15s',
                }} />
                Memory {memoryOn ? 'on' : 'off'}
              </button>
              <a
                href="/settings/memory"
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-jetbrains-mono)',
                  color: 'rgba(255,235,210,0.22)',
                  textDecoration: 'none',
                  letterSpacing: '0.02em',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,235,210,0.5)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,235,210,0.22)'; }}
              >
                Review in Settings → Memory
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Ingestion review modal */}
      {pendingFile && (
        <IngestionReviewModal
          file={pendingFile}
          onApprove={handleIngestApprove}
          onReject={handleIngestReject}
        />
      )}
    </div>
  );
}
