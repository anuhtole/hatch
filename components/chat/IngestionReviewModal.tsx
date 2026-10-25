'use client';

/**
 * components/chat/IngestionReviewModal.tsx
 *
 * Human-in-the-loop approval modal for file ingestion.
 * Rendered via createPortal so it floats above all layout.
 *
 * Props:
 *   file      — upload response from /api/upload
 *   onApprove — called with final { title, content, summary, tags }
 *   onReject  — dismiss without ingesting
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface UploadedFile {
  id: string;
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  extractedText: string;
  extractedPreview: string;
  pageCount?: number;
  wordCount: number;
  method: string;
}

export interface IngestPayload {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
}

interface Props {
  file: UploadedFile;
  onApprove: (payload: IngestPayload) => void;
  onReject: () => void;
}

// ── TagEditor ──────────────────────────────────────────────────────────────────

function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');

  function addTag() {
    const t = input.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput('');
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 999,
            background: '#E8F2F8',
            border: '1px solid rgba(126,184,214,0.4)',
            color: '#3A7A9C',
            fontSize: 12,
            fontFamily: 'var(--font-jetbrains-mono)',
          }}
        >
          {tag}
          <button
            onClick={() => removeTag(tag)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
              color: '#7EB8D6',
              fontSize: 14,
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
        }}
        onBlur={addTag}
        placeholder="Add tag…"
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 12,
          fontFamily: 'var(--font-jetbrains-mono)',
          color: '#1A1A1A',
          minWidth: 80,
        }}
      />
    </div>
  );
}

// ── FileIcon ───────────────────────────────────────────────────────────────────

function fileIconLabel(mimeType: string, filename: string): string {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  if (mimeType === 'application/pdf' || ext === '.pdf') return 'PDF';
  if (mimeType.includes('word') || ext === '.docx') return 'DOC';
  if (mimeType.includes('spreadsheet') || ext === '.xlsx' || ext === '.xls') return 'XLS';
  if (mimeType.includes('presentation') || ext === '.pptx') return 'PPT';
  if (mimeType.startsWith('image/')) return 'IMG';
  if (mimeType === 'application/epub+zip' || ext === '.epub') return 'EPUB';
  if (mimeType === 'application/zip' || ext === '.zip') return 'ZIP';
  return 'TXT';
}

function fileIconColor(label: string): string {
  const colors: Record<string, string> = {
    PDF: '#D4645C',
    DOC: '#3A7A9C',
    XLS: '#5BB98C',
    PPT: '#E0A458',
    IMG: '#9B59B6',
    EPUB: '#7EB8D6',
    ZIP: '#6B6B7B',
    TXT: '#9B9BAB',
  };
  return colors[label] ?? '#9B9BAB';
}

function FileIcon({ mimeType, filename }: { mimeType: string; filename: string }) {
  const label = fileIconLabel(mimeType, filename);
  const color = fileIconColor(label);
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: `${color}22`,
        border: `1px solid ${color}44`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 10,
        fontFamily: 'var(--font-jetbrains-mono)',
        fontWeight: 700,
        color,
        letterSpacing: '0.05em',
      }}
    >
      {label}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────────

export function IngestionReviewModal({ file, onApprove, onReject }: Props) {
  const [title, setTitle] = useState(file.filename.replace(/\.[^.]+$/, ''));
  const [content, setContent] = useState(file.extractedText);
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadingAnalysis, setLoadingAnalysis] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Fetch Claude analysis on mount
  useEffect(() => {
    let cancelled = false;
    async function analyze() {
      try {
        const res = await fetch('/api/knowledge/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: file.extractedText, filename: file.filename }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { summary: string; suggestedTags: string[] };
        if (!cancelled) {
          setSummary(data.summary ?? '');
          setTags(data.suggestedTags ?? []);
        }
      } catch (err) {
        console.error('[analyze]', err);
        if (!cancelled) setSummary('');
      } finally {
        if (!cancelled) setLoadingAnalysis(false);
      }
    }
    analyze();
    return () => { cancelled = true; };
  }, [file.extractedText, file.filename]);

  // Close on backdrop click
  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onReject();
    },
    [onReject],
  );

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onReject();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onReject]);

  async function handleApprove() {
    setSubmitting(true);
    try {
      await fetch('/api/knowledge/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: file.id, title, content, summary, tags }),
      });
      onApprove({ id: file.id, title, content, summary, tags });
    } catch (err) {
      console.error('[ingest]', err);
    } finally {
      setSubmitting(false);
    }
  }

  function fmt(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  const modal = (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(26,20,14,0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: 16,
          border: '1px solid #E8E4DF',
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
          animation: 'slideUp 0.22s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid #E8E4DF',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <FileIcon mimeType={file.mimeType} filename={file.filename} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 2 }}>
              Review before ingesting
            </div>
            <div style={{ fontSize: 13, color: '#6B6B7B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file.filename} · {fmt(file.size)}
              {file.wordCount > 0 && ` · ${file.wordCount.toLocaleString()} words`}
              {file.pageCount && ` · ${file.pageCount} pages`}
            </div>
          </div>
          <button
            onClick={onReject}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9B9BAB',
              fontSize: 20,
              lineHeight: 1,
              padding: 4,
              borderRadius: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Title */}
          <label style={{ display: 'block', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', color: '#9B9BAB', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Title
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid #E8E4DF',
                fontSize: 14,
                fontFamily: 'var(--font-eb-garamond)',
                color: '#1A1A1A',
                outline: 'none',
                boxSizing: 'border-box',
                background: '#FAFAF8',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#7EB8D6'; }}
              onBlur={(e) => { e.target.style.borderColor = '#E8E4DF'; }}
            />
          </label>

          {/* Auto summary */}
          <label style={{ display: 'block', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', color: '#9B9BAB', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Summary {loadingAnalysis && <span style={{ color: '#7EB8D6' }}>· analyzing…</span>}
            </div>
            {loadingAnalysis ? (
              <div style={{ height: 60, borderRadius: 8, background: 'linear-gradient(90deg, #F0EDE8 25%, #E8E4DF 50%, #F0EDE8 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
            ) : (
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid #E8E4DF',
                  fontSize: 13,
                  fontFamily: 'var(--font-eb-garamond)',
                  color: '#1A1A1A',
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  background: '#FAFAF8',
                  lineHeight: 1.6,
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => { e.target.style.borderColor = '#7EB8D6'; }}
                onBlur={(e) => { e.target.style.borderColor = '#E8E4DF'; }}
              />
            )}
          </label>

          {/* Tags */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', color: '#9B9BAB', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Tags
            </div>
            <div style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E8E4DF', background: '#FAFAF8', minHeight: 38 }}>
              <TagEditor tags={tags} onChange={setTags} />
            </div>
          </div>

          {/* Extracted content */}
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)', color: '#9B9BAB', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Extracted content
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid #E8E4DF',
                fontSize: 12,
                fontFamily: 'var(--font-jetbrains-mono)',
                color: '#3A3A3A',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
                background: '#FAFAF8',
                lineHeight: 1.6,
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#7EB8D6'; }}
              onBlur={(e) => { e.target.style.borderColor = '#E8E4DF'; }}
            />
          </label>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #E8E4DF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>
            Will save to <code style={{ color: '#6B6B7B' }}>vault/07-ingested/</code>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onReject}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                border: '1px solid #E8E4DF',
                background: '#FFFFFF',
                color: '#6B6B7B',
                fontSize: 13,
                fontFamily: 'var(--font-eb-garamond)',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = '#F5F0EB'; }}
              onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = '#FFFFFF'; }}
            >
              Discard
            </button>
            <button
              onClick={handleApprove}
              disabled={submitting || loadingAnalysis || !title.trim()}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                background: submitting || loadingAnalysis ? '#B8D9E8' : '#7EB8D6',
                color: '#FFFFFF',
                fontSize: 13,
                fontFamily: 'var(--font-eb-garamond)',
                fontWeight: 600,
                cursor: submitting || loadingAnalysis ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!submitting && !loadingAnalysis) (e.target as HTMLButtonElement).style.background = '#5FA8CC';
              }}
              onMouseLeave={(e) => {
                if (!submitting && !loadingAnalysis) (e.target as HTMLButtonElement).style.background = '#7EB8D6';
              }}
            >
              {submitting ? 'Ingesting…' : 'Ingest into knowledge base'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
