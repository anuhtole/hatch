'use client';

import { useEffect, useRef } from 'react';

// Generic in-app confirmation dialog. Replaces native confirm() so
// destructive actions stay in the Notion-pivot aesthetic. Renders a
// blurred overlay + centered card with two buttons.

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'default',
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button on open; Esc closes.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onCancel}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        className="modal-panel sb-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sb-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="sb-confirm-title" className="sb-confirm-title">{title}</div>
        {body && <div className="sb-confirm-body">{body}</div>}
        <div className="sb-confirm-actions">
          <button type="button" className="sb-confirm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={'sb-confirm-btn ' + (confirmVariant === 'danger' ? 'danger' : 'primary')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
