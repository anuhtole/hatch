import { NextResponse } from 'next/server';
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';

// Returns the vault filesystem as a flat list of folders + markdown files.
// Walked depth-first, hidden dirs (.git, .obsidian) skipped. Paths are
// returned RELATIVE to VAULT_PATH so the client can pass them back to
// /api/knowledge/file without ever seeing the absolute root.

const VAULT_PATH = process.env.VAULT_PATH ?? join(homedir(), 'vault');

interface Entry {
  type: 'file' | 'folder';
  /** Path relative to vault root, e.g. "01-me/anatole-seychal.md" */
  path: string;
  /** Display name (last segment of path). */
  name: string;
  /** Parent folder path (empty string for top-level). */
  parent: string;
  modifiedAt?: string;
  size?: number;
}

function walk(dir: string, relParent: string, out: Entry[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    const rel = relParent ? `${relParent}/${name}` : name;
    if (stat.isDirectory()) {
      out.push({ type: 'folder', path: rel, name, parent: relParent });
      walk(full, rel, out);
    } else if (stat.isFile() && extname(name) === '.md') {
      out.push({
        type: 'file',
        path: rel,
        name,
        parent: relParent,
        modifiedAt: stat.mtime.toISOString(),
        size: stat.size,
      });
    }
  }
}

export async function GET() {
  try {
    const entries: Entry[] = [];
    walk(VAULT_PATH, '', entries);
    return NextResponse.json({ entries, vaultPath: VAULT_PATH });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
