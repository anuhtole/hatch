'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ── Chat domain types (moved from HomeView) ─────────────────────────────────

export type TextSegment  = { type: 'text'; content: string };
export type ToolSegment  = {
  type: 'tool_call';
  /** Anthropic tool_use block id — used to update an existing segment in place
   *  when the server emits a refined "ready" event after the initial "starting". */
  id: string;
  name: string;
  label: string;
  status: 'starting' | 'ready';
};
export type DraftSegment = {
  type: 'draft';
  id: string;
  to: string;
  subject: string;
  body: string;
  attachments: string[];
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'discarded';
  /** ISO timestamp the email was sent (rehydrated from the EmailDraft row). */
  sentAt?: string | null;
  /** True when this segment was rebuilt from persisted history (not a live
   *  stream event). Suppresses the auto-open-modal behavior on reload. */
  fromHistory?: boolean;
};
export type PendingActionSegment = {
  type: 'pending_action';
  id: string;
  actionType: 'vault_write' | 'memory_write' | 'pipeline_add' | 'pipeline_update';
  summary: string;
};
// B-13: verified resume artifact card. Mirrors ArtifactPayload in
// lib/resume/last-green.ts — built server-side from a hash-re-verified
// last-green record only. Display-only.
export type ArtifactSegment = {
  type: 'artifact';
  target: string;
  completedAt: string;
  sha256: string;
  pdfSha256?: string;
  previewPngUrl?: string;
  pdfUrl?: string;
  docxUrl: string;
  coverLetterUrl: string;
  gapReportUrl: string;
  studioUrl: string;
  /** True when rebuilt from persisted history (server re-verified hashes on load). */
  fromHistory?: boolean;
};
// B-13: discovery shortlist card. Mirrors RankedGroup in lib/resume/discover.ts
// — published pages only, verbatim contacts or "application page only".
export type DiscoveryGroup = {
  name: string;
  pi?: string;
  topics: string[];
  people: string[];
  undergradProcess?: string;
  contact: { kind: 'email' | 'application-page'; value: string; sourceUrl: string } | null;
  sourceUrls: string[];
  fitScore: number;
  rationales: Array<{ claimId: string; sourceUrl: string; text: string }>;
  accessibility: { statedUndergradProgram?: string; joinPage?: string; undergradCoauthors?: string };
};
export type DiscoverySegment = {
  type: 'discovery';
  lab: string;
  generatedAt: string;
  shortlist: DiscoveryGroup[];
};
export type Segment = TextSegment | ToolSegment | DraftSegment | PendingActionSegment | ArtifactSegment | DiscoverySegment;

// Per-layer retrieval health, surfaced in the assistant message via the
// "context loaded" pill. Mirrors ContextLayerReport in app/api/chat/route.ts.
// Audit risk #2 — replaces the prior silent-fail try/catch wall.
export type ContextLayerName =
  | 'vault'
  | 'memory'
  | 'legacy_memory'
  | 'project'
  | 'knowledge'
  | 'canvas_gmail';
export type ContextLayerStatus = 'fetched' | 'empty' | 'error' | 'skipped';
export type ContextLayerReport = {
  name: ContextLayerName;
  status: ContextLayerStatus;
  itemCount?: number;
  durationMs: number;
  error?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  segments: Segment[];
  loading: boolean;
  contextStatus?: ContextLayerReport[];
};

export type NdjsonEvent =
  | { t: 'text'; v: string }
  | { t: 'tool_call'; id: string; name: string; label: string; status: 'starting' | 'ready' }
  | { t: 'draft'; id: string; to: string; subject: string; body: string; attachments: string[] }
  | { t: 'pending_action'; id: string; actionType: PendingActionSegment['actionType']; summary: string }
  | { t: 'artifact'; payload: Omit<ArtifactSegment, 'type' | 'fromHistory'> }
  | { t: 'discovery'; lab: string; generatedAt: string; shortlist: DiscoveryGroup[] }
  | { t: 'context_status'; layers: ContextLayerReport[] }
  | { t: 'conv'; id: string; title: string };

export type ConvSummary = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
  favorited: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

function appendText(segs: Segment[], text: string): Segment[] {
  const last = segs[segs.length - 1];
  if (last?.type === 'text') {
    return [...segs.slice(0, -1), { type: 'text', content: last.content + text }];
  }
  return [...segs, { type: 'text', content: text }];
}

// ── Context ──────────────────────────────────────────────────────────────────

interface ChatContextValue {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  streaming: boolean;
  conversationId: string | null;
  setConversationId: React.Dispatch<React.SetStateAction<string | null>>;
  conversations: ConvSummary[];
  setConversations: React.Dispatch<React.SetStateAction<ConvSummary[]>>;
  /** Returns the IDs of the user/assistant message pair just appended.
   *  Returns null if the call was a no-op (empty input or already streaming).
   *  `onIds` fires synchronously BEFORE the messages are committed to state,
   *  giving the caller a chance to register the IDs (e.g. in an animation
   *  tracker) so the first render sees them as "new". */
  sendMessage: (
    text: string,
    onIds?: (ids: { userMsgId: string; assistantMsgId: string }) => void,
  ) => Promise<{ userMsgId: string; assistantMsgId: string } | null>;
  abortStream: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Refs mirror state so sendMessage stays stable across renders without
  // re-binding (and without falling into stale-closure bugs).
  const messagesRef       = useRef<ChatMessage[]>([]);
  const streamingRef      = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  messagesRef.current       = messages;
  streamingRef.current      = streaming;
  conversationIdRef.current = conversationId;

  const sendMessage = useCallback(async (
    text: string,
    onIds?: (ids: { userMsgId: string; assistantMsgId: string }) => void,
  ) => {
    const trimmed = text.trim();
    if (!trimmed || streamingRef.current) return null;

    // C2 auto-name: capture whether this is the conversation's very first
    // message BEFORE we append the user/assistant pair. Used after the
    // stream completes to fire a fire-and-forget Haiku title-generation
    // call. Strictly background — never blocks the stream.
    const wasFirstMessage =
      messagesRef.current.length === 0 && conversationIdRef.current === null;

    const userMsg: ChatMessage = {
      id:       uid(),
      role:     'user',
      segments: [{ type: 'text', content: trimmed }],
      loading:  false,
    };
    const assistantMsg: ChatMessage = {
      id:       uid(),
      role:     'assistant',
      segments: [],
      loading:  true,
    };

    // Fire the ID callback synchronously BEFORE setMessages so any caller-side
    // ref-based trackers (e.g. animation Sets) are populated before React
    // commits the new render.
    onIds?.({ userMsgId: userMsg.id, assistantMsgId: assistantMsg.id });

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const historyMessages = [
      // Defensive: legacy/loaded rows may lack a segments array (the
      // server-side normalizer fills it in, but we never want a single
      // bad row to break sendMessage and trip the catch-block "Something
      // went wrong" path).
      ...messagesRef.current.map((m) => ({
        role:    m.role,
        content: (m.segments ?? []).filter((s): s is TextSegment => s.type === 'text').map((s) => s.content).join(''),
      })),
      { role: 'user' as const, content: trimmed },
    ];

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages: historyMessages,
          conversationId: conversationIdRef.current,
        }),
        signal:  ctrl.signal,
      });

      if (!res.ok || !res.body) throw new Error('Failed');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event: NdjsonEvent = JSON.parse(line);
            if (event.t === 'conv') {
              const convId    = event.id;
              const convTitle = event.title;
              setConversationId(convId);
              setConversations((prev) => {
                const exists = prev.find((c) => c.id === convId);
                if (exists) return prev;
                return [{ id: convId, title: convTitle, updatedAt: new Date().toISOString(), preview: trimmed.slice(0, 80), favorited: false }, ...prev];
              });
            } else if (event.t === 'text') {
              setMessages((prev) => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, segments: appendText(m.segments, event.v) } : m
              ));
            } else if (event.t === 'tool_call') {
              // The server emits two events per tool block: status:'starting' at
              // content_block_start (so the indicator appears immediately) and
              // status:'ready' at content_block_stop (with the refined label).
              // Dedupe by id so the second event updates the first segment in
              // place instead of appending a duplicate.
              setMessages((prev) => prev.map((m, i) => {
                if (i !== prev.length - 1) return m;
                const existingIdx = m.segments.findIndex(
                  (s): s is ToolSegment => s.type === 'tool_call' && s.id === event.id,
                );
                const next: ToolSegment = {
                  type:   'tool_call',
                  id:     event.id,
                  name:   event.name,
                  label:  event.label,
                  status: event.status,
                };
                if (existingIdx >= 0) {
                  const segs = [...m.segments];
                  segs[existingIdx] = next;
                  return { ...m, segments: segs };
                }
                return { ...m, segments: [...m.segments, next] };
              }));
            } else if (event.t === 'draft') {
              setMessages((prev) => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, segments: [...m.segments, { type: 'draft', id: event.id, to: event.to, subject: event.subject, body: event.body, attachments: event.attachments ?? [], status: 'pending' as const }] } : m
              ));
            } else if (event.t === 'pending_action') {
              setMessages((prev) => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, segments: [...m.segments, { type: 'pending_action', id: event.id, actionType: event.actionType, summary: event.summary }] } : m
              ));
            } else if (event.t === 'artifact') {
              setMessages((prev) => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, segments: [...m.segments, { type: 'artifact', ...event.payload }] } : m
              ));
            } else if (event.t === 'discovery') {
              setMessages((prev) => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, segments: [...m.segments, { type: 'discovery', lab: event.lab, generatedAt: event.generatedAt, shortlist: event.shortlist }] } : m
              ));
            } else if (event.t === 'context_status') {
              // Attach the layer report to the assistant message about to
              // render. Audit risk #2 — turns silent-fail retrieval into
              // a visible health pill.
              setMessages((prev) => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, contextStatus: event.layers } : m
              ));
            }
          } catch (parseErr) {
            console.warn('[chat-context] NDJSON parse error:', parseErr, '| raw line:', line.slice(0, 200));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, loading: false, segments: [{ type: 'text', content: 'Something went wrong. Please try again.' }] } : m
        ));
      }
    } finally {
      setStreaming(false);
      setMessages((prev) => prev.map((m, i) => i === prev.length - 1 ? { ...m, loading: false } : m));
    }

    // C2 auto-name (fire-and-forget). Runs after the stream completes,
    // and ONLY on the conversation's first user message. Errors and
    // timeouts are swallowed silently — the conversation stays under its
    // snippet-seeded title and the user can rename manually if needed.
    if (wasFirstMessage) {
      const convIdForName = conversationIdRef.current;
      if (convIdForName) {
        void fetch(`/api/conversations/${convIdForName}/auto-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstMessage: trimmed }),
        })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.title) {
              setConversations((prev) =>
                prev.map((c) => c.id === convIdForName ? { ...c, title: data.title } : c)
              );
            }
          })
          .catch(() => {/* non-fatal */});
      }
    }

    return { userMsgId: userMsg.id, assistantMsgId: assistantMsg.id };
  }, []);

  const abortStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        setMessages,
        streaming,
        conversationId,
        setConversationId,
        conversations,
        setConversations,
        sendMessage,
        abortStream,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within <ChatProvider>');
  return ctx;
}
