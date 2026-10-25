'use client';

import { useState, useEffect, useRef } from 'react';

type Doc = {
  id: string;
  title: string;
  source: string;
  courseName: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  lastSyncedAt: string | null;
  content: string;
};

function fileIcon(doc: Doc): { emoji: string; tileClass: string } {
  const name = (doc.fileName ?? doc.title ?? '').toLowerCase();
  const type = (doc.fileType ?? '').toLowerCase();
  if (type.includes('pdf') || name.endsWith('.pdf')) return { emoji: '📕', tileClass: 'icon-tile-red' };
  if (type.includes('image') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(name)) return { emoji: '🖼️', tileClass: 'icon-tile-purple' };
  if (name.endsWith('.md') || name.endsWith('.markdown')) return { emoji: '📝', tileClass: 'icon-tile-blue' };
  if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) return { emoji: '📊', tileClass: 'icon-tile-green' };
  if (name.endsWith('.pptx') || name.endsWith('.ppt')) return { emoji: '📊', tileClass: 'icon-tile-amber' };
  if (doc.source === 'gmail') return { emoji: '✉️', tileClass: 'icon-tile-amber' };
  if (doc.source === 'canvas') return { emoji: '🎓', tileClass: 'icon-tile-blue' };
  if (doc.source === 'drive') return { emoji: '💾', tileClass: 'icon-tile-green' };
  return { emoji: '📄', tileClass: 'icon-tile-blue' };
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: string | null) {
  if (!d) return 'Never';
  const date = new Date(d);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SkeletonCard() {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ width: '70%', height: 12, borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: '40%', height: 10, borderRadius: 6 }} />
      </div>
    </div>
  );
}

export default function FilesView() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [docCount, setDocCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'canvas' | 'gmail' | 'manual'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadStatus();
    searchDocs('');
  }, []);

  async function loadStatus() {
    try {
      const res = await fetch('/api/sync/status');
      const data = await res.json();
      setDocCount(data.documentCount ?? 0);
    } catch {}
  }

  async function searchDocs(q: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q || '', limit: '80' });
      const res = await fetch(`/api/knowledge?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setDocs(data.documents ?? []);
    } catch {}
    setLoading(false);
  }

  async function triggerSync() {
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      await loadStatus();
      await searchDocs(query);
    } catch {}
    setSyncing(false);
  }

  async function handleFileDrop(files: FileList) {
    for (const file of Array.from(files)) {
      const text = await file.text();
      await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: file.name,
          content: text,
          source: 'manual',
          metadata: { fileName: file.name, fileType: file.type, fileSize: file.size },
        }),
      });
    }
    await searchDocs(query);
  }

  const filtered = docs.filter(d => filter === 'all' || d.source === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F8F6F4' }}>

      {/* Header */}
      <div style={{ padding: '24px 32px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 600, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em' }}>Knowledge Base</h1>
            <p style={{ fontSize: 13, color: '#9B9BAB', margin: '2px 0 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
              {docCount} documents indexed
            </p>
          </div>
          <button
            onClick={triggerSync}
            disabled={syncing}
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              border: 'none',
              background: syncing ? '#F0EDEA' : '#1A1A1A',
              color: syncing ? '#9B9BAB' : '#fff',
              cursor: syncing ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'inherit',
              transition: 'all 200ms ease',
            }}
          >
            {syncing ? 'Syncing…' : '↻ Sync'}
          </button>
        </div>

        {/* Pill tabs */}
        <div className="pill-tabs" style={{ marginBottom: 20 }}>
          {(['all', 'canvas', 'gmail', 'manual'] as const).map((tab) => (
            <button
              key={tab}
              className={`pill-tab${filter === tab ? ' active' : ''}`}
              onClick={() => setFilter(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 24 }}>
          <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9B9BAB', pointerEvents: 'none' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); searchDocs(e.target.value); }}
            placeholder="Search knowledge base…"
            style={{
              width: '100%',
              paddingLeft: 40,
              paddingRight: 14,
              paddingTop: 10,
              paddingBottom: 10,
              background: '#fff',
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 12,
              fontSize: 14,
              fontFamily: 'inherit',
              color: '#1A1A1A',
              outline: 'none',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              transition: 'all 180ms ease',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px' }}>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleFileDrop(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? '#7EB8D6' : 'rgba(0,0,0,0.08)'}`,
            borderRadius: 16,
            padding: '22px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'rgba(126,184,214,0.06)' : '#fff',
            marginBottom: 24,
            transition: 'all 200ms ease',
          }}
        >
          <div style={{ fontSize: 13, color: dragOver ? '#5BA3C9' : '#9B9BAB', fontWeight: dragOver ? 500 : 400 }}>
            {dragOver ? 'Drop to upload' : '↑ Drop files or click to upload'}
          </div>
          <div style={{ fontSize: 11, color: '#C0C0CC', marginTop: 4 }}>Supports .txt, .md, .csv</div>
          <input ref={fileInputRef} type="file" multiple accept=".txt,.md,.csv" style={{ display: 'none' }}
            onChange={(e) => e.target.files && handleFileDrop(e.target.files)} />
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📂</div>
            <p style={{ color: '#9B9BAB', fontSize: 14, margin: 0 }}>No documents found. Sync Canvas or upload files.</p>
          </div>
        ) : (
          <div className="card-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((doc) => {
              const { emoji, tileClass } = fileIcon(doc);
              const isHovered = hoveredId === doc.id;
              return (
                <div
                  key={doc.id}
                  className="fade-up"
                  onClick={() => setSelected(doc)}
                  onMouseEnter={() => setHoveredId(doc.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    background: '#fff',
                    borderRadius: 16,
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    cursor: 'pointer',
                    border: '1px solid rgba(0,0,0,0.04)',
                    boxShadow: isHovered ? '0 8px 24px rgba(0,0,0,0.1)' : '0 1px 4px rgba(0,0,0,0.04)',
                    transform: isHovered ? 'translateY(-2px)' : 'none',
                    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  <div className={`icon-tile ${tileClass}`} style={{ fontSize: 20, flexShrink: 0 }}>
                    {emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                      {doc.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {doc.courseName && (
                        <span className="badge badge-blue" style={{ fontSize: 10.5, fontFamily: 'var(--font-jetbrains-mono)' }}>
                          {doc.courseName.length > 24 ? doc.courseName.slice(0, 24) + '…' : doc.courseName}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>{doc.source}</span>
                      {doc.fileSize != null && doc.fileSize > 0 && (
                        <>
                          <span style={{ fontSize: 11, color: '#D8D4D0' }}>·</span>
                          <span style={{ fontSize: 11, color: '#9B9BAB' }}>{formatBytes(doc.fileSize)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', flexShrink: 0 }}>
                    {formatDate(doc.lastSyncedAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Slide-over: Document detail */}
      {selected && (
        <>
          <div className="slideover-overlay" onClick={() => setSelected(null)} />
          <div className="slideover-panel">
            <div style={{ padding: 32 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                <div style={{ flex: 1, marginRight: 16 }}>
                  <div className={`icon-tile ${fileIcon(selected).tileClass}`} style={{ fontSize: 22, marginBottom: 14 }}>
                    {fileIcon(selected).emoji}
                  </div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1A1A1A', margin: 0, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                    {selected.title}
                  </h2>
                </div>
                <button onClick={() => setSelected(null)} style={{ width: 32, height: 32, borderRadius: 999, border: 'none', background: '#F0EDEA', color: '#6B6B7B', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#E8E4DF'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#F0EDEA'; }}>
                  ×
                </button>
              </div>

              {/* Metadata grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
                {[
                  { label: 'Source', value: selected.source },
                  { label: 'Synced', value: formatDate(selected.lastSyncedAt) },
                  { label: 'Size', value: formatBytes(selected.fileSize) || 'Unknown' },
                  { label: 'Course', value: selected.courseName ?? 'None' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: '#F8F6F4', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Content preview */}
              <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Preview</div>
              <div style={{ background: '#F8F6F4', borderRadius: 12, padding: '14px 16px', fontSize: 13, color: '#4A4A5A', lineHeight: 1.65, maxHeight: 320, overflowY: 'auto', fontFamily: 'var(--font-jetbrains-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {selected.content ? selected.content.slice(0, 1500) + (selected.content.length > 1500 ? '\n…' : '') : 'No content preview available.'}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
