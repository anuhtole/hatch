'use client';

import { useEffect, useState } from 'react';

// Action types we render. Mirrors PendingActionType in lib/pending-actions.ts.
export type PendingActionType =
  | 'vault_write'
  | 'memory_write'
  | 'pipeline_add'
  | 'pipeline_update';

interface Props {
  actionId: string;
  actionType: PendingActionType;
  summary: string;
}

type RowState = {
  status: 'pending' | 'approved' | 'discarded';
  resultSummary?: string | null;
  resolvedAt?: string | null;
};

type ParsedPayload = Record<string, unknown>;

// Given the action type + its parsed payload, return the read-only context
// fields to show and which field (if any) is user-editable before approval.
// Only memory_write (value) and vault_write (content) are editable — the
// target location is always read-only so an edit can't redirect the write.
function describePayload(type: PendingActionType, p: ParsedPayload | null): {
  fields: Array<{ label: string; value: string }>;
  editableKey: 'value' | 'content' | null;
  editableLabel: string;
} {
  const s = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
  if (!p) return { fields: [], editableKey: null, editableLabel: '' };
  switch (type) {
    case 'memory_write':
      return {
        fields: [{ label: 'Category', value: s(p.category) }, { label: 'Key', value: s(p.key) }],
        editableKey: 'value',
        editableLabel: 'Value to remember',
      };
    case 'vault_write':
      return {
        fields: [{ label: 'Path', value: s(p.path) }, { label: 'Mode', value: s(p.mode) }],
        editableKey: 'content',
        editableLabel: 'File content',
      };
    case 'pipeline_add':
      return {
        fields: [
          { label: 'URL', value: s(p.url) },
          ...(p.notes ? [{ label: 'Notes', value: s(p.notes) }] : []),
        ],
        editableKey: null,
        editableLabel: '',
      };
    case 'pipeline_update':
      return {
        fields: [
          { label: 'Target', value: s(p.cardId ?? p.url) },
          { label: 'New status', value: s(p.newStatus) },
          ...(p.notes ? [{ label: 'Notes', value: s(p.notes) }] : []),
        ],
        editableKey: null,
        editableLabel: '',
      };
  }
}

// Confirmation gate inline card. Mirrors the DraftInlineCard pattern:
// the moment the assistant turn emits a `pending_action` event, this
// card appears in the chat stream with Approve / Discard buttons.
// Audit risk #1 from audit-2026-06-04-trustworthiness.md.

const TYPE_LABEL: Record<PendingActionType, string> = {
  vault_write:     'Vault write',
  memory_write:    'Memory write',
  pipeline_add:    'Pipeline add',
  pipeline_update: 'Pipeline update',
};

function ActionIcon({ type }: { type: PendingActionType }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.85,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (type) {
    case 'vault_write':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/>
          <line x1="9" y1="17" x2="15" y2="17"/>
        </svg>
      );
    case 'memory_write':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      );
    case 'pipeline_add':
      return (
        <svg {...common}>
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      );
    case 'pipeline_update':
      return (
        <svg {...common}>
          <polyline points="23 4 23 10 17 10"/>
          <polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      );
  }
}

export default function PendingActionCard({ actionId, actionType, summary }: Props) {
  const [state, setState] = useState<RowState>({ status: 'pending' });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Full proposed payload (for showing the complete content before approval)
  // and the editable value the user may revise before clicking Approve.
  const [proposed, setProposed] = useState<ParsedPayload | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expanded, setExpanded] = useState(false);

  // On mount, fetch the current row. This handles the reload case (user
  // approved, closed the chat, came back) AND loads the full proposed
  // payload so the pending card can show/edit the complete content.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pending-actions/${actionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (cancelled || !row) return;
        if (row.status === 'approved' || row.status === 'discarded') {
          setState({
            status: row.status,
            resultSummary: row.resultSummary,
            resolvedAt: row.resolvedAt,
          });
          return;
        }
        // Pending: parse the payload for full display + edit pre-fill.
        try {
          const p: ParsedPayload =
            typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          setProposed(p);
          const desc = describePayload(actionType, p);
          if (desc.editableKey) {
            const v = p[desc.editableKey];
            setEditValue(typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
          }
        } catch { /* keep summary-only fallback */ }
      })
      .catch(() => { /* non-fatal — keep pending */ });
    return () => { cancelled = true; };
  }, [actionId, actionType]);

  async function approve() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      // Send the (possibly edited) content so the EDITED value is what gets
      // written. If the type isn't editable, no body is sent and the original
      // proposed payload executes unchanged.
      const desc = describePayload(actionType, proposed);
      const body = desc.editableKey ? { [desc.editableKey]: editValue } : null;
      const res = await fetch(`/api/pending-actions/${actionId}/approve`, {
        method: 'POST',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState({
        status: 'approved',
        resultSummary: data.resultSummary,
        resolvedAt: data.resolvedAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setWorking(false);
    }
  }

  async function discard() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/pending-actions/${actionId}/discard`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState({
        status: 'discarded',
        resolvedAt: data.resolvedAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discard failed');
    } finally {
      setWorking(false);
    }
  }

  const typeLabel = TYPE_LABEL[actionType];

  if (state.status === 'approved') {
    return (
      <div className="sb-pending-card approved">
        <span className="sb-pending-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        <div className="sb-pending-meta">
          <span className="sb-pending-label">{typeLabel} · approved</span>
          <span className="sb-pending-summary">{state.resultSummary || summary}</span>
        </div>
      </div>
    );
  }

  if (state.status === 'discarded') {
    return (
      <div className="sb-pending-card discarded">
        <span className="sb-pending-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </span>
        <div className="sb-pending-meta">
          <span className="sb-pending-label">{typeLabel} · discarded</span>
          <span className="sb-pending-summary">{summary}</span>
        </div>
      </div>
    );
  }

  const desc = describePayload(actionType, proposed);
  const editable = desc.editableKey != null;
  // Offer a Show more / Show less toggle when the editable content is long
  // enough that the collapsed box would scroll.
  const longContent = editable && (editValue.length > 280 || editValue.split('\n').length > 6);

  return (
    <div className="sb-pending-card pending sb-pending-detailed">
      <div className="sb-pending-head">
        <span className="sb-pending-icon">
          <ActionIcon type={actionType} />
        </span>
        <div className="sb-pending-meta">
          <span className="sb-pending-label">Action proposed · {typeLabel}</span>
          <span className="sb-pending-summary">{summary}</span>
        </div>
      </div>

      {proposed && (
        <div className="sb-pending-content">
          {desc.fields.length > 0 && (
            <div className="sb-pending-fields">
              {desc.fields.map((f) => (
                <div key={f.label} className="sb-pending-field">
                  <span className="sb-pending-field-label">{f.label}</span>
                  <span className="sb-pending-field-value">{f.value || '—'}</span>
                </div>
              ))}
            </div>
          )}

          {editable && (
            <div className="sb-pending-editwrap">
              <span className="sb-pending-field-label">
                {desc.editableLabel} <span className="sb-pending-edit-hint">· editable before saving</span>
              </span>
              <textarea
                className="sb-pending-edit"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                disabled={working}
                spellCheck={false}
                style={{ maxHeight: expanded ? 360 : 132 }}
              />
              {longContent && (
                <button
                  type="button"
                  className="sb-pending-expand"
                  onClick={() => setExpanded((x) => !x)}
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && <span className="sb-pending-error">{error}</span>}

      <div className="sb-pending-actions">
        <button
          type="button"
          className="sb-btn primary sb-pending-approve"
          onClick={approve}
          disabled={working}
        >
          {working ? 'Working…' : 'Approve'}
        </button>
        <button
          type="button"
          className="sb-btn sb-pending-discard"
          onClick={discard}
          disabled={working}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
