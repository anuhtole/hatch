import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { homedir } from 'os';

const VAULT_PATH = process.env.VAULT_PATH ?? join(homedir(), 'vault');

// ── Helpers ───────────────────────────────────────────────────────────────────

function vaultPath(relativePath?: string): string {
  if (!relativePath) return VAULT_PATH;
  return join(VAULT_PATH, relativePath);
}

function walkMarkdown(dir: string, results: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir) as string[];
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory() && !entry.startsWith('.')) {
        walkMarkdown(full, results);
      } else if (stat.isFile() && extname(entry) === '.md') {
        results.push(full);
      }
    } catch {
      // skip inaccessible files
    }
  }
  return results;
}

function relPath(absPath: string): string {
  return absPath.replace(VAULT_PATH + '/', '');
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface VaultNote {
  path: string;   // relative to vault root
  title: string;
  content: string;
  modifiedAt: Date;
}

export interface VaultSearchResult {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

/**
 * Full-text search across all vault markdown files.
 * Returns up to `limit` results sorted by relevance (term frequency).
 */
export function searchVault(query: string, limit = 10): VaultSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const files = walkMarkdown(VAULT_PATH);
  const results: VaultSearchResult[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const lower = content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      // Count occurrences
      let pos = 0;
      while ((pos = lower.indexOf(term, pos)) !== -1) {
        score++;
        pos++;
      }
      // Title match scores higher
      const filename = basename(file, '.md').toLowerCase();
      if (filename.includes(term)) score += 5;
    }

    if (score === 0) continue;

    // Extract excerpt around first match
    const firstTerm = terms[0];
    const idx = lower.indexOf(firstTerm);
    const start = Math.max(0, idx - 80);
    const end = Math.min(content.length, idx + 200);
    const excerpt = content.slice(start, end).replace(/\n+/g, ' ').trim();

    // Extract title from frontmatter or filename
    const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    const title = titleMatch ? titleMatch[1] : basename(file, '.md');

    results.push({ path: relPath(file), title, excerpt, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Read a specific vault note by relative path (e.g. "01-me/anatole-seychal.md").
 */
export function readNote(relativePath: string): VaultNote | null {
  const full = vaultPath(relativePath);
  try {
    const content = readFileSync(full, 'utf-8');
    const stat = statSync(full);
    const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    const title = titleMatch ? titleMatch[1] : basename(relativePath, '.md');
    return { path: relativePath, title, content, modifiedAt: stat.mtime };
  } catch {
    return null;
  }
}

/**
 * Write or update a vault note.
 * Creates parent directories if they don't exist.
 */
export function writeNote(relativePath: string, content: string): void {
  const full = vaultPath(relativePath);
  const dir = dirname(full);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

/**
 * Get or create today's daily note.
 */
export function getDailyNote(): VaultNote {
  const today = new Date().toISOString().slice(0, 10);
  const relativePath = `08-daily/${today}.md`;
  const existing = readNote(relativePath);
  if (existing) return existing;

  const content = `---\ntitle: "${today}"\ntags: [daily]\ncreated: ${today}\n---\n\n## Today's Focus\n\n\n## Notes & Captures\n\n\n## Done Today\n\n\n## Tomorrow\n\n`;
  writeNote(relativePath, content);
  return readNote(relativePath)!;
}

/**
 * List recently modified vault notes.
 */
export function getRecentNotes(days = 7): VaultNote[] {
  const files = walkMarkdown(VAULT_PATH);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const results: VaultNote[] = [];

  for (const file of files) {
    try {
      const stat = statSync(file);
      if (stat.mtime.getTime() < cutoff) continue;
      const content = readFileSync(file, 'utf-8');
      const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      const title = titleMatch ? titleMatch[1] : basename(file, '.md');
      results.push({ path: relPath(file), title, content, modifiedAt: stat.mtime });
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}
