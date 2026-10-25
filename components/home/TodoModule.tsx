'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveData } from '@/lib/swr-config';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import CollapsibleModule from './CollapsibleModule';

// ── Types ─────────────────────────────────────────────────────────────────────

type Todo = {
  id: string;
  text: string;
  completed: boolean;
  priority: string | null;
  dueDate: string | null;
  notes: string | null;
  links: string | null; // JSON array string
  order: number;
};

type ParsedTodo = Todo & { parsedLinks: string[] };

const PRIORITY_COLORS: Record<string, string> = {
  high:   '#D88878',
  medium: '#E8B87A',
  low:    '#766D62',
};

function parseTodo(t: Todo): ParsedTodo {
  let parsedLinks: string[] = [];
  if (t.links) {
    try { parsedLinks = JSON.parse(t.links); } catch {}
  }
  return { ...t, parsedLinks };
}

// ── Priority dot ──────────────────────────────────────────────────────────────

function PriorityDot({ priority }: { priority: string | null }) {
  if (!priority) return null;
  return (
    <span style={{
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: PRIORITY_COLORS[priority] ?? '#766D62',
      display: 'inline-block',
      flexShrink: 0,
    }} />
  );
}

// ── Drag handle ───────────────────────────────────────────────────────────────

function DragHandle({ listeners, attributes }: { listeners?: Record<string, unknown>; attributes?: Record<string, unknown> }) {
  return (
    <div
      {...listeners}
      {...attributes}
      style={{
        width: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        cursor: 'grab',
        padding: '4px 2px',
        flexShrink: 0,
        opacity: 0,
        transition: 'opacity 150ms ease',
      }}
      className="drag-handle"
    >
      {[0, 1, 2].map((r) => (
        <div key={r} style={{ display: 'flex', gap: 2 }}>
          <div style={{ width: 2, height: 2, borderRadius: '50%', background: '#766D62' }} />
          <div style={{ width: 2, height: 2, borderRadius: '50%', background: '#766D62' }} />
        </div>
      ))}
    </div>
  );
}

// ── Expanded panel ────────────────────────────────────────────────────────────

function ExpandedPanel({
  todo,
  onUpdate,
  onDelete,
}: {
  todo: ParsedTodo;
  onUpdate: (patch: Partial<Todo> & { parsedLinks?: string[] }) => void;
  onDelete: () => void;
}) {
  const [notes, setNotes] = useState(todo.notes ?? '');
  const [linkInput, setLinkInput] = useState('');
  const [links, setLinks] = useState<string[]>(todo.parsedLinks);
  const [dueDate, setDueDate] = useState(
    todo.dueDate ? new Date(todo.dueDate).toISOString().slice(0, 10) : ''
  );

  function saveNotes() {
    onUpdate({ notes });
  }

  function saveDueDate() {
    onUpdate({ dueDate: dueDate || null });
  }

  function addLink() {
    const url = linkInput.trim();
    if (!url) return;
    const updated = [...links, url];
    setLinks(updated);
    setLinkInput('');
    onUpdate({ parsedLinks: updated });
  }

  function removeLink(i: number) {
    const updated = links.filter((_, idx) => idx !== i);
    setLinks(updated);
    onUpdate({ parsedLinks: updated });
  }

  return (
    <div style={{
      padding: '8px 8px 4px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      borderTop: '1px solid rgba(255,235,210,0.07)',
      marginTop: 4,
    }}>
      {/* Priority picker */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', minWidth: 50 }}>PRIORITY</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['high', 'medium', 'low'] as const).map((p) => (
            <button
              key={p}
              onClick={() => onUpdate({ priority: todo.priority === p ? null : p })}
              style={{
                height: 22,
                padding: '0 8px',
                borderRadius: 5,
                border: `1px solid ${todo.priority === p ? PRIORITY_COLORS[p] : 'rgba(255,235,210,0.12)'}`,
                background: todo.priority === p ? PRIORITY_COLORS[p] + '30' : 'transparent',
                color: todo.priority === p ? PRIORITY_COLORS[p] : '#766D62',
                fontSize: 10,
                fontFamily: 'var(--font-jetbrains-mono)',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                textTransform: 'uppercase',
              }}
            >{p}</button>
          ))}
        </div>
      </div>

      {/* Due date */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', minWidth: 50 }}>DUE</span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          onBlur={saveDueDate}
          style={{
            height: 22,
            padding: '0 6px',
            borderRadius: 5,
            border: '1px solid rgba(255,235,210,0.12)',
            background: 'rgba(255,235,210,0.05)',
            fontSize: 11,
            color: '#FBF5EC',
            outline: 'none',
            fontFamily: 'var(--font-jetbrains-mono)',
          }}
        />
        {dueDate && (
          <button
            onClick={() => { setDueDate(''); onUpdate({ dueDate: null }); }}
            style={{ background: 'none', border: 'none', color: '#766D62', cursor: 'pointer', fontSize: 12, padding: 0 }}
          >×</button>
        )}
      </div>

      {/* Notes */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={saveNotes}
        placeholder="Add notes…"
        rows={2}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'rgba(255,235,210,0.05)',
          border: '1px solid rgba(255,235,210,0.08)',
          borderRadius: 7,
          padding: '6px 8px',
          fontSize: 12,
          color: '#FBF5EC',
          resize: 'vertical',
          outline: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.5,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = '#7EB8D6')}
        onBlurCapture={(e) => (e.currentTarget.style.borderColor = 'rgba(255,235,210,0.08)')}
      />

      {/* Links */}
      <div>
        {links.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
            {links.map((url, i) => {
              let label = url;
              try { label = new URL(url).hostname; } catch {}
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(126,184,214,0.1)', border: '1px solid rgba(126,184,214,0.3)', borderRadius: 5, padding: '2px 6px' }}>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#7EB8D6', textDecoration: 'none' }}>{label}</a>
                  <button onClick={() => removeLink(i)} style={{ background: 'none', border: 'none', color: '#766D62', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
            placeholder="Add link URL…"
            style={{
              flex: 1,
              height: 24,
              padding: '0 6px',
              borderRadius: 5,
              border: '1px solid rgba(255,235,210,0.08)',
              background: 'rgba(255,235,210,0.05)',
              fontSize: 11,
              color: '#FBF5EC',
              outline: 'none',
              fontFamily: 'var(--font-jetbrains-mono)',
            }}
          />
          <button
            onClick={addLink}
            disabled={!linkInput.trim()}
            style={{
              height: 24,
              padding: '0 8px',
              borderRadius: 5,
              border: 'none',
              background: linkInput.trim() ? '#7EB8D6' : 'rgba(255,235,210,0.08)',
              color: linkInput.trim() ? '#17141C' : '#766D62',
              fontSize: 11,
              cursor: linkInput.trim() ? 'pointer' : 'default',
              transition: 'all 150ms ease',
            }}
          >Add</button>
        </div>
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        style={{
          alignSelf: 'flex-start',
          height: 22,
          padding: '0 10px',
          borderRadius: 5,
          border: '1px solid rgba(216,136,120,0.3)',
          background: 'transparent',
          color: '#D88878',
          fontSize: 11,
          fontFamily: 'var(--font-jetbrains-mono)',
          cursor: 'pointer',
          marginTop: 2,
          transition: 'all 150ms ease',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(216,136,120,0.08)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >Delete task</button>
    </div>
  );
}

// ── Sortable Todo Row ─────────────────────────────────────────────────────────

function SortableTodoRow({
  todo,
  expanded,
  onToggle,
  onExpand,
  onDelete,
  onUpdate,
}: {
  todo: ParsedTodo;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Todo> & { parsedLinks?: string[] }) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="todo-row"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          padding: '5px 4px',
          borderRadius: 8,
          transition: 'background 150ms ease',
          background: expanded ? 'rgba(255,235,210,0.05)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'rgba(255,235,210,0.05)';
          const handle = (e.currentTarget as HTMLElement).querySelector('.drag-handle') as HTMLElement | null;
          if (handle) handle.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          if (!expanded) (e.currentTarget as HTMLElement).style.background = 'transparent';
          const handle = (e.currentTarget as HTMLElement).querySelector('.drag-handle') as HTMLElement | null;
          if (handle) handle.style.opacity = '0';
        }}
      >
        {/* Drag handle */}
        <DragHandle listeners={listeners as unknown as Record<string, unknown>} attributes={attributes as unknown as Record<string, unknown>} />

        {/* Checkbox */}
        <button
          onClick={onToggle}
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: `1.5px solid ${todo.completed ? '#8FC89A' : 'rgba(255,235,210,0.2)'}`,
            background: todo.completed ? '#8FC89A' : 'transparent',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 150ms ease',
            marginTop: 2,
          }}
        >
          {todo.completed && (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#17141C" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </button>

        {/* Priority dot */}
        <div style={{ marginTop: 4 }}>
          <PriorityDot priority={todo.priority} />
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            onClick={onExpand}
            style={{
              fontSize: 13,
              color: todo.completed ? '#766D62' : '#EADFD0',
              textDecoration: todo.completed ? 'line-through' : 'none',
              lineHeight: 1.4,
              cursor: 'pointer',
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: expanded ? 'normal' : 'nowrap',
              wordBreak: expanded ? 'break-word' : undefined,
            }}
          >
            {todo.text}
          </span>

          {/* Expand panel */}
          <div style={{
            maxHeight: expanded ? 400 : 0,
            overflow: 'hidden',
            transition: 'max-height 300ms cubic-bezier(0.4,0,0.2,1)',
          }}>
            {expanded && (
              <ExpandedPanel todo={todo} onUpdate={onUpdate} onDelete={onDelete} />
            )}
          </div>
        </div>

        {/* Expand caret */}
        <button
          onClick={onExpand}
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: '#766D62',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'transform 200ms ease',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            marginTop: 1,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── TodoModule ────────────────────────────────────────────────────────────────

export default function TodoModule() {
  const [todos, setTodos] = useState<ParsedTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const swrInitRef = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: todosData } = useLiveData<{ todos: Todo[] }>('/api/todos');

  useEffect(() => {
    if (todosData?.todos && !swrInitRef.current) {
      swrInitRef.current = true;
      setTodos(todosData.todos.map(parseTodo));
      setLoading(false);
    }
  }, [todosData]);

  async function addTodo() {
    const text = addText.trim();
    if (!text) return;
    setAdding(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setTodos((prev) => [...prev, parseTodo(data.todo)]);
      setAddText('');
    } catch {}
    setAdding(false);
  }

  async function toggle(id: string, completed: boolean) {
    setTodos((prev) => prev.map((t) => t.id === id ? { ...t, completed } : t));
    await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
  }

  async function deleteTodo(id: string) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    if (expandedId === id) setExpandedId(null);
    await fetch(`/api/todos/${id}`, { method: 'DELETE' });
  }

  const updateTodo = useCallback(async (id: string, patch: Partial<Todo> & { parsedLinks?: string[] }) => {
    const { parsedLinks, ...rest } = patch;
    const apiPatch: Record<string, unknown> = { ...rest };
    if (parsedLinks !== undefined) {
      apiPatch.links = parsedLinks;
    }

    // Optimistic update
    setTodos((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const updated = { ...t, ...rest };
      if (parsedLinks !== undefined) {
        updated.parsedLinks = parsedLinks;
        updated.links = JSON.stringify(parsedLinks);
      }
      return updated;
    }));

    await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiPatch),
    });
  }, []);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTodos((prev) => {
      const pending = prev.filter((t) => !t.completed);
      const done = prev.filter((t) => t.completed);

      const oldIdx = pending.findIndex((t) => t.id === active.id);
      const newIdx = pending.findIndex((t) => t.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;

      const reordered = arrayMove(pending, oldIdx, newIdx).map((t, i) => ({ ...t, order: i }));

      // Persist
      fetch('/api/todos/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: reordered.map((t) => ({ id: t.id, order: t.order })) }),
      }).catch(() => {});

      return [...reordered, ...done];
    });
  }

  const pending = todos.filter((t) => !t.completed);
  const completed = todos.filter((t) => t.completed);

  const addAction = (
    <button
      onClick={(e) => { e.stopPropagation(); inputRef.current?.focus(); }}
      style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'rgba(255,235,210,0.08)', color: '#A89E91', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}
    >+</button>
  );

  return (
    <CollapsibleModule title={`Tasks${pending.length ? ` · ${pending.length}` : ''}`} index="05" action={addAction}>
      <div style={{ padding: '0 16px 14px' }}>
        {/* Add input */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input
            ref={inputRef}
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); if (e.key === 'Escape') setAddText(''); }}
            placeholder="Add a task…"
            style={{
              flex: 1,
              height: 32,
              background: 'rgba(255,235,210,0.05)',
              border: '1px solid rgba(255,235,210,0.08)',
              borderRadius: 8,
              padding: '0 10px',
              fontSize: 13,
              color: '#FBF5EC',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#7EB8D6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(126,184,214,0.12)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,235,210,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}
          />
          <button
            onClick={addTodo}
            disabled={adding || !addText.trim()}
            style={{
              height: 32,
              padding: '0 12px',
              borderRadius: 8,
              border: 'none',
              background: addText.trim() ? '#7EB8D6' : 'rgba(255,235,210,0.08)',
              color: addText.trim() ? '#17141C' : '#766D62',
              fontSize: 13,
              fontFamily: 'inherit',
              fontWeight: 500,
              cursor: addText.trim() ? 'pointer' : 'default',
              transition: 'all 150ms ease',
            }}
          >Add</button>
        </div>

        {/* Task list */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 32, borderRadius: 8 }} />)}
          </div>
        ) : (
          <div className="thin-scroll" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {todos.length === 0 && (
              <div style={{ fontSize: 12, color: '#766D62', textAlign: 'center', padding: '8px 0', fontFamily: 'var(--font-jetbrains-mono)' }}>No tasks yet</div>
            )}

            {/* Pending — drag-and-drop */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {pending.map((todo) => (
                  <SortableTodoRow
                    key={todo.id}
                    todo={todo}
                    expanded={expandedId === todo.id}
                    onToggle={() => toggle(todo.id, !todo.completed)}
                    onExpand={() => setExpandedId(expandedId === todo.id ? null : todo.id)}
                    onDelete={() => deleteTodo(todo.id)}
                    onUpdate={(patch) => updateTodo(todo.id, patch)}
                  />
                ))}
              </SortableContext>
            </DndContext>

            {/* Completed */}
            {completed.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginTop: 12, marginBottom: 4, letterSpacing: '0.06em' }}>DONE</div>
                {completed.map((todo) => (
                  <SortableTodoRow
                    key={todo.id}
                    todo={todo}
                    expanded={expandedId === todo.id}
                    onToggle={() => toggle(todo.id, !todo.completed)}
                    onExpand={() => setExpandedId(expandedId === todo.id ? null : todo.id)}
                    onDelete={() => deleteTodo(todo.id)}
                    onUpdate={(patch) => updateTodo(todo.id, patch)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </CollapsibleModule>
  );
}
