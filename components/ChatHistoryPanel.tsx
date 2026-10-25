'use client';

import { useState, useRef, useEffect } from 'react';

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
  memoryExcluded?: boolean;
};

type Props = {
  open: boolean;
  onToggle: () => void;
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
};

// ── Date grouping ─────────────────────────────────────────────────────────────

function groupLabel(dateStr: string): 'Today' | 'Yesterday' | 'This Week' | 'Older' {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 1 && date.getDate() === now.getDate()) return 'Today';
  if (diffDays < 2 && date.getDate() === now.getDate() - 1) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  return 'Older';
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24 && date.getDate() === now.getDate()) return `${diffHours}h ago`;
  if (diffHours < 48) return 'Yesterday';

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Older'] as const;
type Group = (typeof GROUP_ORDER)[number];

export default function ChatHistoryPanel({
  open,
  onToggle,
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: Props) {
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [newChatHovered, setNewChatHovered] = useState(false);
  const [collapseHovered, setCollapseHovered] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = GROUP_ORDER.reduce<Record<Group, ConversationSummary[]>>(
    (acc, g) => ({ ...acc, [g]: [] }),
    {} as Record<Group, ConversationSummary[]>
  );
  for (const c of filtered) {
    grouped[groupLabel(c.updatedAt)].push(c);
  }

  function startRename(c: ConversationSummary) {
    setRenamingId(c.id);
    setRenameText(c.title);
  }

  function commitRename(id: string) {
    if (renameText.trim()) onRename(id, renameText.trim());
    setRenamingId(null);
  }

  // ── Collapsed tab ─────────────────────────────────────────────────────────

  if (!open) {
    return (
      <div
        style={{
          width: 36,
          background: '#1C1822',
          borderRight: '1px solid rgba(255,235,210,0.07)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 12,
          gap: 10,
          flexShrink: 0,
          transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <button
          onClick={onToggle}
          title="Open chat history (⌘B)"
          onMouseEnter={() => setCollapseHovered(true)}
          onMouseLeave={() => setCollapseHovered(false)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            border: 'none',
            background: collapseHovered ? 'rgba(255,235,210,0.08)' : 'transparent',
            color: collapseHovered ? '#FBF5EC' : '#766D62',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: 'none',
          }}
        >
          ☰
        </button>
      </div>
    );
  }

  // ── Expanded panel ────────────────────────────────────────────────────────

  return (
    <div
      style={{
        width: 240,
        minWidth: 240,
        background: '#1C1822',
        borderRight: '1px solid rgba(255,235,210,0.07)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flexShrink: 0,
        transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 10px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid rgba(255,235,210,0.07)',
        }}
      >
        <button
          onClick={onNew}
          onMouseEnter={() => setNewChatHovered(true)}
          onMouseLeave={() => setNewChatHovered(false)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 8,
            border: `1px solid ${newChatHovered ? '#7EB8D6' : 'rgba(255,235,210,0.1)'}`,
            background: newChatHovered ? 'rgba(126,184,214,0.12)' : 'rgba(255,235,210,0.05)',
            color: newChatHovered ? '#FBF5EC' : '#A89E91',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
            transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
            textAlign: 'left',
            boxShadow: 'none',
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          <span>New Chat</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              opacity: 0.45,
              fontFamily: 'var(--font-jetbrains-mono)',
            }}
          >
            ⌘N
          </span>
        </button>

        <button
          onClick={onToggle}
          title="Collapse (⌘B)"
          onMouseEnter={() => setCollapseHovered(true)}
          onMouseLeave={() => setCollapseHovered(false)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            border: 'none',
            background: collapseHovered ? 'rgba(255,235,210,0.08)' : 'transparent',
            color: collapseHovered ? '#FBF5EC' : '#766D62',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            flexShrink: 0,
            transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: 'none',
          }}
        >
          ✕
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 10px' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search chats..."
          style={{
            width: '100%',
            background: 'rgba(255,235,210,0.06)',
            border: `1px solid ${searchFocused ? 'rgba(126,184,214,0.6)' : 'rgba(255,235,210,0.1)'}`,
            borderRadius: 7,
            color: '#FBF5EC',
            fontSize: 12,
            fontFamily: 'inherit',
            padding: '5px 9px',
            outline: 'none',
            boxSizing: 'border-box',
            transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: searchFocused
              ? '0 0 0 3px rgba(126,184,214,0.2)'
              : 'none',
          }}
        />
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 12px' }}>
        {conversations.length === 0 && (
          <div
            style={{
              padding: '28px 12px',
              textAlign: 'center',
              color: '#766D62',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            No conversations yet.
            <br />
            Start a new chat above.
          </div>
        )}

        {filtered.length === 0 && conversations.length > 0 && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: '#766D62', fontSize: 12 }}>
            No results for &quot;{search}&quot;
          </div>
        )}

        {GROUP_ORDER.map((group) => {
          const items = grouped[group];
          if (!items.length) return null;

          return (
            <div key={group}>
              <div
                style={{
                  padding: '10px 8px 4px',
                  fontSize: 9.5,
                  color: '#766D62',
                  fontFamily: 'var(--font-jetbrains-mono)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  userSelect: 'none',
                }}
              >
                {group}
              </div>

              {items.map((c) => {
                const isActive = c.id === activeId;
                const isHovered = hoveredId === c.id;
                const isRenaming = renamingId === c.id;

                return (
                  <div
                    key={c.id}
                    onMouseEnter={() => setHoveredId(c.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => !isRenaming && onSelect(c.id)}
                    style={{
                      padding: '7px 9px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: isActive
                        ? '#221E2A'
                        : isHovered
                        ? 'rgba(255,235,210,0.05)'
                        : 'transparent',
                      borderLeft: `2px solid ${isActive ? '#7EB8D6' : 'transparent'}`,
                      marginBottom: 1,
                      transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                      position: 'relative',
                      boxShadow: 'none',
                    }}
                  >
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(c.id);
                          if (e.key === 'Escape') setRenamingId(null);
                          e.stopPropagation();
                        }}
                        onBlur={() => commitRename(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '100%',
                          background: '#221E2A',
                          border: '1px solid #7EB8D6',
                          borderRadius: 5,
                          color: '#FBF5EC',
                          fontSize: 12,
                          fontFamily: 'inherit',
                          padding: '2px 6px',
                          outline: 'none',
                          boxSizing: 'border-box',
                          boxShadow: '0 0 0 3px rgba(126,184,214,0.2)',
                        }}
                      />
                    ) : (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 4,
                            marginBottom: 2,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              color: isActive ? '#FBF5EC' : '#A89E91',
                              fontWeight: isActive ? 500 : 400,
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              paddingRight: isHovered ? 44 : 0,
                              transition: 'padding-right 0.12s ease',
                            }}
                          >
                            {c.title}
                          </span>
                          {!isHovered && (
                            <span
                              style={{
                                fontSize: 10,
                                color: '#766D62',
                                flexShrink: 0,
                                fontFamily: 'var(--font-jetbrains-mono)',
                              }}
                            >
                              {relativeTime(c.updatedAt)}
                            </span>
                          )}
                        </div>

                        {c.preview && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#766D62',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {c.preview}
                          </div>
                        )}

                        {/* Action buttons — shown on hover */}
                        {isHovered && (
                          <div
                            style={{
                              position: 'absolute',
                              right: 7,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              display: 'flex',
                              gap: 3,
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={(e) => { e.stopPropagation(); startRename(c); }}
                              title="Rename"
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 5,
                                border: 'none',
                                background: 'rgba(255,235,210,0.08)',
                                color: '#A89E91',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 11,
                                transition: 'all 0.12s ease',
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(126,184,214,0.2)';
                                (e.currentTarget as HTMLButtonElement).style.color = '#7EB8D6';
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,235,210,0.08)';
                                (e.currentTarget as HTMLButtonElement).style.color = '#A89E91';
                              }}
                            >
                              ✎
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                              title="Delete"
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 5,
                                border: 'none',
                                background: 'rgba(255,235,210,0.08)',
                                color: '#A89E91',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 13,
                                transition: 'all 0.12s ease',
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(216,136,120,0.15)';
                                (e.currentTarget as HTMLButtonElement).style.color = '#D88878';
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,235,210,0.08)';
                                (e.currentTarget as HTMLButtonElement).style.color = '#A89E91';
                              }}
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
