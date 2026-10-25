'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChat, type ConvSummary } from '@/lib/chat-context';
import { useLiveData } from '@/lib/swr-config';
import ConfirmModal from '@/components/ui/ConfirmModal';

// Full-page conversation browser for the C2 "View all chats →" link.
// Search filters live on title; "All" / "Starred" chips toggle the active
// filter. Per-row hover reveals the same … menu as the sidebar
// (Star / Rename / Delete).

type Filter = 'all' | 'starred';

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const secs = Math.floor((Date.now() - t) / 1000);
  if (secs < 60) return 'now';
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

interface ConvSummaryWithCount extends ConvSummary {
  messageCount?: number;
}

interface RowProps {
  conv: ConvSummaryWithCount;
  onOpen: (id: string) => void;
  onToggleStar: (id: string, next: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function AllChatRow({ conv, onOpen, onToggleStar, onRename, onDelete }: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [renaming]);

  // Click + ref-contains for outside-click close. Same pattern as ConvRow.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setMenuOpen(false);
    }
    const id = window.setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('click', onDocClick);
    };
  }, [menuOpen]);

  function startRename() {
    setDraft(conv.title);
    setMenuOpen(false);
    setRenaming(true);
  }
  function commitRename() {
    if (!renaming) return;
    const next = draft.trim() || conv.title;
    setRenaming(false);
    if (next !== conv.title) onRename(conv.id, next);
  }
  function cancelRename() {
    setRenaming(false);
    setDraft(conv.title);
  }

  // Rename mode: render the input alone instead of nesting it inside the
  // row's role="button" container. Eliminates the focus contention that
  // was preventing typing into the rename field in the previous hotfix.
  if (renaming) {
    return (
      <div style={{ position: 'relative' }}>
        <div className="sb-allrow sb-row-renaming">
          <span style={{ width: 13, flex: '0 0 13px' }} />
          <input
            ref={inputRef}
            className="sb-row-rename"
            style={{ flex: 1, fontSize: 15 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
            }}
            onBlur={commitRename}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        role="button"
        tabIndex={0}
        className="sb-allrow"
        onClick={() => onOpen(conv.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(conv.id);
          }
        }}
      >
        <span style={{ width: 13, flex: '0 0 13px', display: 'flex', alignItems: 'center', color: conv.favorited ? 'var(--star-gold)' : 'transparent' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill={conv.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </span>
        <span className="sb-allrow-title">{conv.title}</span>
        <span className="sb-allrow-count">{conv.messageCount ?? 0} msgs</span>
        <span className="sb-allrow-time">{relativeTime(conv.updatedAt)}</span>
        <button
          ref={triggerRef}
          type="button"
          className="sb-allrow-menu"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          aria-label="Conversation actions"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="sb-menu"
          style={{ top: 40, right: 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="sb-menu-item"
            onClick={() => { setMenuOpen(false); onToggleStar(conv.id, !conv.favorited); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={conv.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            {conv.favorited ? 'Unstar' : 'Star'}
          </button>
          <button type="button" className="sb-menu-item" onClick={startRename}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Rename
          </button>
          <div className="sb-menu-sep" />
          <button
            type="button"
            className="sb-menu-item sb-menu-item-danger"
            onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
            Delete
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmDelete}
        title={`Delete "${conv.title}"?`}
        body="This can't be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => { setConfirmDelete(false); onDelete(conv.id); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export default function AllChatsView() {
  const router = useRouter();
  const {
    conversations,
    setConversations,
    setConversationId,
    setMessages,
  } = useChat();

  const { data: convsData } = useLiveData<{ conversations: ConvSummaryWithCount[] }>('/api/conversations');
  const swrInitRef = useRef(false);

  // On mount, hydrate from SWR. After that, local state owns mutations
  // (matching the sidebar's pattern).
  useEffect(() => {
    if (convsData && !swrInitRef.current) {
      swrInitRef.current = true;
      setConversations(convsData.conversations ?? []);
    }
  }, [convsData, setConversations]);

  // The All-Chats view needs the messageCount field from the API. The
  // chat-context ConvSummary type doesn't carry it, so we keep a parallel
  // map from the SWR payload and merge for display.
  const countsById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of (convsData?.conversations ?? [])) m.set(c.id, c.messageCount ?? 0);
    return m;
  }, [convsData]);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => filter !== 'starred' || c.favorited)
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .map((c) => ({ ...c, messageCount: countsById.get(c.id) ?? 0 }));
  }, [conversations, filter, query, countsById]);

  async function toggleStar(id: string, next: boolean) {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, favorited: next } : c));
    await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorited: next }),
    });
  }
  async function renameConv(id: string, title: string) {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title } : c));
    await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }
  async function deleteConv(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  }

  async function openConv(id: string) {
    setConversationId(id);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {/* non-fatal */}
    router.push('/');
  }

  const noneAtAll = conversations.length === 0;

  return (
    <div className="sb-allview">
      <div className="sb-allhead">
        <div className="sb-alltitle">All conversations</div>
        <div className="sb-allsearch">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            autoFocus
          />
        </div>
        <div className="sb-chips">
          <button
            className={'sb-chip' + (filter === 'all' ? ' on' : '')}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={'sb-chip' + (filter === 'starred' ? ' on' : '')}
            onClick={() => setFilter('starred')}
          >
            Starred
          </button>
        </div>
      </div>

      <div className="sb-alllist">
        <div className="sb-alllist-inner">
          {noneAtAll ? (
            <div className="sb-allempty">
              No conversations yet.{' '}
              <button
                className="sb-viewall"
                style={{ display: 'inline-flex', verticalAlign: 'middle' }}
                onClick={() => router.push('/')}
              >
                Start one →
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="sb-allempty">No conversations match &ldquo;{query}&rdquo;</div>
          ) : (
            rows.map((c) => (
              <AllChatRow
                key={c.id}
                conv={c}
                onOpen={openConv}
                onToggleStar={toggleStar}
                onRename={renameConv}
                onDelete={deleteConv}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
