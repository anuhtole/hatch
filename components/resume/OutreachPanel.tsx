'use client';

/**
 * components/resume/OutreachPanel.tsx — per-lab outreach queue (B-10).
 *
 * Flow: discovery shortlist (read-only; produced by `npm run resume:discover`)
 * → the USER picks recipients (picks become queue entries; discovery never
 * auto-drafts) → Draft (pacing-gated, guard:outreach-gated, becomes an
 * email_send PendingAction) → approval card showing EVERYTHING (recipient,
 * subject + body editable, attachment + hash) → Approve = the single
 * executor sends; Deny = archived with a reason (suppression context only).
 * HATCH NEVER SENDS without the per-message approval click here.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  MAX_DRAFTS_PER_DAY,
  MIN_HOURS_BETWEEN_SENDS_SAME_LAB,
} from '@/lib/resume/outreach-constants';

// B-44: folded to the app's slate-blue tokens (app/globals.css :root) — retires the
// pre-pivot #7EB8D6 palette drift. green/red kept as literals (no token equivalent).
const C = {
  card: '#FFFFFF',
  cardAlt: 'var(--accent-blue-tint)',
  text: 'var(--text-primary)',
  dim: 'var(--text-secondary)',
  accent: 'var(--accent-blue)',
  accentInk: 'var(--accent-blue-ink)',
  green: '#5BB98C', red: '#D4645C',
  border: 'var(--hairline)',
};
const mono = 'var(--font-jetbrains-mono), ui-monospace, monospace';

interface GroupContact { kind: 'email' | 'application-page'; value: string; sourceUrl: string }
interface RankedGroup {
  name: string; pi?: string; topics: string[]; people: string[];
  undergradProcess?: string; contact: GroupContact | null; sourceUrls: string[];
  fitScore: number;
  rationales: Array<{ claimId: string; sourceUrl: string; text: string }>;
  accessibility: { statedUndergradProgram?: string; joinPage?: string; undergradCoauthors?: string };
}
interface QueueEntry {
  id: string;
  recipient: { name: string; group: string; email: string; emailSourceUrl: string; sourceUrls: string[] };
  status: 'queued' | 'drafted' | 'pending_send' | 'sent' | 'denied';
  reason?: string; draftPath?: string; pendingActionId?: string;
  createdAt: string; draftedAt?: string; sentAt?: string;
}
interface DraftSentence { text: string; kind: string; sourceUrl?: string; claimIds?: string[] }
interface OutreachDraft {
  id: string; subject: string; body: string; sentences: DraftSentence[];
  attachmentPath: string; attachmentSha256: string;
  recipient: QueueEntry['recipient'];
}

export default function OutreachPanel({ lab, mode = 'panel' }: { lab: string; mode?: 'panel' | 'detail' }) {
  const [shortlist, setShortlist] = useState<RankedGroup[] | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null); // B-44: master-detail selection (by group name)
  const [discoveryHint, setDiscoveryHint] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, OutreachDraft>>({});
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denying, setDenying] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');

  const loadAll = useCallback(async () => {
    setError(null);
    const [dRes, qRes] = await Promise.all([
      fetch(`/api/resume/outreach/discovery?lab=${encodeURIComponent(lab)}`),
      fetch(`/api/resume/outreach/queue?lab=${encodeURIComponent(lab)}`),
    ]);
    if (dRes.ok) {
      const d = await dRes.json();
      setShortlist(d.shortlist ?? []);
      setDiscoveryHint(null);
    } else {
      setShortlist(null);
      const d = await dRes.json().catch(() => ({}));
      setDiscoveryHint(d.error ?? `no discovery for ${lab}`);
    }
    if (qRes.ok) {
      const q = await qRes.json();
      const entries: QueueEntry[] = q.queue ?? [];
      setQueue(entries);
      // Load draft artifacts for pending sends (survives page reloads).
      for (const e of entries) {
        if (e.status === 'pending_send' && e.draftPath) {
          const r = await fetch(`/api/resume/artifact/${encodeURIComponent(lab)}/outreach/${encodeURIComponent(e.id)}.json`);
          if (r.ok) {
            const draft = (await r.json()) as OutreachDraft;
            setDrafts((prev) => ({ ...prev, [e.id]: draft }));
            setEdits((prev) => (prev[e.id] ? prev : { ...prev, [e.id]: { subject: draft.subject, body: draft.body } }));
          }
        }
      }
    }
  }, [lab]);

  useEffect(() => { setDrafts({}); setEdits({}); void loadAll(); }, [loadAll]);

  const pick = async (g: RankedGroup) => {
    if (g.contact?.kind !== 'email') return;
    setBusy(`pick:${g.name}`); setError(null);
    try {
      const r = await fetch('/api/resume/outreach/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lab,
          recipient: {
            name: g.pi ?? g.name, group: g.name, email: g.contact.value,
            emailSourceUrl: g.contact.sourceUrl, sourceUrls: g.sourceUrls,
          },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      await loadAll();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const draftFor = async (entry: QueueEntry) => {
    setBusy(`draft:${entry.id}`); setError(null);
    try {
      const r = await fetch('/api/resume/outreach/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lab, queueId: entry.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const vio = (d.violations ?? []) as Array<{ check: string; detail: string }>;
        throw new Error(d.error + (vio.length ? '\n' + vio.map((v) => `[${v.check}] ${v.detail}`).join('\n') : ''));
      }
      setDrafts((prev) => ({ ...prev, [entry.id]: d.draft }));
      setEdits((prev) => ({ ...prev, [entry.id]: { subject: d.draft.subject, body: d.draft.body } }));
      await loadAll();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const approveSend = async (entry: QueueEntry) => {
    if (!entry.pendingActionId) return;
    setBusy(`approve:${entry.id}`); setError(null);
    try {
      const edit = edits[entry.id];
      const r = await fetch(`/api/pending-actions/${entry.pendingActionId}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit ? { subject: edit.subject, body: edit.body } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      await loadAll();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const deny = async (entry: QueueEntry) => {
    setBusy(`deny:${entry.id}`); setError(null);
    try {
      if (entry.pendingActionId) {
        const r = await fetch(`/api/pending-actions/${entry.pendingActionId}/discard`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: denyReason }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${r.status}`); }
      } else {
        const r = await fetch('/api/resume/outreach/queue', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lab, id: entry.id, reason: denyReason }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${r.status}`); }
      }
      setDenying(null); setDenyReason('');
      await loadAll();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const title = (label: string) => (
    <div style={{ fontSize: 11, fontFamily: mono, color: C.dim, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '18px 0 10px' }}>
      {label}
    </div>
  );
  const box = (children: React.ReactNode, key?: string) => (
    <div key={key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
      {children}
    </div>
  );
  const btn = (label: string, onClick: () => void, opts: { disabled?: boolean; color?: string } = {}) => (
    <button onClick={onClick} disabled={opts.disabled}
      style={{
        background: opts.disabled ? C.cardAlt : (opts.color ?? C.accent), color: opts.disabled ? C.dim : '#FFFFFF',
        border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontFamily: mono,
        fontWeight: 700, cursor: opts.disabled ? 'default' : 'pointer', marginRight: 8,
      }}>
      {label}
    </button>
  );

  const queuedIds = new Set(queue.filter((e) => e.status !== 'denied').map((e) => e.id));
  const slugOf = (g: RankedGroup) =>
    (g.pi ?? g.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

  // B-44: inert future-feature slot styling (presentational only — these controls call NOTHING).
  const slot: React.CSSProperties = { border: `1px dashed ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.cardAlt };
  const slotTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, marginBottom: 3 };
  const slotBody: React.CSSProperties = { fontSize: 11, color: C.dim, fontFamily: mono, marginBottom: 8 };
  const slotBtn: React.CSSProperties = { background: C.card, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 11, fontFamily: mono, fontWeight: 700, cursor: 'not-allowed' };

  return (
    <div>
      {mode === 'panel' && title(`Outreach — ${lab}`)}
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>
        You pick recipients; nothing is drafted without a pick, and nothing is EVER sent without
        your per-message approval below. Pacing: ≤{MAX_DRAFTS_PER_DAY} drafts/day,
        ≥{MIN_HOURS_BETWEEN_SENDS_SAME_LAB}h between sends to the same lab.
      </div>
      {error && box(
        <pre style={{ color: C.red, fontSize: 12, fontFamily: mono, whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>,
      )}

      {/* ── Discovery shortlist (user picks) ─────────────────────────────────── */}
      {discoveryHint && box(
        <div style={{ fontSize: 12, color: C.dim, fontFamily: mono }}>{discoveryHint}</div>,
      )}
      {shortlist && shortlist.length > 0 && (() => {
        const sel = shortlist.find((g) => g.name === selectedEntry) ?? null;
        return (
          <>
            <div style={{ fontSize: 12, color: C.dim, margin: '4px 0 8px' }}>
              Shortlist for your approval — select a group to review its fit, then queue published-contact recipients:
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* ── List (clickable rows) ─────────────────────────────────────── */}
              <div style={{ flex: '1 1 280px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {shortlist.map((g) => {
                  const isSel = g.name === selectedEntry;
                  const hasEmail = g.contact?.kind === 'email';
                  return (
                    <button
                      key={g.name}
                      onClick={() => setSelectedEntry(g.name)}
                      aria-pressed={isSel}
                      style={{
                        textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                        border: `1px solid ${isSel ? C.accent : C.border}`, background: isSel ? C.cardAlt : C.card,
                        borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit',
                      }}
                    >
                      <span title={hasEmail ? 'published email' : 'application page only'}
                        style={{ width: 12, textAlign: 'center', fontFamily: mono, fontSize: 12, color: hasEmail ? C.green : C.dim }}>
                        {hasEmail ? '✓' : '·'}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{g.name}</span>
                        {g.pi && <span style={{ color: C.dim, fontSize: 12 }}> — PI: {g.pi}</span>}
                      </span>
                      <span style={{ fontFamily: mono, fontSize: 11, color: C.accent }}>{g.fitScore}/100</span>
                    </button>
                  );
                })}
              </div>

              {/* ── Entry detail (master-detail) ──────────────────────────────── */}
              <div style={{ flex: '2 1 340px', minWidth: 280 }}>
                {!sel ? (
                  <div style={{ fontSize: 12, color: C.dim, fontFamily: mono, padding: '8px 2px' }}>
                    Select a group to see its fit rationale and contact options.
                  </div>
                ) : box(
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{sel.name}{sel.pi ? <span style={{ color: C.dim, fontWeight: 400 }}> — PI: {sel.pi}</span> : null}</div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: C.accent }}>fit {sel.fitScore}/100</div>
                    </div>
                    {sel.topics.length > 0 && <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{sel.topics.join(' · ')}</div>}
                    <div style={{ fontSize: 12, marginTop: 8 }}>
                      {sel.rationales.map((r, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          · {r.text}{' '}
                          <span style={{ fontFamily: mono, fontSize: 10, color: C.dim }}>
                            [{r.claimId} | <a href={r.sourceUrl} target="_blank" style={{ color: C.dim }}>source ↗</a>]
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {sel.contact?.kind === 'email' ? (
                        <>
                          <span style={{ fontFamily: mono, fontSize: 11, color: C.dim }}>
                            published contact: {sel.contact.value} (<a href={sel.contact.sourceUrl} target="_blank" style={{ color: C.dim }}>source ↗</a>)
                          </span>
                          {queuedIds.has(slugOf(sel))
                            ? <span style={{ fontFamily: mono, fontSize: 11, color: C.green }}>✓ in queue</span>
                            : btn(busy === `pick:${sel.name}` ? '…' : 'Queue for outreach', () => void pick(sel), { disabled: busy !== null })}
                        </>
                      ) : (
                        <span style={{ fontFamily: mono, fontSize: 11, color: C.dim }}>
                          application page only{sel.contact ? <> — <a href={sel.contact.value} target="_blank" style={{ color: C.accent }}>{sel.contact.value} ↗</a></> : ' (no published route)'} · no email outreach
                        </span>
                      )}
                    </div>

                    {/* ── Inert future-feature slots (B-44; presentational only — call NOTHING) ── */}
                    <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                      {sel.contact?.kind === 'email' ? (
                        <div style={slot}>
                          <div style={slotTitle}>Send to published contact</div>
                          <div style={slotBody}>Will route to {sel.contact.value} via per-message approval — coming in B-45.</div>
                          <button type="button" disabled style={slotBtn}>Send (B-45)</button>
                        </div>
                      ) : (
                        <div style={slot}>
                          <div style={slotTitle}>Send to published contact</div>
                          <div style={slotBody}>No published route — no email outreach for this group.</div>
                        </div>
                      )}
                      <div style={slot}>
                        <div style={slotTitle}>Research email draft</div>
                        <div style={slotBody}>Grounded outreach email body — coming in B-46.</div>
                        <button type="button" disabled style={slotBtn}>Draft (B-46)</button>
                      </div>
                      <div style={slot}>
                        <div style={slotTitle}>Re-target roster</div>
                        <div style={slotBody}>Re-scope by seniority / responsiveness — coming soon.</div>
                        <button type="button" disabled style={slotBtn}>Re-target</button>
                      </div>
                    </div>
                  </div>,
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Queue ─────────────────────────────────────────────────────────────── */}
      {queue.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: C.dim, margin: '12px 0 8px' }}>Queue:</div>
          {queue.map((e) => {
            const draft = drafts[e.id];
            const edit = edits[e.id];
            return box(
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{e.recipient.name} <span style={{ color: C.dim, fontWeight: 400 }}>· {e.recipient.email}</span></div>
                  <div style={{
                    fontFamily: mono, fontSize: 11,
                    color: e.status === 'sent' ? C.green : e.status === 'denied' ? C.red : e.status === 'pending_send' ? C.accent : C.dim,
                  }}>
                    {e.status}{e.sentAt ? ` ${new Date(e.sentAt).toLocaleString()}` : ''}
                  </div>
                </div>
                {e.status === 'denied' && e.reason && (
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 4, fontFamily: mono }}>denied: {e.reason}</div>
                )}

                {e.status === 'queued' && (
                  <div style={{ marginTop: 8 }}>
                    {btn(busy === `draft:${e.id}` ? 'drafting… (grounded + guarded)' : 'Draft outreach email', () => void draftFor(e), { disabled: busy !== null })}
                    {btn('Remove', () => { setDenying(e.id); setDenyReason(''); }, { color: C.cardAlt })}
                  </div>
                )}

                {e.status === 'pending_send' && draft && edit && (
                  <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                    <div style={{ fontSize: 11, fontFamily: mono, color: C.accent, marginBottom: 6 }}>
                      PENDING SEND — review everything; nothing goes out without your approval
                    </div>
                    <div style={{ fontSize: 12, fontFamily: mono, color: C.dim, marginBottom: 6 }}>
                      to: {e.recipient.name} &lt;{e.recipient.email}&gt; · published at{' '}
                      <a href={e.recipient.emailSourceUrl} target="_blank" style={{ color: C.dim }}>source ↗</a>
                    </div>
                    <input
                      value={edit.subject}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [e.id]: { ...edit, subject: ev.target.value } }))}
                      style={{ width: '100%', boxSizing: 'border-box', background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 13, fontWeight: 600, marginBottom: 6 }}
                    />
                    <textarea
                      value={edit.body}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [e.id]: { ...edit, body: ev.target.value } }))}
                      rows={Math.min(14, edit.body.split('\n').length + 4)}
                      style={{ width: '100%', boxSizing: 'border-box', background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 13, lineHeight: 1.5 }}
                    />
                    <details style={{ margin: '6px 0' }}>
                      <summary style={{ fontSize: 11, color: C.dim, cursor: 'pointer', fontFamily: mono }}>per-sentence grounding ({draft.sentences.length})</summary>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                        {draft.sentences.map((s, i) => (
                          <div key={i} style={{ marginBottom: 3, fontFamily: mono }}>
                            [{s.kind}] {s.text} {s.sourceUrl ? `← ${s.sourceUrl}` : ''}{s.claimIds?.length ? `← ${s.claimIds.join(', ')}` : ''}
                          </div>
                        ))}
                      </div>
                    </details>
                    <div style={{ fontSize: 11, fontFamily: mono, color: C.dim, marginBottom: 8 }}>
                      attachment: Anatole-Seychal-Resume.docx (last green run, sha256 {draft.attachmentSha256.slice(0, 12)}…)
                      — recipient &amp; attachment are not editable; edits to the text are re-checked at send.
                    </div>
                    {btn(busy === `approve:${e.id}` ? 'sending…' : 'Approve & send', () => void approveSend(e), { disabled: busy !== null, color: C.green })}
                    {btn('Deny', () => { setDenying(e.id); setDenyReason(''); }, { color: C.red })}
                  </div>
                )}

                {denying === e.id && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      value={denyReason}
                      onChange={(ev) => setDenyReason(ev.target.value)}
                      placeholder="reason (archived as context — nothing auto-learns from it)"
                      style={{ flex: 1, minWidth: 240, background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 12 }}
                    />
                    {btn(busy === `deny:${e.id}` ? '…' : 'Confirm deny', () => void deny(e), { disabled: busy !== null, color: C.red })}
                    {btn('Cancel', () => setDenying(null), { color: C.cardAlt })}
                  </div>
                )}
              </div>,
              e.id,
            );
          })}
        </>
      )}
    </div>
  );
}
