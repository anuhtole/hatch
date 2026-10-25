'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useChat, type ConvSummary } from '@/lib/chat-context';
import { useLiveData } from '@/lib/swr-config';
import { useEffect, useRef, useState } from 'react';
import ConfirmModal from '@/components/ui/ConfirmModal';
import MemoryModal from '@/components/memory/MemoryModal';

// Notion-pivot left sidebar. C1 ported structure + palette + the existing
// conversation list. C2 adds the per-row … menu (star/rename/delete) and
// keeps the "View all chats →" link pointing at the full browser.
// C3 wired Memory modal + Knowledge surface counts. C4 originally added
// a clickable PROJECTS section; that was cut — Claude Code project
// context is now injected invisibly into the chat system prompt via
// lib/projects.ts buildProjectContextSummary().

type View = 'home' | 'email' | 'calendar' | 'career' | 'settings';

interface Props {
  active: View;
  onNavigate: (v: View) => void;
}

// ── Inline SVG icons ─────────────────────────────────────────────────────────

function IHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}
function IMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="m22 7-10 6L2 7"/>
    </svg>
  );
}
function ICalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
    </svg>
  );
}
function ISettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}
function IBriefcase() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
    </svg>
  );
}
function IStar({ filled }: { filled?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  );
}
function IPlus() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}
function ISparkles() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
  );
}
function IDatabase() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
      <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6"/>
    </svg>
  );
}
function IChevronDown() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}
function IChevronRight({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}
function IDots() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
    </svg>
  );
}
function IPencil() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}
function ITrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  );
}

// ── Conversation row + per-row action menu ────────────────────────────────────

interface ConvRowProps {
  conv: ConvSummary;
  isActive: boolean;
  isStarredSection: boolean;
  onSelect: (id: string) => void;
  onToggleStar: (id: string, next: boolean) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function ConvRow({ conv, isActive, isStarredSection, onSelect, onToggleStar, onRename, onDelete }: ConvRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  // Close menu on outside click. We listen on `click` (not `mousedown`) and
  // gate by ref-contains so the menu item's own click handler always runs
  // BEFORE this closer fires. setTimeout(…, 0) registers the listener after
  // the click that opened the menu has finished bubbling, so opening
  // doesn't immediately close.
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

  // While renaming, the row becomes the <input> alone — no role="button"
  // wrapper, no menu trigger. This eliminates the previous focus/event
  // contention between the row's onClick / role="button" and the
  // descendant input (which was preventing rename from working).
  if (renaming) {
    return (
      <div style={{ position: 'relative' }}>
        <div className={'sb-row sb-row-renaming' + (isActive ? ' active' : '')}>
          {isStarredSection && (
            <span className="sb-star"><IStar filled /></span>
          )}
          <input
            ref={inputRef}
            className="sb-row-rename"
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
        className={'sb-row' + (isActive ? ' active' : '')}
        onClick={() => onSelect(conv.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(conv.id);
          }
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenuOpen((v) => !v); }}
        title={conv.title}
      >
        {isStarredSection && (
          <span className="sb-star"><IStar filled /></span>
        )}
        <span className="sb-row-title">{conv.title}</span>
        <button
          ref={triggerRef}
          type="button"
          className="sb-rowmenu"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          aria-label="Conversation actions"
        >
          <IDots />
        </button>
      </div>

      {menuOpen && (
        <div ref={menuRef} className="sb-menu" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="sb-menu-item"
            onClick={() => { setMenuOpen(false); onToggleStar(conv.id, !conv.favorited); }}
          >
            <IStar filled={conv.favorited} /> {conv.favorited ? 'Unstar' : 'Star'}
          </button>
          <button type="button" className="sb-menu-item" onClick={startRename}>
            <IPencil /> Rename
          </button>
          <div className="sb-menu-sep" />
          <button
            type="button"
            className="sb-menu-item sb-menu-item-danger"
            onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
          >
            <ITrash /> Delete
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

// ── Main sidebar ─────────────────────────────────────────────────────────────

export default function NotionSidebar({ active, onNavigate }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    conversationId,
    setConversationId,
    setMessages,
    conversations,
    setConversations,
  } = useChat();
  const { data: convsData } = useLiveData<{ conversations: ConvSummary[] }>('/api/conversations');
  const { data: kbStats, mutate: mutateStats } = useLiveData<{ total: number; memoryCount: number }>('/api/knowledge/stats');
  const swrInitRef = useRef(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  // Career nav group (B-37): an expandable parent over two route-based sub-items
  // (LinkedIn Connections → /connections, Resume Studio → /resume). Parent reads
  // active off the current pathname; opens by default when already inside the group.
  const careerActive = pathname === '/connections' || pathname === '/resume';
  const [careerOpen, setCareerOpen] = useState(careerActive);

  // Sync SWR data into chat-context once. After that, local state owns
  // optimistic mutations (auto-name, star, rename, delete) so the UI
  // stays snappy without revalidating on every action.
  useEffect(() => {
    if (convsData && !swrInitRef.current) {
      swrInitRef.current = true;
      setConversations(convsData.conversations ?? []);
    }
  }, [convsData, setConversations]);

  async function loadConversation(id: string) {
    if (id === conversationId) { onNavigate('home'); return; }
    onNavigate('home');
    setConversationId(id);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      // non-fatal: chat surface will just show empty
    }
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    onNavigate('home');
  }

  // ── Row actions ─────────────────────────────────────────────────────────
  // Each does an optimistic local update + PATCH/DELETE. On API failure we
  // don't roll back — by C2's UX bar that's acceptable; the user can hit
  // refresh if something de-syncs. C-future can add a toast on error.

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
    if (conversationId === id) {
      setConversationId(null);
      setMessages([]);
    }
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  }

  const starred = conversations.filter((c) => c.favorited);
  const recents = conversations.filter((c) => !c.favorited).slice(0, 12);

  const memoryCount = kbStats?.memoryCount ?? 0;
  const knowledgeCount = kbStats?.total ?? 0;
  const knowledgeCountStr = knowledgeCount.toLocaleString();

  return (
    <aside className="sb-side">
      {/* Workspace header */}
      <div className="sb-ws">
        <div className="sb-ws-mark">H</div>
        <span className="sb-ws-name">Hatch</span>
        <span className="sb-ws-chev"><IChevronDown /></span>
      </div>

      {/* + New chat */}
      <div className="sb-toprow">
        <button className="sb-newchat" onClick={newChat}>
          <IPlus /> New chat
        </button>
      </div>

      {/* Primary nav */}
      <nav className="sb-nav">
        <button
          className={'sb-item' + (active === 'home' ? ' active' : '')}
          onClick={() => onNavigate('home')}
        >
          <IHome /> Home
        </button>
        <button
          className={'sb-item' + (active === 'email' ? ' active' : '')}
          onClick={() => onNavigate('email')}
        >
          <IMail /> Mail
        </button>
        <button
          className={'sb-item' + (active === 'calendar' ? ' active' : '')}
          onClick={() => onNavigate('calendar')}
        >
          <ICalendar /> Calendar
        </button>

        {/* Career — expandable group over /connections + /resume (B-37) */}
        <button
          className={'sb-item' + (careerActive ? ' active' : '')}
          onClick={() => setCareerOpen((v) => !v)}
          aria-expanded={careerOpen}
        >
          <IBriefcase /> Career
          <span
            className="sb-item-chev"
            style={{ marginLeft: 'auto', transform: careerOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            <IChevronRight size={13} />
          </span>
        </button>
        {careerOpen && (
          <div className="sb-subnav">
            <button
              className={'sb-subitem' + (pathname === '/connections' ? ' active' : '')}
              onClick={() => router.push('/connections')}
            >
              LinkedIn Connections
            </button>
            <button
              className={'sb-subitem' + (pathname === '/resume' ? ' active' : '')}
              onClick={() => router.push('/resume')}
            >
              Resume Studio
            </button>
          </div>
        )}

        <button
          className={'sb-item' + (active === 'settings' ? ' active' : '')}
          onClick={() => onNavigate('settings')}
        >
          <ISettings /> Settings
        </button>
      </nav>

      {/* Scrollable section stack */}
      <div className="sb-scrollzone">
        {/* Starred */}
        {starred.length > 0 && (
          <>
            <div className="sb-sec"><span className="sb-sec-label">Starred</span></div>
            {starred.map((c) => (
              <ConvRow
                key={c.id}
                conv={c}
                isActive={active === 'home' && conversationId === c.id}
                isStarredSection
                onSelect={loadConversation}
                onToggleStar={toggleStar}
                onRename={renameConv}
                onDelete={deleteConv}
              />
            ))}
          </>
        )}

        {/* Recents */}
        <div className="sb-sec"><span className="sb-sec-label">Recents</span></div>
        {recents.length === 0 ? (
          <div style={{
            fontSize: 11.5,
            color: 'var(--text-tertiary)',
            padding: '6px 8px',
            fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
          }}>
            No conversations yet
          </div>
        ) : (
          recents.map((c) => (
            <ConvRow
              key={c.id}
              conv={c}
              isActive={active === 'home' && conversationId === c.id}
              isStarredSection={false}
              onSelect={loadConversation}
              onToggleStar={toggleStar}
              onRename={renameConv}
              onDelete={deleteConv}
            />
          ))
        )}

        <button className="sb-viewall" onClick={() => router.push('/chats')}>
          View all chats <IChevronRight />
        </button>
      </div>

      {/* Bottom-pinned: Memory / Knowledge / profile */}
      <div className="sb-foot">
        <button className="sb-foot-item" onClick={() => setMemoryOpen(true)}>
          <ISparkles />
          <span className="sb-foot-txt">Memory · <b>{memoryCount} {memoryCount === 1 ? 'thing' : 'things'} known</b></span>
        </button>
        <button className="sb-foot-item" onClick={() => router.push('/knowledge')}>
          <IDatabase />
          <span className="sb-foot-txt">Knowledge · <b>{knowledgeCountStr} files</b></span>
        </button>
        <div className="sb-profile">
          <div className="sb-avatar">A</div>
          <div>
            <div className="sb-profile-name">Anatole</div>
            <div className="sb-profile-sub">Personal workspace</div>
          </div>
        </div>
      </div>

      <MemoryModal
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        onChanged={() => mutateStats()}
      />
    </aside>
  );
}
