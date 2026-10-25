'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';

// Knowledge surface — three-column file browser over the vault filesystem.
// LEFT: folder tree (collapsible).  MIDDLE: file list for the selected
// folder.  RIGHT: markdown preview for the selected file.  Top-right
// "Reindex vault" button hits POST /api/knowledge/index { sources:['vault'] }.

interface VaultEntry {
  type: 'file' | 'folder';
  path: string;
  name: string;
  parent: string;
  modifiedAt?: string;
  size?: number;
}

interface FileDoc {
  path: string;
  content: string;
  modifiedAt: string;
  size: number;
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function depthOf(path: string): number {
  if (!path) return 0;
  return path.split('/').length - 1;
}

function FolderRow({
  entry, isOpen, isActive, onToggle, onSelect,
}: {
  entry: VaultEntry;
  isOpen: boolean;
  isActive: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const depth = depthOf(entry.path);
  return (
    <div
      className={'kn-tree-row' + (isActive ? ' active' : '')}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={() => { onSelect(); onToggle(); }}
    >
      <span className="kn-tree-chev" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="kn-tree-icon">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span className="kn-tree-name">{entry.name}</span>
    </div>
  );
}

export default function KnowledgeView() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState<string>('');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [doc, setDoc] = useState<FileDoc | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/knowledge/files')
      .then((r) => r.json())
      .then((data) => setEntries(data.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const folders = useMemo(() => entries.filter((e) => e.type === 'folder'), [entries]);
  const filesByFolder = useMemo(() => {
    const map = new Map<string, VaultEntry[]>();
    for (const e of entries) {
      if (e.type !== 'file') continue;
      const list = map.get(e.parent) ?? [];
      list.push(e);
      map.set(e.parent, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [entries]);

  // Top-level folders that are roots of the tree.
  const rootFolders = useMemo(
    () => folders.filter((f) => !f.parent).sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );

  // Build a children map: parent path → child folders.
  const folderChildren = useMemo(() => {
    const map = new Map<string, VaultEntry[]>();
    for (const f of folders) {
      const list = map.get(f.parent) ?? [];
      list.push(f);
      map.set(f.parent, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [folders]);

  function toggleFolder(path: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function selectFolder(path: string) {
    setActiveFolder(path);
    setActiveFile(null);
    setDoc(null);
    setDocError(null);
  }

  async function openFile(path: string) {
    setActiveFile(path);
    setDocLoading(true);
    setDocError(null);
    setDoc(null);
    try {
      const res = await fetch(`/api/knowledge/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) {
        setDocError(data.error ?? 'Failed to load');
      } else {
        setDoc(data);
      }
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setDocLoading(false);
    }
  }

  async function reindex() {
    setReindexing(true);
    setReindexMsg(null);
    try {
      const res = await fetch('/api/knowledge/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: ['vault'] }),
      });
      const data = await res.json();
      if (res.ok) {
        setReindexMsg('Vault reindexed.');
        const refreshed = await fetch('/api/knowledge/files').then((r) => r.json()).catch(() => null);
        if (refreshed?.entries) setEntries(refreshed.entries);
      } else {
        setReindexMsg(data.error ?? 'Reindex failed.');
      }
    } catch (err) {
      setReindexMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setReindexing(false);
      setTimeout(() => setReindexMsg(null), 3500);
    }
  }

  // Render the tree recursively from root folders.
  function renderTree(parents: VaultEntry[], acc: React.ReactNode[]): void {
    for (const f of parents) {
      const isOpen = openFolders.has(f.path);
      const isActive = activeFolder === f.path;
      acc.push(
        <FolderRow
          key={f.path}
          entry={f}
          isOpen={isOpen}
          isActive={isActive}
          onToggle={() => toggleFolder(f.path)}
          onSelect={() => selectFolder(f.path)}
        />
      );
      if (isOpen) {
        const children = folderChildren.get(f.path) ?? [];
        renderTree(children, acc);
      }
    }
  }
  const treeNodes: React.ReactNode[] = [];
  renderTree(rootFolders, treeNodes);

  // Middle column: files in active folder. If no folder selected, show
  // a friendly hint instead of an empty pane.
  const middleFiles = useMemo(() => {
    const list = filesByFolder.get(activeFolder) ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((f) => f.name.toLowerCase().includes(q)) : list;
  }, [filesByFolder, activeFolder, query]);

  const totalFiles = entries.filter((e) => e.type === 'file').length;

  return (
    <div className="kn-view">
      <header className="kn-head">
        <div>
          <h1 className="kn-title">Knowledge</h1>
          <div className="kn-sub">What Hatch can pull from · {totalFiles.toLocaleString()} files</div>
        </div>
        <div className="kn-head-actions">
          {reindexMsg && <span className="kn-reindex-msg">{reindexMsg}</span>}
          <button
            type="button"
            className="kn-reindex"
            onClick={reindex}
            disabled={reindexing}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: reindexing ? 'spin-cw 1s linear infinite' : 'none' }}>
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            {reindexing ? 'Reindexing…' : 'Reindex vault'}
          </button>
        </div>
      </header>

      <div className="kn-cols">
        <aside className="kn-tree thin-scroll">
          {loading ? (
            <div className="kn-empty">Loading…</div>
          ) : treeNodes.length === 0 ? (
            <div className="kn-empty">Vault is empty.</div>
          ) : treeNodes}
        </aside>

        <section className="kn-list">
          <div className="kn-list-head">
            <input
              className="kn-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={activeFolder ? `Search in ${activeFolder}…` : 'Search the selected folder…'}
            />
          </div>
          <div className="kn-list-body thin-scroll">
            {!activeFolder ? (
              <div className="kn-empty">Choose a folder on the left.</div>
            ) : middleFiles.length === 0 ? (
              <div className="kn-empty">No markdown files here.</div>
            ) : (
              middleFiles.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  className={'kn-list-row' + (activeFile === f.path ? ' active' : '')}
                  onClick={() => openFile(f.path)}
                >
                  <span className="kn-list-name">{f.name.replace(/\.md$/, '')}</span>
                  <span className="kn-list-meta">{timeAgo(f.modifiedAt)}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="kn-preview thin-scroll">
          {!activeFile ? (
            <div className="kn-empty">Select a file to preview.</div>
          ) : docLoading ? (
            <div className="kn-empty">Loading…</div>
          ) : docError ? (
            <div className="kn-empty kn-error">{docError}</div>
          ) : doc ? (
            <article>
              <div className="kn-preview-head">
                <div className="kn-preview-title">{activeFile.replace(/\.md$/, '').split('/').pop()}</div>
                <div className="kn-preview-meta">{activeFile} · updated {timeAgo(doc.modifiedAt)}</div>
              </div>
              <div className="prose kn-prose">
                <ReactMarkdown>{doc.content}</ReactMarkdown>
              </div>
            </article>
          ) : null}
        </section>
      </div>
    </div>
  );
}
