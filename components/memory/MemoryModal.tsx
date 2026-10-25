'use client';

import {
  memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState,
} from 'react';
import ConfirmModal from '@/components/ui/ConfirmModal';

// Memory modal — curated facts overlay opened from the sidebar's
// "Memory · N things known" foot button. Loads from /api/memories,
// groups by category, supports search, manual add, edit, and forget.

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after add/edit/delete completes so the sidebar can refresh
   *  the "N things known" count via SWR mutate. */
  onChanged?: () => void;
}

interface MemoryRow {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  /** Audit risk #3 — true when the user has curated this fact via the
   *  Memory modal. Tells the auto-extractor to leave value/confidence
   *  alone, and surfaces as a small "edited" indicator in the UI. */
  userEdited?: boolean;
}

// Map raw Prisma categories to display labels + sort order.
const CATEGORY_LABELS: Record<string, string> = {
  fact: 'Identity',
  person: 'Relationships',
  course: 'Education',
  project: 'Active Projects',
  preference: 'Preferences',
  decision: 'Decisions',
};
const CATEGORY_ORDER = ['fact', 'person', 'course', 'project', 'preference', 'decision'];

function labelFor(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

function formatValue(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj === 'string') return obj;
    if (typeof obj?.text === 'string') return obj.text;
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' · ');
  } catch {
    return raw;
  }
}

// Re-pack edited text into the row's `value` shape. For manual rows
// (originally `{text: "..."}`) we just update the text key. For
// structured rows (auto-extracted, e.g. `{name, email, ...}`) we keep
// the original keys but replace its serialized join — round-trippable
// for manual rows, lossy-but-useful for structured ones the user
// explicitly edited from this UI.
function packEditedValue(originalValue: string, newText: string): string {
  try {
    const obj = JSON.parse(originalValue);
    if (obj && typeof obj === 'object' && 'text' in obj) {
      return JSON.stringify({ ...obj, text: newText });
    }
  } catch {
    // not JSON — fall through
  }
  return JSON.stringify({ text: newText });
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Search input lives in its own memoized subcomponent so that the
// modal's per-keystroke re-render of the filtered facts list can't
// remount or steal focus from the input. The parent reads the query
// via the onChange callback and applies the filter through a
// useDeferredValue, so heavy filter work is decoupled from the input's
// own render cycle.
interface SearchBarProps {
  initialValue: string;
  onChange: (q: string) => void;
}
const SearchBar = memo(function SearchBar({ initialValue, onChange }: SearchBarProps) {
  const [local, setLocal] = useState(initialValue);
  useEffect(() => { setLocal(initialValue); }, [initialValue]);
  return (
    <div className="sb-mem-search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
      </svg>
      <input
        value={local}
        onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
        placeholder="Search memory…"
        autoFocus
      />
    </div>
  );
});

export default function MemoryModal({ open, onClose, onChanged }: Props) {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<MemoryRow | null>(null);
  // Mirror pendingDelete in a ref so the ConfirmModal onConfirm closure
  // can read the latest deletion target even if a stale render or
  // batched state update has already cleared the state. Without this,
  // the close-on-confirm reset effect runs in the same batch and onConfirm
  // sees pendingDelete=null — silently skipping the DELETE fetch.
  const pendingDeleteRef = useRef<MemoryRow | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Deferring the query makes the heavy `grouped` recompute happen at
  // lower priority than the input's own render — the search field
  // stays responsive even with 100+ facts.
  const deferredQuery = useDeferredValue(query);

  // Stable callback identity so memoized SearchBar doesn't see new props
  // on every render.
  const onSearchChange = useCallback((q: string) => setQuery(q), []);

  // Reload from the server. Used on open AND after add/edit/delete so
  // optimistic UI is always reconciled with the authoritative list.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/memories');
      const data = await res.json();
      setMemories(data.memories ?? []);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on open. We refetch each time to keep stale state out.
  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  // Reset all transient UI state when the modal closes.
  useEffect(() => {
    if (!open) {
      setAdding(false);
      setDraft('');
      setEditingId(null);
      setEditDraft('');
      setPendingDelete(null);
      setQuery('');
    }
  }, [open]);

  // Esc closes when not in a confirmation flow.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pendingDelete && !editingId) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, pendingDelete, editingId]);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  // Note: the search input is auto-focused by SearchBar itself
  // (autoFocus on its <input>), so we don't need a focus effect here.
  // The previous effect's setTimeout was a leftover from when the
  // search input lived inline in this component.

  // Last extraction timestamp = max lastSeenAt across all memories.
  const lastExtraction = useMemo(() => {
    if (!memories.length) return null;
    let max = 0;
    for (const m of memories) {
      const t = new Date(m.lastSeenAt).getTime();
      if (t > max) max = t;
    }
    return max ? new Date(max).toISOString() : null;
  }, [memories]);

  // Filter + group. Uses the deferred query so heavy reflow is
  // de-prioritized vs the input's own update. Within each category,
  // rows are sorted by createdAt DESC so a newly added fact lands
  // at the top of its section. The server also orders by createdAt
  // DESC, so the initial fetch already arrives newest-first — this
  // sort just preserves that invariant after optimistic prepends.
  const grouped = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const filtered = memories.filter((m) => {
      if (!q) return true;
      const v = formatValue(m.value).toLowerCase();
      return v.includes(q) || m.category.toLowerCase().includes(q) || m.key.toLowerCase().includes(q);
    });
    const byCat = new Map<string, MemoryRow[]>();
    for (const m of filtered) {
      const list = byCat.get(m.category) ?? [];
      list.push(m);
      byCat.set(m.category, list);
    }
    for (const list of byCat.values()) {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    const sorted: Array<[string, MemoryRow[]]> = [];
    for (const cat of CATEGORY_ORDER) {
      if (byCat.has(cat)) {
        sorted.push([cat, byCat.get(cat)!]);
        byCat.delete(cat);
      }
    }
    for (const [cat, list] of byCat) sorted.push([cat, list]);
    return sorted;
  }, [memories, deferredQuery]);

  async function addFact() {
    const text = draft.trim();
    if (!text) { setAdding(false); return; }
    // Optimistic placeholder — replaced when the server returns the real row.
    const now = new Date().toISOString();
    const tempId = `tmp-${Date.now()}`;
    const optimistic: MemoryRow = {
      id: tempId,
      category: 'fact',
      key: tempId,
      value: JSON.stringify({ text }),
      confidence: 1,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    setMemories((prev) => [optimistic, ...prev]);
    setDraft('');
    setAdding(false);
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.memory) {
          setMemories((prev) => prev.map((m) => m.id === tempId ? data.memory : m));
        }
        // Reconcile with the server's view so closing+reopening always
        // shows the persisted truth, not stale optimistic state.
        void reload();
        onChanged?.();
      } else {
        // Roll back the optimistic insert on failure.
        setMemories((prev) => prev.filter((m) => m.id !== tempId));
      }
    } catch {
      setMemories((prev) => prev.filter((m) => m.id !== tempId));
    }
  }

  function startEdit(m: MemoryRow) {
    setEditingId(m.id);
    setEditDraft(formatValue(m.value));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }

  async function commitEdit(m: MemoryRow) {
    const next = editDraft.trim();
    const original = formatValue(m.value);
    setEditingId(null);
    setEditDraft('');
    if (!next || next === original) return;

    const newValue = packEditedValue(m.value, next);
    setMemories((prev) =>
      prev.map((x) => x.id === m.id ? { ...x, value: newValue, updatedAt: new Date().toISOString() } : x)
    );
    try {
      const res = await fetch(`/api/memories/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: newValue }),
      });
      if (res.ok) {
        onChanged?.();
      } else {
        // Roll back to the original on failure.
        setMemories((prev) => prev.map((x) => x.id === m.id ? m : x));
      }
    } catch {
      setMemories((prev) => prev.map((x) => x.id === m.id ? m : x));
    }
  }

  async function deleteFact(id: string) {
    const snapshot = memories;
    setMemories((prev) => prev.filter((m) => m.id !== id));
    try {
      const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      if (!res.ok) setMemories(snapshot);
      else onChanged?.();
    } catch {
      setMemories(snapshot);
    }
  }

  // Open the delete-confirm dialog. We set both state (drives ConfirmModal's
  // open prop) and a ref (so the onConfirm callback below can read the
  // target id without depending on closure-captured state — which can be
  // out of date by the time the user clicks Forget).
  function requestDelete(m: MemoryRow) {
    pendingDeleteRef.current = m;
    setPendingDelete(m);
  }

  function cancelDelete() {
    pendingDeleteRef.current = null;
    setPendingDelete(null);
  }

  // Stable confirmation handler — reads the deletion target from the ref,
  // not from React state. Anything that clears state between the user
  // opening the dialog and clicking Forget (re-renders, batched effects,
  // event-bubble side effects) can't break this chain.
  const handleConfirmDelete = useCallback(() => {
    const target = pendingDeleteRef.current;
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    if (target) void deleteFact(target.id);
  // deleteFact closes over the latest memories/onChanged via local state,
  // so it doesn't need to be a dep here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const totalCount = memories.length;

  return (
    <>
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        className="modal-panel sb-mem"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sb-mem-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sb-mem-head">
          <div>
            <div id="sb-mem-title" className="sb-mem-title">Memory</div>
            <div className="sb-mem-sub">
              What Hatch believes about you · {totalCount} {totalCount === 1 ? 'fact' : 'facts'}
            </div>
          </div>
          <button type="button" className="sb-mem-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <SearchBar initialValue={query} onChange={onSearchChange} />

        {/* Add a fact — pinned at the top so it's discoverable. */}
        <div className="sb-mem-addbar">
          {adding ? (
            <input
              ref={addInputRef}
              className="sb-mem-add-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="A fact about you… (Enter to save, Esc to cancel)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addFact(); }
                else if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setDraft(''); }
              }}
              onBlur={() => { if (!draft.trim()) setAdding(false); }}
            />
          ) : (
            <button type="button" className="sb-mem-add" onClick={() => setAdding(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add a fact
            </button>
          )}
        </div>

        <div className="sb-mem-body thin-scroll">
          {loading ? (
            <div className="sb-mem-empty">Loading…</div>
          ) : grouped.length === 0 && !query ? (
            <div className="sb-mem-empty">
              No memory yet. Hatch will extract facts as you chat — or add one above.
            </div>
          ) : grouped.length === 0 ? (
            <div className="sb-mem-empty">Nothing matches &ldquo;{query}&rdquo;.</div>
          ) : (
            grouped.map(([cat, rows]) => (
              <section key={cat} className="sb-mem-sec">
                <div className="sb-mem-sec-label">{labelFor(cat)}</div>
                {rows.map((m) => {
                  const isEditing = editingId === m.id;
                  return (
                    <div key={m.id} className={'sb-mem-fact' + (isEditing ? ' editing' : '')}>
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          className="sb-mem-edit-input"
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(m); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                          }}
                          onBlur={() => commitEdit(m)}
                        />
                      ) : (
                        <>
                          <span className="sb-mem-fact-text">{formatValue(m.value)}</span>
                          {m.userEdited && (
                            <span
                              className="sb-mem-edited-tag"
                              title="This fact was curated by you — the auto-extractor will not overwrite it."
                            >
                              edited
                            </span>
                          )}
                          <button
                            type="button"
                            className="sb-mem-icon-btn"
                            onClick={() => startEdit(m)}
                            aria-label="Edit fact"
                            title="Edit"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="sb-mem-icon-btn danger"
                            onClick={(e) => { e.stopPropagation(); requestDelete(m); }}
                            aria-label="Forget this fact"
                            title="Forget"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <div className="sb-mem-foot">
          {lastExtraction
            ? <>Last extraction <b>{timeAgo(lastExtraction)}</b></>
            : <>No extraction yet</>}
        </div>
      </div>

    </div>

    {/* ConfirmModal rendered OUTSIDE MemoryModal's backdrop so its own
        backdrop click + button onClick never cross-fire MemoryModal's
        onClose. The previous nesting caused the close-effect to clear
        pendingDelete in the same React batch as onConfirm, which left
        the closure reading null and silently skipping the DELETE. */}
    <ConfirmModal
      open={!!pendingDelete}
      title="Forget this fact?"
      body={pendingDelete
        ? `Hatch will no longer know: "${truncate(formatValue(pendingDelete.value), 140)}"`
        : ''}
      confirmLabel="Forget"
      confirmVariant="danger"
      onConfirm={handleConfirmDelete}
      onCancel={cancelDelete}
    />
    </>
  );
}
