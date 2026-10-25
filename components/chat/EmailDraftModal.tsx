'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ── Types ─────────────────────────────────────────────────────────────────────

type Attachment = {
  source: 'upload' | 'gmail' | 'drive';
  sourceId: string;
  filename: string;
  sizeBytes?: number;
  mimeType?: string;
};

type PickerTab = 'upload' | 'gmail' | 'drive';
type DraftMode = 'edit' | 'review';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s: string) { return EMAIL_RE.test(s.trim()); }

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// ── Chip input ────────────────────────────────────────────────────────────────

function ChipInput({ chips, onChange, placeholder }: {
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

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 10px',
        minHeight: 36, background: 'var(--bg-panel)',
        border: '1px solid var(--hairline)', borderRadius: 8,
        cursor: 'text', alignItems: 'center',
      }}
    >
      {chips.map((chip) => {
        const invalid = !isValidEmail(chip);
        return (
          <span key={chip} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 10px', borderRadius: 999,
            background: invalid ? 'rgba(212,100,92,0.15)' : 'var(--accent-blue-tint)',
            border: `1px solid ${invalid ? 'rgba(212,100,92,0.4)' : 'var(--accent-blue)'}`,
            fontSize: 12, color: invalid ? '#D4645C' : 'var(--text-primary)',
            fontFamily: 'var(--font-jetbrains-mono)',
          }}>
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
        onKeyDown={(e) => {
          if (['Enter', ',', 'Tab'].includes(e.key) && val.trim()) { e.preventDefault(); commit(val); }
          else if (e.key === 'Backspace' && !val && chips.length > 0) onChange(chips.slice(0, -1));
        }}
        onBlur={() => { if (val.trim()) commit(val); }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (text.includes(',') || text.includes(';')) { e.preventDefault(); commit(text); }
        }}
        placeholder={chips.length === 0 ? placeholder : ''}
        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontFamily: 'inherit', flex: 1, minWidth: 120, color: 'var(--text-primary)', padding: '2px 0' }}
      />
    </div>
  );
}

// ── Attachment picker modal ───────────────────────────────────────────────────

function AttachmentPickerModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (files: Attachment[]) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
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
      setDriveResults((data.files ?? []).map((f: { id: string; name: string; size?: number; mimeType?: string }) => ({
        source: 'drive' as const, sourceId: f.id, filename: f.name,
        sizeBytes: f.size ? Number(f.size) : undefined, mimeType: f.mimeType,
      })));
    } catch {}
    setSearching(false);
  }

  async function handleFiles(files: FileList) {
    const atts = await Promise.all(
      Array.from(files).map(async (f) => {
        const fd = new FormData();
        fd.append('file', f);
        const res = await fetch('/api/email/attachments', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`Upload failed for ${f.name}`);
        const data = await res.json();
        return {
          source: 'upload' as const,
          sourceId: data.filePath,   // absolute server-side path
          filename: data.filename,
          sizeBytes: data.sizeBytes,
          mimeType: data.mimeType,
        };
      })
    );
    setSelected((prev) => [...prev, ...atts]);
  }

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 12, fontFamily: 'var(--font-jetbrains-mono)', fontWeight: 700,
    letterSpacing: '0.04em',
    background: active ? 'var(--accent-blue)' : 'transparent',
    color: active ? '#fff' : 'var(--text-tertiary)',
    transition: 'all 0.15s ease',
  });

  const resultList = tab === 'gmail' ? gmailResults : driveResults;

  if (!mounted) return null;
  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FFFFFF', border: '1px solid var(--hairline)', borderRadius: 16, padding: 20, width: 460, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.12)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Add attachments</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 2, marginBottom: 14, background: 'var(--bg-panel)', borderRadius: 8, padding: 3 }}>
          {(['upload', 'gmail', 'drive'] as PickerTab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={tabBtnStyle(tab === t)}>
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
                  border: `2px dashed ${dragging ? 'var(--accent-blue)' : 'var(--hairline)'}`,
                  borderRadius: 10, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
                  background: dragging ? 'var(--accent-blue-tint)' : 'var(--bg-panel)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Drag & drop files here</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>or click to browse</div>
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
              </div>
              {selected.filter((a) => a.source === 'upload').map((att) => (
                <div key={att.sourceId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginTop: 8, borderRadius: 7, background: 'var(--bg-panel)' }}>
                  <span style={{ fontSize: 13 }}>📄</span>
                  <span style={{ fontSize: 12, flex: 1, color: 'var(--text-primary)' }}>{att.filename}</span>
                  {att.sizeBytes && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-jetbrains-mono)' }}>{formatBytes(att.sizeBytes)}</span>}
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
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--hairline)', fontSize: 13, outline: 'none', fontFamily: 'inherit', background: 'var(--bg-panel)', color: 'var(--text-primary)' }}
                />
                <button
                  onClick={tab === 'gmail' ? searchGmail : searchDrive}
                  disabled={searching}
                  style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--accent-blue)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                >Search</button>
              </div>
              {searching && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>Searching…</div>}
              {!searching && resultList.map((att) => {
                const isSelected = selected.some((a) => a.sourceId === att.sourceId);
                return (
                  <div
                    key={att.sourceId}
                    onClick={() => toggle(att)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', background: isSelected ? 'var(--accent-blue-tint)' : 'transparent', transition: 'background 0.12s ease' }}
                  >
                    <input type="checkbox" checked={isSelected} readOnly style={{ accentColor: 'var(--accent-blue)', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, flex: 1, color: 'var(--text-primary)' }}>{att.filename}</span>
                    {att.sizeBytes && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-jetbrains-mono)' }}>{formatBytes(att.sizeBytes)}</span>}
                  </div>
                );
              })}
              {!searching && resultList.length === 0 && (tab === 'gmail' ? gmailQuery : driveQuery) && (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: 20 }}>No results found</div>
              )}
            </>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--hairline-soft)', paddingTop: 12, marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--hairline)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
          <button
            onClick={() => { onAdd(selected); onClose(); }}
            disabled={selected.length === 0}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: selected.length ? 'var(--accent-blue)' : 'var(--bg-hover)', color: selected.length ? '#fff' : 'var(--text-tertiary)', cursor: selected.length ? 'pointer' : 'default', fontSize: 13, fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.15s ease' }}
          >
            Add {selected.length > 0 ? `${selected.length} file${selected.length > 1 ? 's' : ''}` : 'files'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function EmailDraftModal({ draftId, onClose, onSent }: {
  draftId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [mode, setMode] = useState<DraftMode>('edit');
  const [loaded, setLoaded] = useState(false);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Lock scroll + hide chat hero
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove('modal-open');
    };
  }, []);

  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Load draft
  useEffect(() => {
    fetch(`/api/email/drafts/${draftId}`)
      .then((r) => r.json())
      .then((draft) => {
        if (draft.error) return;
        try { setTo(JSON.parse(draft.to || '[]')); } catch { setTo(draft.to ? [draft.to] : []); }
        try { const c = JSON.parse(draft.cc || '[]'); setCc(c); if (c.length) setShowCc(true); } catch {}
        try { const b = JSON.parse(draft.bcc || '[]'); setBcc(b); if (b.length) setShowBcc(true); } catch {}
        setSubject(draft.subject || '');
        setBody(draft.body || '');
        try { setAttachments(JSON.parse(draft.attachments || '[]')); } catch {}
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [draftId]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = bodyRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 180), window.innerHeight * 0.4) + 'px';
  }, [body]);

  // Debounced auto-save
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/email/drafts/${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, cc, bcc, subject, body, attachments }),
        });
      } catch {}
      setSaving(false);
    }, 600);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, to, cc, bcc, subject, body, attachments]);

  useEffect(() => {
    if (loaded) scheduleSave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, body, attachments]);

  // Every provided recipient must be a valid address, and there must be at
  // least one "to". Gates the Send button (UI layer of the defense-in-depth;
  // the send route validates again server-side).
  const recipientsValid =
    to.length > 0 && [...to, ...cc, ...bcc].every((addr) => isValidEmail(addr));

  // The send gate is the in-app "Ready to send" review screen: the user
  // reaches this only by clicking "Send →" there (compose → Done → review →
  // Send). No native confirm() — the review screen IS the confirmation.
  async function handleSend() {
    if (!recipientsValid) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/email/drafts/${draftId}/send`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Send failed');
      // Queued as a PendingAction (B-10); the review screen IS the per-message
      // confirmation, so approve it now.
      if (data.requiresApproval && data.pendingActionId) {
        const ap = await fetch(`/api/pending-actions/${data.pendingActionId}/approve`, { method: 'POST' });
        const apData = await ap.json().catch(() => ({}));
        if (!ap.ok) throw new Error(apData.error ?? 'Send approval failed');
      }
      onSent();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
      setSending(false);
    }
  }

  const canDone = to.length > 0 && subject.trim().length > 0 && body.trim().length > 0;

  // ── Shared style tokens ──────────────────────────────────────────────────────

  // Notion-pivot palette (C6.1). The same const names are kept so the
  // existing inline styles continue to compile; their values now point
  // at the warm-paper surfaces, hairline borders, and accent-blue
  // tokens defined in app/globals.css.
  const surface = '#FFFFFF';
  const border = 'var(--hairline-soft)';
  const textPrimary = 'var(--text-primary)';
  const textSecondary = 'var(--text-secondary)';
  const textMuted = 'var(--text-tertiary)';
  const accent = 'var(--accent-blue)';
  const accentInk = 'var(--accent-blue-ink)';
  const lightFieldBg = 'var(--bg-panel)';
  const lightFieldBorder = 'var(--hairline)';

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 7,
    border: `1px solid ${lightFieldBorder}`, background: lightFieldBg,
    fontSize: 14, fontFamily: 'inherit', color: textPrimary, outline: 'none',
    boxSizing: 'border-box', transition: 'border-color 0.12s ease',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: textMuted, fontFamily: 'var(--font-jetbrains-mono)',
    letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5,
  };

  // ── Review mode ──────────────────────────────────────────────────────────────

  if (!mounted) return null;

  if (mode === 'review') {
    return createPortal(
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, background: surface, border: '1px solid var(--hairline)', borderRadius: 16, boxShadow: '0 10px 40px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '18px 24px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: textPrimary }}>✉ Ready to send</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: textMuted, fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
          </div>

          {/* Body */}
          <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>To</div>
              <div style={{ fontSize: 14, color: textPrimary }}>{to.join(', ') || '—'}</div>
            </div>
            {cc.length > 0 && <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Cc</div>
              <div style={{ fontSize: 14, color: textPrimary }}>{cc.join(', ')}</div>
            </div>}
            {bcc.length > 0 && <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Bcc</div>
              <div style={{ fontSize: 14, color: textPrimary }}>{bcc.join(', ')}</div>
            </div>}
            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>Subject</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: textPrimary }}>{subject || '(no subject)'}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>Message</div>
              <div style={{ fontSize: 14, color: textSecondary, lineHeight: 1.65, whiteSpace: 'pre-wrap', maxHeight: '40vh', overflowY: 'auto' }}>{body}</div>
            </div>
            {attachments.length > 0 && (
              <div>
                <div style={labelStyle}>Attachments</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {attachments.map((att, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'var(--bg-hover)', borderRadius: 7, fontSize: 12, color: textSecondary }}>
                      <span>📄</span> {att.filename}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sendError && <div style={{ marginTop: 14, fontSize: 13, color: '#D4645C', background: 'rgba(212,100,92,0.1)', borderRadius: 8, padding: '8px 12px' }}>{sendError}</div>}
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 24px', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
            <button onClick={() => setMode('edit')} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid var(--hairline)', background: 'transparent', color: textSecondary, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>← Back to edit</button>
            <button
              onClick={handleSend}
              disabled={sending || !recipientsValid}
              title={!recipientsValid ? 'Enter a valid recipient address to send' : undefined}
              style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: (sending || !recipientsValid) ? 'var(--hairline)' : 'var(--accent-blue)', color: (sending || !recipientsValid) ? textMuted : '#fff', cursor: (sending || !recipientsValid) ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600, boxShadow: 'none' }}
            >{sending ? 'Sending…' : 'Send →'}</button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ── Edit mode ────────────────────────────────────────────────────────────────

  return createPortal(
    <>
      {showPicker && (
        <AttachmentPickerModal
          onClose={() => setShowPicker(false)}
          onAdd={(files) => setAttachments((prev) => {
            const next = [...prev];
            for (const f of files) {
              if (!next.some((a) => a.sourceId === f.sourceId)) next.push(f);
            }
            return next;
          })}
        />
      )}

      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', background: surface, border: '1px solid var(--hairline)', borderRadius: 16, boxShadow: '0 10px 40px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {/* Header */}
          <div style={{ padding: '18px 24px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: textPrimary }}>✉ Compose</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {saving && <span style={{ fontSize: 11, color: textMuted, fontStyle: 'italic' }}>saving…</span>}
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: textMuted, fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
            </div>
          </div>

          {/* Form */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', minHeight: 0 }}>
            {!loaded ? (
              <div style={{ fontSize: 13, color: textMuted, textAlign: 'center', padding: 40 }}>Loading…</div>
            ) : (
              <>
                {/* To */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={labelStyle}>To</span>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {!showCc && <button onClick={() => setShowCc(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent, fontSize: 11, fontFamily: 'inherit' }}>+ Cc</button>}
                      {!showBcc && <button onClick={() => setShowBcc(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent, fontSize: 11, fontFamily: 'inherit' }}>+ Bcc</button>}
                    </div>
                  </div>
                  <ChipInput chips={to} onChange={setTo} placeholder="recipient@example.com" />
                </div>

                {showCc && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={labelStyle}>Cc</div>
                    <ChipInput chips={cc} onChange={setCc} placeholder="cc@example.com" />
                  </div>
                )}
                {showBcc && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={labelStyle}>Bcc</div>
                    <ChipInput chips={bcc} onChange={setBcc} placeholder="bcc@example.com" />
                  </div>
                )}

                {/* Subject */}
                <div style={{ marginBottom: 14 }}>
                  <div style={labelStyle}>Subject</div>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                    style={{ ...fieldStyle, fontSize: 16, fontWeight: 500 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = accent; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--hairline)'; }}
                  />
                </div>

                {/* Body */}
                <div style={{ marginBottom: 14 }}>
                  <div style={labelStyle}>Message</div>
                  <textarea
                    ref={bodyRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write your message…"
                    style={{ ...fieldStyle, resize: 'none', minHeight: 180, lineHeight: 1.65, fontSize: 14 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = accent; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--hairline)'; }}
                  />
                </div>

                {/* Attachments */}
                {(attachments.length > 0 || true) && (
                  <div>
                    <div style={labelStyle}>Attachments</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 170px)', gap: 8 }}>
                      {attachments.map((att, i) => (
                        <div key={i} style={{ position: 'relative', padding: 12, background: 'var(--bg-panel)', border: '1px solid var(--hairline-soft)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 4 }}
                          onMouseEnter={(e) => { const btn = e.currentTarget.querySelector<HTMLButtonElement>('.rm-btn'); if (btn) btn.style.display = 'flex'; }}
                          onMouseLeave={(e) => { const btn = e.currentTarget.querySelector<HTMLButtonElement>('.rm-btn'); if (btn) btn.style.display = 'none'; }}
                        >
                          <div style={{ fontSize: 22, marginBottom: 2 }}>📄</div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename}</div>
                          {att.sizeBytes && <div style={{ fontSize: 10, color: textMuted }}>{formatBytes(att.sizeBytes)}</div>}
                          <div style={{ fontSize: 10, color: accent, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-jetbrains-mono)' }}>{att.source}</div>
                          <button
                            className="rm-btn"
                            onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                            style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%', background: 'var(--text-tertiary)', border: 'none', color: '#fff', cursor: 'pointer', display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: 12, lineHeight: 1 }}
                          >×</button>
                        </div>
                      ))}

                      {/* Add files card */}
                      <div
                        onClick={() => setShowPicker(true)}
                        style={{ border: '1.5px dashed var(--hairline)', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 90, color: textMuted, cursor: 'pointer', transition: 'all 0.15s ease', fontSize: 22 }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; e.currentTarget.style.color = accent; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--hairline)'; e.currentTarget.style.color = textMuted; }}
                      >+</div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 24px', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
            <button
              onClick={() => setMode('review')}
              disabled={!canDone}
              style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: canDone ? 'var(--accent-blue)' : 'var(--bg-hover)', color: canDone ? '#fff' : textMuted, cursor: canDone ? 'pointer' : 'default', fontSize: 13, fontFamily: 'inherit', fontWeight: 600, boxShadow: canDone ? 'none' : 'none', transition: 'all 0.15s ease' }}
            >Done →</button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
