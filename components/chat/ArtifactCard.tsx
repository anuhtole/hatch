'use client';

import { useState } from 'react';
import type { ArtifactSegment } from '@/lib/chat-context';

/**
 * ArtifactCard (B-13) — inline verified-artifact card for the chat stream.
 *
 * Renders the typed payload emitted by resume_artifact (or rehydrated from a
 * persisted message's artifactTarget). DISPLAY ONLY: every byte shown or
 * downloaded comes from /api/resume/artifact, which re-verifies last-green
 * hashes before serving. The card never carries resume content itself.
 */

const C = {
  surface: '#FFFFFF',
  border:  '#E8E4DF',
  accent:  '#7EB8D6',
  accentBg:'#E8F2F8',
  ink:     '#1A1A1A',
  dim:     '#6B6B7B',
  mute:    '#9B9BAB',
  success: '#5BB98C',
  mono:    'var(--font-jetbrains-mono), monospace',
};

function DownloadButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 7,
        border: `1px solid ${C.border}`, background: C.surface,
        color: C.ink, fontSize: 12, fontFamily: C.mono,
        textDecoration: 'none', whiteSpace: 'nowrap',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      {label}
    </a>
  );
}

export default function ArtifactCard({ seg }: { seg: ArtifactSegment }) {
  const [pdfOpen, setPdfOpen] = useState(false);
  const completed = new Date(seg.completedAt);
  const completedLabel = isNaN(completed.getTime()) ? seg.completedAt : completed.toLocaleString();

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface,
      padding: 14, maxWidth: 520, width: '100%',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: C.success,
          boxShadow: `0 0 5px ${C.success}`, flexShrink: 0,
        }} />
        <span style={{ fontSize: 12, fontFamily: C.mono, fontWeight: 700, color: C.ink, letterSpacing: '0.03em' }}>
          VERIFIED RESUME — {seg.target.toUpperCase()}
        </span>
        <a
          href={seg.studioUrl}
          style={{ marginLeft: 'auto', fontSize: 11, fontFamily: C.mono, color: C.accent, textDecoration: 'none' }}
        >
          View full studio →
        </a>
      </div>

      {/* First-page preview (visual-gate PNG) */}
      {seg.previewPngUrl && (
        <a href={seg.pdfUrl ?? seg.docxUrl} target="_blank" rel="noopener noreferrer" title="Open full document">
          <img
            src={seg.previewPngUrl}
            alt={`First page of the ${seg.target} resume`}
            style={{
              width: '100%', maxHeight: 340, objectFit: 'contain', objectPosition: 'top',
              border: `1px solid ${C.border}`, borderRadius: 8, background: '#FAFAF8',
              display: 'block', marginBottom: 10,
            }}
          />
        </a>
      )}

      {/* Embedded PDF view (toggle) */}
      {seg.pdfUrl && (
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={() => setPdfOpen((o) => !o)}
            style={{
              padding: '5px 12px', borderRadius: 7, border: `1px solid ${C.accent}`,
              background: pdfOpen ? C.accent : C.accentBg, color: pdfOpen ? '#fff' : C.accent,
              fontSize: 12, fontFamily: C.mono, cursor: 'pointer', marginRight: 8,
            }}
          >
            {pdfOpen ? 'Close PDF view' : 'View PDF inline'}
          </button>
          <a
            href={seg.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, fontFamily: C.mono, color: C.accent, textDecoration: 'none' }}
          >
            Open in new tab ↗
          </a>
          {pdfOpen && (
            <iframe
              src={seg.pdfUrl}
              title={`${seg.target} resume PDF`}
              style={{
                width: '100%', height: 480, border: `1px solid ${C.border}`,
                borderRadius: 8, marginTop: 8, background: '#FAFAF8',
              }}
            />
          )}
        </div>
      )}

      {/* Downloads */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {seg.pdfUrl && <DownloadButton href={seg.pdfUrl} label="Resume .pdf" />}
        <DownloadButton href={seg.docxUrl} label="Resume .docx" />
        <DownloadButton href={seg.coverLetterUrl} label="Cover letter .docx" />
      </div>

      {/* Provenance line: sha + run timestamp */}
      <div style={{ fontSize: 10.5, fontFamily: C.mono, color: C.mute, lineHeight: 1.7 }}>
        run {completedLabel} · docx sha256 {seg.sha256.slice(0, 12)}…
        {seg.pdfSha256 ? ` · pdf sha256 ${seg.pdfSha256.slice(0, 12)}…` : ''}
        {' · hashes re-verified server-side on fetch'}
      </div>
    </div>
  );
}
