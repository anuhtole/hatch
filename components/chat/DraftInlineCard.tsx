'use client';

import { useState } from 'react';
import EmailDraftModal from './EmailDraftModal';

type DraftStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'discarded';

interface Props {
  draftId: string;
  initialTo: string;     // raw "to" value from stream (may be JSON array or plain string)
  initialSubject: string;
  /** Current EmailDraft status. Live drafts arrive as 'pending'; rehydrated
   *  cards reflect the persisted status ('sent' | 'discarded' | 'pending'). */
  initialStatus?: DraftStatus;
  /** ISO timestamp the email was sent (for the persisted "Sent" state). */
  sentAt?: string | null;
  /** True when rebuilt from history — suppresses the auto-open-modal that the
   *  live draft uses, so reloading a conversation doesn't pop the editor. */
  fromHistory?: boolean;
}

// Inline card rendered in the chat stream the moment an assistant turn
// emits an `email_draft` segment — and rehydrated from history on reload.
// Auto-opens the EmailDraftModal for fresh (live) drafts so the user can
// review and send. Notion-aesthetic — light card with a hairline border
// and blue Open / green Sent states.

function formatSentAt(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function DraftInlineCard({
  draftId,
  initialTo,
  initialSubject,
  initialStatus = 'pending',
  sentAt = null,
  fromHistory = false,
}: Props) {
  // Only fresh (live) pending drafts auto-open the editor. Rehydrated cards
  // and already-resolved (sent/discarded) drafts stay collapsed.
  const [modalOpen, setModalOpen] = useState(
    !fromHistory && initialStatus === 'pending',
  );
  const [sent, setSent] = useState(initialStatus === 'sent');
  const [sentAtState, setSentAtState] = useState<string | null>(sentAt);
  const discarded = initialStatus === 'discarded';

  // Parse display address from initialTo (may be JSON array string)
  let displayTo = initialTo;
  try {
    const parsed = JSON.parse(initialTo);
    if (Array.isArray(parsed) && parsed.length > 0) {
      displayTo = parsed[0];
      if (parsed.length > 1) displayTo += ` +${parsed.length - 1}`;
    }
  } catch {
    // use as-is
  }

  const sentTime = formatSentAt(sentAtState);

  if (sent) {
    return (
      <div className="sb-draft-card sent">
        <span className="sb-draft-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        <div className="sb-draft-meta">
          <span className="sb-draft-to">Sent to {displayTo}{sentTime ? ` · ${sentTime}` : ''}</span>
          {initialSubject && <span className="sb-draft-subject">{initialSubject}</span>}
        </div>
      </div>
    );
  }

  if (discarded) {
    return (
      <div className="sb-draft-card discarded">
        <span className="sb-draft-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          </svg>
        </span>
        <div className="sb-draft-meta">
          <span className="sb-draft-to">Draft discarded</span>
          {initialSubject && <span className="sb-draft-subject">{initialSubject}</span>}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sb-draft-card">
        <span className="sb-draft-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="m22 7-10 6L2 7"/>
          </svg>
        </span>
        <div className="sb-draft-meta">
          <span className="sb-draft-to">Draft · {displayTo}</span>
          {initialSubject && <span className="sb-draft-subject">{initialSubject}</span>}
        </div>
        <button
          type="button"
          className="sb-btn primary sb-draft-open"
          onClick={() => setModalOpen(true)}
        >
          Open draft
        </button>
      </div>

      {modalOpen && (
        <EmailDraftModal
          draftId={draftId}
          onClose={() => setModalOpen(false)}
          onSent={() => {
            setModalOpen(false);
            setSentAtState(new Date().toISOString());
            setSent(true);
          }}
        />
      )}
    </>
  );
}
