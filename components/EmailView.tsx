'use client';

import { useState } from 'react';

type Email = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

type EmailDetail = Email & {
  to: string;
  body: string;          // plain text fallback (kept for legacy callers)
  html?: string | null;  // sanitized server-side; safe for innerHTML
  text?: string | null;  // raw plain-text part if present
};

type ComposeState = { to: string; subject: string; body: string };
type ConfirmState = ComposeState & { isDraft: boolean };

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function extractName(from: string) {
  const match = from.match(/^(.+?)\s*</);
  return match ? match[1].replace(/"/g, '') : from.split('@')[0];
}

function formatLongDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return dateStr; }
}

export default function EmailView() {
  const [query, setQuery] = useState('');
  const [emails, setEmails] = useState<Email[]>([]);
  const [selected, setSelected] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);

  async function fetchEmails() {
    setLoading(true); setError(null); setSelected(null); setSentMsg(null);
    try {
      const params = new URLSearchParams({ account: 'berkeley', maxResults: '20' });
      if (query) params.set('q', query);
      const res = await fetch(`/api/email?${params}`);
      const text = await res.text();
      let data: { emails?: Email[]; error?: string };
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server error (${res.status})`); }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setEmails(data.emails ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch emails');
    } finally { setLoading(false); }
  }

  async function openEmail(email: Email) {
    setCompose(null);
    try {
      const res = await fetch(`/api/email/${email.id}?account=berkeley`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelected(data.email);
    } catch {
      setSelected({ ...email, to: '', body: email.snippet ?? '' });
    }
  }

  async function sendConfirmed() {
    if (!confirm) return;
    setSending(true);
    try {
      const res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'berkeley', to: confirm.to, subject: confirm.subject, body: confirm.body, isDraft: confirm.isDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Sends are queued as a PendingAction (B-10); this confirm dialog showed the
      // full message, so the user's click here is the explicit per-message approval.
      if (data.requiresApproval && data.pendingActionId) {
        const ap = await fetch(`/api/pending-actions/${data.pendingActionId}/approve`, { method: 'POST' });
        const apData = await ap.json().catch(() => ({}));
        if (!ap.ok) throw new Error(apData.error ?? 'Send approval failed');
      }
      setSentMsg(confirm.isDraft ? 'Draft saved.' : 'Email sent.');
      setConfirm(null); setCompose(null);
    } catch (err) {
      setSentMsg(err instanceof Error ? err.message : 'Failed to send.');
      setConfirm(null);
    } finally { setSending(false); }
  }

  const isAuthError = error && (
    error.includes('No OAuth tokens') || error.includes('401') ||
    error.includes('auth') || error.includes('Not connected') || error.includes('reconnect')
  );

  return (
    <div className="sb-surface">
      <div className="sb-surface-head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 className="sb-surface-title">Mail</h1>
          <div className="sb-surface-sub">Berkeley · Gmail · {emails.length} {emails.length === 1 ? 'message' : 'messages'}</div>
        </div>
        <div className="sb-surface-actions">
          <button
            type="button"
            className="sb-btn"
            onClick={fetchEmails}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="sb-btn primary"
            onClick={() => { setCompose({ to: '', subject: '', body: '' }); setSelected(null); }}
          >
            + Compose
          </button>
        </div>
      </div>

      {sentMsg && (
        <div className={'sb-banner ' + (sentMsg.toLowerCase().includes('fail') ? 'error' : 'ok')}>
          {sentMsg}
        </div>
      )}
      {error && (
        <div className="sb-banner error">
          {isAuthError ? 'Google account not connected — please reconnect in Settings.' : error}
        </div>
      )}

      <div className="sb-mail">
        {/* Left: list */}
        <div className="sb-mail-list">
          <div className="sb-mail-search">
            <input
              className="sb-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchEmails()}
              placeholder="Search inbox…"
            />
          </div>
          {emails.length === 0 && !loading && !error ? (
            <div className="sb-mail-empty">
              Click <b>Refresh</b> to load your inbox.
            </div>
          ) : emails.length === 0 && loading ? (
            <div className="sb-mail-empty">Loading…</div>
          ) : (
            emails.map((email) => {
              const isSelected = selected?.id === email.id;
              return (
                <div
                  key={email.id}
                  role="button"
                  tabIndex={0}
                  className={'sb-mail-row' + (isSelected ? ' active' : '')}
                  onClick={() => openEmail(email)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openEmail(email);
                    }
                  }}
                >
                  <div className="sb-mail-row-main">
                    <div className="sb-mail-row-top">
                      <span className="sb-mail-row-sender">{extractName(email.from)}</span>
                      <span className="sb-mail-row-time">{formatDate(email.date)}</span>
                    </div>
                    <div className="sb-mail-row-subject">{email.subject}</div>
                    <div className="sb-mail-row-preview">{email.snippet}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: preview */}
        <div className="sb-mail-pane">
          {!selected ? (
            <div className="sb-mail-pane-empty">Select a message to read</div>
          ) : (
            <article>
              <h2 className="sb-mail-pane-subject">{selected.subject}</h2>
              <div className="sb-mail-pane-meta">
                <b>{extractName(selected.from)}</b>
                <span className="from-email">{selected.from}</span>
                <span className="when">{formatLongDate(selected.date)}</span>
              </div>
              {selected.html
                ? (
                  <div
                    className="sb-mail-pane-body sb-mail-html"
                    dangerouslySetInnerHTML={{ __html: selected.html }}
                  />
                )
                : (selected.text || selected.body)
                  ? <pre className="sb-mail-pane-body" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{selected.text || selected.body}</pre>
                  : <div className="sb-mail-pane-body" style={{ color: 'var(--text-tertiary)' }}>(No content)</div>
              }
              <div className="sb-mail-pane-actions">
                <button
                  type="button"
                  className="sb-btn primary"
                  onClick={() => {
                    setCompose({ to: selected.from, subject: `Re: ${selected.subject}`, body: '' });
                    setSelected(null);
                  }}
                >
                  Reply
                </button>
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
            </article>
          )}
        </div>
      </div>

      {/* Compose overlay */}
      {compose && (
        <>
          <div className="sb-compose-overlay" onClick={() => setCompose(null)} />
          <div className="sb-compose-panel" role="dialog" aria-modal="true">
            <div className="sb-compose-head">
              <div className="sb-compose-title">New message</div>
              <button
                type="button"
                className="sb-mem-close"
                aria-label="Close"
                onClick={() => setCompose(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="sb-compose-body">
              {(['to', 'subject'] as const).map((field) => (
                <div key={field} className="sb-compose-field">
                  <label className="sb-compose-label">{field}</label>
                  <input
                    className="sb-input"
                    value={compose[field]}
                    onChange={(e) => setCompose({ ...compose, [field]: e.target.value })}
                    placeholder={field === 'to' ? 'recipient@example.com' : 'Subject'}
                  />
                </div>
              ))}
              <div className="sb-compose-field">
                <label className="sb-compose-label">Message</label>
                <textarea
                  className="sb-input"
                  value={compose.body}
                  onChange={(e) => setCompose({ ...compose, body: e.target.value })}
                  placeholder="Write your message…"
                  rows={14}
                  style={{ resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }}
                />
              </div>
            </div>
            <div className="sb-compose-foot">
              <button
                type="button"
                className="sb-btn primary"
                onClick={() => setConfirm({ ...compose, isDraft: false })}
                disabled={!compose.to || !compose.subject || !compose.body}
              >
                Send
              </button>
              <button
                type="button"
                className="sb-btn"
                onClick={() => setConfirm({ ...compose, isDraft: true })}
              >
                Save draft
              </button>
              <button
                type="button"
                className="sb-btn"
                onClick={() => setCompose(null)}
                style={{ marginLeft: 'auto' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Confirm send/save */}
      {confirm && (
        <div
          className="modal-backdrop"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}
        >
          <div
            className="modal-panel sb-confirm"
            role="dialog"
            aria-modal="true"
            style={{ width: 'min(460px, 92vw)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sb-confirm-title">
              {confirm.isDraft ? 'Save as draft?' : 'Send this email?'}
            </div>
            <div className="sb-confirm-body" style={{ marginBottom: 12 }}>
              <div><b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>To:</b> {confirm.to}</div>
              <div><b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Subject:</b> {confirm.subject}</div>
            </div>
            <pre className="sb-set-code" style={{ maxHeight: 130, overflowY: 'auto', fontFamily: 'inherit', fontSize: 13 }}>
              {confirm.body.slice(0, 400)}{confirm.body.length > 400 ? '…' : ''}
            </pre>
            <div className="sb-confirm-actions" style={{ marginTop: 16 }}>
              <button type="button" className="sb-confirm-btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="sb-confirm-btn primary"
                onClick={sendConfirmed}
                disabled={sending}
              >
                {sending ? 'Sending…' : confirm.isDraft ? 'Save draft' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
