'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Attachment = {
  source: 'upload' | 'gmail' | 'drive';
  sourceId: string;
  filename: string;
  sizeBytes?: number;
  mimeType?: string;
};

type DraftMode = 'edit' | 'review' | 'sent';

interface DraftState {
  mode: DraftMode;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: Attachment[];
  showCc: boolean;
  showBcc: boolean;
  sentAt: string | null;
  saveStatus: 'saved' | 'saving' | 'unsaved';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(s: string) {
  return EMAIL_RE.test(s.trim());
}

function timeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function sourceLabel(source: Attachment['source']): string {
  if (source === 'gmail') return 'Gmail';
  if (source === 'drive') return 'Drive';
  return 'Upload';
}

function sourceBadgeColor(source: Attachment['source']): string {
  if (source === 'gmail') return '#DB4437';
  if (source === 'drive') return '#0F9D58';
  return '#7EB8D6';
}

// ── Chip input ────────────────────────────────────────────────────────────────

function ChipInput({
  chips, onChange, placeholder,
}: {
  chips: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(raw: string) {
    const trimmed = raw.trim().replace(/[,;]+$/, '');
    if (!trimmed) return;
    const parts = trimmed.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    const next = [...chips];
    for (const p of parts) {
      if (!next.includes(p)) next.push(p);
    }
    onChange(next);
    setVal('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') {
      if (val.trim()) { e.preventDefault(); commit(val); }
    } else if (e.key === 'Backspace' && !val && chips.length > 0) {
      onChange(chips.slice(0, -1));
    }
  }

  function onBlur() {
    if (val.trim()) commit(val);
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (text.includes(',') || text.includes(';') || text.includes(' ')) {
      e.preventDefault();
      commit(text);
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        padding: '5px 8px',
        minHeight: 34,
        background: '#F8F5F1',
        border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: 7,
        cursor: 'text',
        alignItems: 'center',
      }}
    >
      {chips.map((chip) => {
        const invalid = !isValidEmail(chip);
        return (
          <span
            key={chip}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 999,
              background: invalid ? 'rgba(212,100,92,0.12)' : 'rgba(126,184,214,0.15)',
              border: `1px solid ${invalid ? 'rgba(212,100,92,0.4)' : 'rgba(126,184,214,0.4)'}`,
              fontSize: 12,
              color: invalid ? '#D4645C' : '#1A1A1A',
              fontFamily: 'var(--font-jetbrains-mono)',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {chip}
            <button
              onClick={(e) => { e.stopPropagation(); onChange(chips.filter((c) => c !== chip)); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', opacity: 0.6, fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center' }}
            >×</button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPaste={onPaste}
        placeholder={chips.length === 0 ? placeholder : ''}
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 13,
          fontFamily: 'inherit',
          flex: 1,
          minWidth: 120,
          color: '#1A1A1A',
          padding: '2px 0',
        }}
      />
    </div>
  );
}

// ── Attachment picker modal ───────────────────────────────────────────────────

type PickerTab = 'upload' | 'gmail' | 'drive';

function AttachmentPickerModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (files: Attachment[]) => void;
}) {
  const [tab, setTab] = useState<PickerTab>('upload');
  const [dragging, setDragging] = useState(false);
  const [gmailQuery, setGmailQuery] = useState('');
  const [driveQuery, setDriveQuery] = useState('');
  const [gmailResults, setGmailResults] = useState<Attachment[]>([]);
  const [driveResults, setDriveResults] = useState<Attachment[]>([]);
  const [selected, setSelected] = useState<Attachment[]>([]);
  const [searching, setSearching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggle(att: Attachment) {
    setSelected((prev) =>
      prev.some((a) => a.sourceId === att.sourceId)
        ? prev.filter((a) => a.sourceId !== att.sourceId)
        : [...prev, att]
    );
  }

  async function searchGmail() {
    if (!gmailQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/email?account=berkeley&q=${encodeURIComponent(gmailQuery + ' has:attachment')}&limit=10`);
      const data = await res.json();
      // emails array → flatten attachments
      const atts: Attachment[] = [];
      for (const email of data.emails ?? []) {
        for (const att of email.attachments ?? []) {
          atts.push({ source: 'gmail', sourceId: `${email.id}:${att.attachmentId}`, filename: att.filename });
        }
      }
      setGmailResults(atts);
    } catch {}
    setSearching(false);
  }

  async function searchDrive() {
    if (!driveQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/drive?q=${encodeURIComponent(driveQuery)}&limit=10`);
      const data = await res.json();
      const atts: Attachment[] = (data.files ?? []).map((f: { id: string; name: string; size?: number; mimeType?: string }) => ({
        source: 'drive' as const,
        sourceId: f.id,
        filename: f.name,
        sizeBytes: f.size ? Number(f.size) : undefined,
        mimeType: f.mimeType,
      }));
      setDriveResults(atts);
    } catch {}
    setSearching(false);
  }

  function handleFiles(files: FileList) {
    const atts: Attachment[] = Array.from(files).map((f) => ({
      source: 'upload' as const,
      sourceId: URL.createObjectURL(f),
      filename: f.name,
      sizeBytes: f.size,
      mimeType: f.type,
    }));
    setSelected((prev) => [...prev, ...atts]);
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'var(--font-jetbrains-mono)',
    fontWeight: 700,
    letterSpacing: '0.04em',
    background: active ? '#7EB8D6' : 'transparent',
    color: active ? '#fff' : '#9B9BAB',
    transition: 'all 0.15s ease',
  });

  const resultList = tab === 'gmail' ? gmailResults : driveResults;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FFFFFF', borderRadius: 14, padding: 20, width: 440, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.18)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>Add attachments</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B9BAB', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: '#F5F0EB', borderRadius: 8, padding: 3 }}>
          {(['upload', 'gmail', 'drive'] as PickerTab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
              {t === 'upload' ? '↑ Upload' : t === 'gmail' ? '✉ Gmail' : '◎ Drive'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'upload' && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? '#7EB8D6' : 'rgba(0,0,0,0.12)'}`,
                  borderRadius: 10,
                  padding: '32px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragging ? 'rgba(126,184,214,0.06)' : '#F8F5F1',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
                <div style={{ fontSize: 13, color: '#6B6B7B' }}>Drag & drop files here</div>
                <div style={{ fontSize: 12, color: '#9B9BAB', marginTop: 4 }}>or click to browse</div>
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
              </div>
              {selected.filter((a) => a.source === 'upload').map((att) => (
                <div key={att.sourceId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginTop: 8, borderRadius: 7, background: '#F5F0EB' }}>
                  <span style={{ fontSize: 13 }}>📄</span>
                  <span style={{ fontSize: 12, flex: 1, color: '#1A1A1A' }}>{att.filename}</span>
                  {att.sizeBytes && <span style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>{formatBytes(att.sizeBytes)}</span>}
                </div>
              ))}
            </>
          )}

          {(tab === 'gmail' || tab === 'drive') && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input
                  value={tab === 'gmail' ? gmailQuery : driveQuery}
                  onChange={(e) => tab === 'gmail' ? setGmailQuery(e.target.value) : setDriveQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (tab === 'gmail' ? searchGmail() : searchDrive())}
                  placeholder={tab === 'gmail' ? 'Search email attachments…' : 'Search Drive files…'}
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#F8F5F1', color: '#1A1A1A' }}
                />
                <button
                  onClick={tab === 'gmail' ? searchGmail : searchDrive}
                  disabled={searching}
                  style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: '#7EB8D6', color: '#fff', cursor: 'pointer', fontSize: 13 }}
                >Search</button>
              </div>
              {searching && <div style={{ fontSize: 12, color: '#9B9BAB', textAlign: 'center', padding: 16 }}>Searching…</div>}
              {!searching && resultList.map((att) => {
                const isSelected = selected.some((a) => a.sourceId === att.sourceId);
                return (
                  <div
                    key={att.sourceId}
                    onClick={() => toggle(att)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', background: isSelected ? 'rgba(126,184,214,0.1)' : 'transparent', transition: 'background 0.12s ease' }}
                  >
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(att)} style={{ accentColor: '#7EB8D6', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, flex: 1, color: '#1A1A1A' }}>{att.filename}</span>
                    {att.sizeBytes && <span style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>{formatBytes(att.sizeBytes)}</span>}
                  </div>
                );
              })}
              {!searching && resultList.length === 0 && (tab === 'gmail' ? gmailQuery : driveQuery) && (
                <div style={{ fontSize: 12, color: '#9B9BAB', textAlign: 'center', padding: 20 }}>No results found</div>
              )}
            </>
          )}
        </div>

        <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12, marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: 'transparent', color: '#6B6B7B', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
          <button
            onClick={() => { onAdd(selected); onClose(); }}
            disabled={selected.length === 0}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: selected.length ? '#7EB8D6' : '#E8E4DF', color: selected.length ? '#fff' : '#9B9BAB', cursor: selected.length ? 'pointer' : 'default', fontSize: 13, fontFamily: 'inherit', fontWeight: 500, transition: 'all 0.15s ease' }}
          >
            Add {selected.length > 0 ? `${selected.length} file${selected.length > 1 ? 's' : ''}` : 'files'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EmailDraftCard({
  draftId,
  initialTo,
  initialSubject,
  initialBody,
  initialAttachments,
}: {
  draftId: string;
  initialTo: string;
  initialSubject: string;
  initialBody: string;
  initialAttachments: Array<{ filename: string; sizeBytes: number; mimeType: string }>;
}) {
  const [state, setState] = useState<DraftState>(() => {
    // Parse to as array (may be a single address string)
    const toArr = initialTo ? [initialTo].filter(Boolean) : [];
    return {
      mode: 'edit',
      to: toArr,
      cc: [],
      bcc: [],
      subject: initialSubject,
      body: initialBody,
      attachments: initialAttachments.map((a) => ({
        source: 'upload' as const,
        sourceId: '',
        filename: a.filename,
        sizeBytes: a.sizeBytes,
        mimeType: a.mimeType,
      })),
      showCc: false,
      showBcc: false,
      sentAt: null,
      saveStatus: 'saved',
    };
  });

  const [showPicker, setShowPicker] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false); // for sent collapsed state

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = bodyRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 180), window.innerHeight * 0.5) + 'px';
  }, [state.body, state.mode]);

  // Debounced auto-save
  const scheduleSave = useCallback((patch: Partial<DraftState>) => {
    setState((prev) => ({ ...prev, ...patch, saveStatus: 'unsaved' }));
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setState((prev) => ({ ...prev, saveStatus: 'saving' }));
      try {
        await fetch(`/api/email/drafts/${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: [...(patch.to ?? [])],
            cc: [...(patch.cc ?? [])],
            bcc: [...(patch.bcc ?? [])],
            subject: patch.subject,
            body: patch.body,
          }),
        });
        setState((prev) => ({ ...prev, saveStatus: 'saved' }));
      } catch {
        setState((prev) => ({ ...prev, saveStatus: 'unsaved' }));
      }
    }, 500);
  }, [draftId]);

  function update(patch: Partial<DraftState>) {
    scheduleSave({ ...state, ...patch });
  }

  async function handleSend() {
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/email/drafts/${draftId}/send`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Send failed');
      // Queued as a PendingAction (B-10); the confirm step the user just clicked
      // through showed the full draft — approve it per-message now.
      if (data.requiresApproval && data.pendingActionId) {
        const ap = await fetch(`/api/pending-actions/${data.pendingActionId}/approve`, { method: 'POST' });
        const apData = await ap.json().catch(() => ({}));
        if (!ap.ok) throw new Error(apData.error ?? 'Send approval failed');
      }
      const sentAt = new Date().toISOString();
      setState((prev) => ({ ...prev, mode: 'sent', sentAt }));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      setShowConfirm(false);
    }
  }

  // ── Sent state ──────────────────────────────────────────────────────────────

  if (state.mode === 'sent') {
    return (
      <div style={{
        background: '#FFFFFF',
        border: '1px solid rgba(91,185,140,0.35)',
        borderRadius: 12,
        marginTop: 8,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      }}>
        <div
          onClick={() => setExpanded((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 12, color: '#5BB98C', fontFamily: 'var(--font-jetbrains-mono)', fontWeight: 700 }}>✓ SENT</span>
          <span style={{ fontSize: 13, color: '#6B6B7B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            to {state.to.join(', ')} · {state.sentAt ? timeAgo(state.sentAt) : ''}
          </span>
          <span style={{ fontSize: 12, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>{state.subject}</span>
          {state.attachments.length > 0 && (
            <span style={{ fontSize: 11, color: '#9B9BAB' }}>📎 {state.attachments.length}</span>
          )}
          <span style={{ fontSize: 12, color: '#9B9BAB', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
        </div>
        {expanded && (
          <div style={{ padding: '0 14px 14px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#9B9BAB', marginTop: 12, marginBottom: 6 }}>
              <span style={{ color: '#6B6B7B' }}>To: </span>{state.to.join(', ')}
            </div>
            <div style={{ fontSize: 13, color: '#1A1A1A', fontWeight: 500, marginBottom: 10 }}>{state.subject}</div>
            <div style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{state.body}</div>
          </div>
        )}
      </div>
    );
  }

  // ── Review mode ─────────────────────────────────────────────────────────────

  if (state.mode === 'review') {
    return (
      <div style={{
        background: '#FFFFFF',
        border: '1px solid rgba(126,184,214,0.4)',
        borderRadius: 12,
        padding: 18,
        marginTop: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      }}>
        <div style={{ fontSize: 10, color: '#7EB8D6', fontFamily: 'var(--font-jetbrains-mono)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 14 }}>REVIEW DRAFT</div>

        <div style={{ fontSize: 13, marginBottom: 5 }}>
          <span style={{ color: '#9B9BAB' }}>To: </span>
          <span style={{ color: '#1A1A1A' }}>{state.to.join(', ') || '—'}</span>
        </div>
        {state.cc.length > 0 && (
          <div style={{ fontSize: 13, marginBottom: 5 }}>
            <span style={{ color: '#9B9BAB' }}>Cc: </span>
            <span style={{ color: '#1A1A1A' }}>{state.cc.join(', ')}</span>
          </div>
        )}
        {state.bcc.length > 0 && (
          <div style={{ fontSize: 13, marginBottom: 5 }}>
            <span style={{ color: '#9B9BAB' }}>Bcc: </span>
            <span style={{ color: '#1A1A1A' }}>{state.bcc.join(', ')}</span>
          </div>
        )}
        <div style={{ fontSize: 13, marginBottom: 14 }}>
          <span style={{ color: '#9B9BAB' }}>Subject: </span>
          <span style={{ color: '#1A1A1A', fontWeight: 500 }}>{state.subject || '—'}</span>
        </div>

        <div style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.65, whiteSpace: 'pre-wrap', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12, marginBottom: state.attachments.length ? 12 : 16, maxHeight: '50vh', overflowY: 'auto' }}>
          {state.body}
        </div>

        {state.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {state.attachments.map((att, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 7, background: '#F5F0EB', border: '1px solid rgba(0,0,0,0.07)' }}>
                <span style={{ fontSize: 12 }}>📎</span>
                <span style={{ fontSize: 12, color: '#1A1A1A' }}>{att.filename}</span>
                <span style={{ fontSize: 10, color: '#fff', background: sourceBadgeColor(att.source), borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-jetbrains-mono)' }}>{sourceLabel(att.source)}</span>
              </div>
            ))}
          </div>
        )}

        {sendError && (
          <div style={{ fontSize: 12, color: '#D4645C', marginBottom: 10, padding: '8px 10px', background: 'rgba(212,100,92,0.08)', borderRadius: 7 }}>
            {sendError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={sending || state.to.length === 0}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: 'none',
              background: (sending || state.to.length === 0) ? '#E8E4DF' : 'linear-gradient(135deg, #E8B87A, #D4A066)',
              color: (sending || state.to.length === 0) ? '#9B9BAB' : '#17141C',
              cursor: (sending || state.to.length === 0) ? 'default' : 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
              fontWeight: 600,
              boxShadow: state.to.length > 0 ? '0 2px 8px rgba(232,184,122,0.3)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >{sending ? 'Sending…' : 'Send'}</button>
          <button
            onClick={() => setState((prev) => ({ ...prev, mode: 'edit' }))}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: 'transparent', color: '#6B6B7B', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
          >Back to edit</button>
        </div>

        {/* Confirm overlay */}
        {showConfirm && (
          <div
            onClick={() => setShowConfirm(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#FFFFFF', borderRadius: 14, padding: 24, maxWidth: 360, boxShadow: '0 12px 48px rgba(0,0,0,0.18)' }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, color: '#1A1A1A' }}>Send this email?</div>
              <div style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.6, marginBottom: 20 }}>
                To: <strong>{state.to.join(', ')}</strong><br />
                Subject: <strong>{state.subject}</strong>
                {state.attachments.length > 0 && <><br />{state.attachments.length} attachment{state.attachments.length > 1 ? 's' : ''}</>}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowConfirm(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: 'transparent', color: '#6B6B7B', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
                <button
                  onClick={handleSend}
                  style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #E8B87A, #D4A066)', color: '#17141C', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}
                >Send now</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Edit mode ───────────────────────────────────────────────────────────────

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: '#9B9BAB',
    fontFamily: 'var(--font-jetbrains-mono)',
    letterSpacing: '0.04em',
    marginBottom: 4,
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    borderRadius: 7,
    border: '1px solid rgba(0,0,0,0.1)',
    background: '#F8F5F1',
    fontSize: 13,
    fontFamily: 'inherit',
    color: '#1A1A1A',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  };

  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.borderColor = '#7EB8D6';
      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(126,184,214,0.15)';
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.1)';
      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
    },
  };

  return (
    <>
      {showPicker && (
        <AttachmentPickerModal
          onClose={() => setShowPicker(false)}
          onAdd={(files) => {
            const next = [...state.attachments, ...files];
            update({ attachments: next });
          }}
        />
      )}

      <div style={{
        background: '#FFFFFF',
        border: '1px solid rgba(126,184,214,0.4)',
        borderRadius: 12,
        padding: 18,
        marginTop: 8,
        boxShadow: '0 2px 12px rgba(126,184,214,0.12)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 10, color: '#7EB8D6', fontFamily: 'var(--font-jetbrains-mono)', fontWeight: 700, letterSpacing: '0.08em' }}>✉ DRAFT</span>
          <span style={{ fontSize: 10, color: state.saveStatus === 'saved' ? '#5BB98C' : state.saveStatus === 'saving' ? '#9B9BAB' : '#E0A458', fontFamily: 'var(--font-jetbrains-mono)' }}>
            {state.saveStatus === 'saved' ? '✓ saved' : state.saveStatus === 'saving' ? 'saving…' : '●'}
          </span>
        </div>

        {/* To */}
        <div style={{ marginBottom: 10 }}>
          <div style={labelStyle}>TO</div>
          <ChipInput chips={state.to} onChange={(to) => update({ to })} placeholder="recipient@example.com" />
        </div>

        {/* Cc / Bcc toggles */}
        {(!state.showCc || !state.showBcc) && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            {!state.showCc && (
              <button onClick={() => setState((p) => ({ ...p, showCc: true }))} style={{ fontSize: 11, color: '#7EB8D6', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>+ Cc</button>
            )}
            {!state.showBcc && (
              <button onClick={() => setState((p) => ({ ...p, showBcc: true }))} style={{ fontSize: 11, color: '#7EB8D6', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>+ Bcc</button>
            )}
          </div>
        )}

        {state.showCc && (
          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>CC</div>
            <ChipInput chips={state.cc} onChange={(cc) => update({ cc })} placeholder="cc@example.com" />
          </div>
        )}

        {state.showBcc && (
          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>BCC</div>
            <ChipInput chips={state.bcc} onChange={(bcc) => update({ bcc })} placeholder="bcc@example.com" />
          </div>
        )}

        {/* Subject */}
        <div style={{ marginBottom: 10 }}>
          <div style={labelStyle}>SUBJECT</div>
          <input
            value={state.subject}
            onChange={(e) => update({ subject: e.target.value })}
            style={fieldStyle}
            {...focusHandlers}
          />
        </div>

        {/* Body */}
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>MESSAGE</div>
          <textarea
            ref={bodyRef}
            value={state.body}
            onChange={(e) => update({ body: e.target.value })}
            style={{
              ...fieldStyle,
              resize: 'none',
              minHeight: 180,
              maxHeight: '50vh',
              lineHeight: 1.6,
              fontSize: 15,
              overflowY: 'auto',
            }}
            {...focusHandlers}
          />
        </div>

        {/* Attachments */}
        {state.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {state.attachments.map((att, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 7, background: '#F5F0EB', border: '1px solid rgba(0,0,0,0.07)' }}>
                <span style={{ fontSize: 12 }}>📎</span>
                <span style={{ fontSize: 12, color: '#1A1A1A' }}>{att.filename}</span>
                {att.sizeBytes && <span style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>{formatBytes(att.sizeBytes)}</span>}
                <span style={{ fontSize: 10, color: '#fff', background: sourceBadgeColor(att.source), borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-jetbrains-mono)' }}>{sourceLabel(att.source)}</span>
                <button
                  onClick={() => update({ attachments: state.attachments.filter((_, j) => j !== i) })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B9BAB', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* Action bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setState((prev) => ({ ...prev, mode: 'review' }))}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #7EB8D6, #6BACC8)', color: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500, boxShadow: '0 2px 6px rgba(126,184,214,0.3)', transition: 'transform 0.1s ease' }}
            onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.97)'; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
          >Done</button>
          <button
            onClick={() => setShowPicker(true)}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: 'transparent', color: '#6B6B7B', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
          >📎 Attach</button>
        </div>
      </div>
    </>
  );
}
