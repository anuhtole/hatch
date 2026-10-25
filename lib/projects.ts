/**
 * Read-only scan of the user's Claude Code projects directory.
 *
 * Claude Code stores per-project session history under
 * ~/.claude/projects/<slug>/*.jsonl, where <slug> is the original
 * filesystem path with "/" replaced by "-" (and a leading "-").
 *
 * Hatch is a context engine, not a project manager — we only read
 * mtimes and HEAD commit timestamps so the sidebar can surface what
 * the user is actively shipping. The signal also flows into the chat
 * route's system prompt as a focus hint.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export interface Project {
  id: string;
  name: string;
  path: string;
  lastSessionAt: string | null;
  lastCommitAt: string | null;
}

const TTL_MS = 60_000;
let cache: { ts: number; data: Project[] } | null = null;

function slugToPath(slug: string): string {
  // "-Users-anatoleseychal-hatch" -> "/Users/<you>/hatch"
  // Edge cases (e.g. paths whose directories contain hyphens or dots)
  // round-trip imperfectly. The git lookup is wrapped in try/catch so
  // a wrong-but-plausible path silently degrades to "no commit info".
  return '/' + slug.replace(/^-/, '').replace(/-/g, '/');
}

async function latestSessionMtime(sessionDir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(sessionDir);
    const jsonl = entries.filter((f) => f.endsWith('.jsonl'));
    if (jsonl.length === 0) return null;
    let maxMs = 0;
    for (const f of jsonl) {
      try {
        const st = await fs.stat(path.join(sessionDir, f));
        if (st.mtimeMs > maxMs) maxMs = st.mtimeMs;
      } catch { /* skip unreadable files */ }
    }
    return maxMs ? new Date(maxMs).toISOString() : null;
  } catch {
    return null;
  }
}

async function latestCommitISO(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['log', '-1', '--format=%cI', 'HEAD'], {
      cwd: repoPath,
      timeout: 1500,
    });
    const v = stdout.trim();
    return v || null;
  } catch {
    return null;
  }
}

async function isRealProjectDir(realPath: string, sessionDir: string): Promise<boolean> {
  // A "real" Claude Code project is one whose decoded path exists on
  // disk as a directory AND whose session dir contains at least one
  // .jsonl file. Without these checks, system dirs and stale slugs
  // (like ~/.claude itself) leak into the list — the earlier C4 build
  // surfaced "sessions" out of /Users/<you>/.claude-mem/...
  // because the slug decoded to a real but non-project subpath.
  try {
    const stat = await fs.stat(realPath);
    if (!stat.isDirectory()) return false;
  } catch {
    return false;
  }
  try {
    const entries = await fs.readdir(sessionDir);
    return entries.some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

export async function listClaudeCodeProjects(): Promise<Project[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.data;

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  let dirs: string[];
  try {
    dirs = await fs.readdir(projectsDir);
  } catch {
    return [];
  }

  const candidates = await Promise.all(
    dirs.map(async (slug): Promise<Project | null> => {
      const realPath = slugToPath(slug);
      const sessionDir = path.join(projectsDir, slug);
      if (!(await isRealProjectDir(realPath, sessionDir))) return null;
      const name = path.basename(realPath) || slug;
      const [lastSessionAt, lastCommitAt] = await Promise.all([
        latestSessionMtime(sessionDir),
        latestCommitISO(realPath),
      ]);
      return { id: slug, name, path: realPath, lastSessionAt, lastCommitAt };
    })
  );

  const results = candidates.filter((p): p is Project => p !== null);

  // Sort by most recent activity (session OR commit), newest first.
  const sorted = results.sort((a, b) => activityMs(b) - activityMs(a));
  cache = { ts: Date.now(), data: sorted };
  return sorted;
}

// ── Chat-prompt summary ──────────────────────────────────────────────────

const SUMMARY_TTL_MS = 60_000;
const SUMMARY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
let summaryCache: { ts: number; data: string | null } | null = null;

function relativeAgo(iso: string | null): string {
  if (!iso) return 'unknown';
  const t = new Date(iso).getTime();
  if (!t) return 'unknown';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  const w = Math.floor(d / 7);
  return w === 1 ? 'last week' : `${w} weeks ago`;
}

async function topCommitSubjects(repoPath: string, n: number): Promise<string[]> {
  try {
    const { stdout } = await exec('git', ['log', `-${n}`, '--format=%s', 'HEAD'], {
      cwd: repoPath,
      timeout: 1500,
    });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Build a short, plain-text summary of the user's recent Claude Code
 * work for injection into the chat system prompt. Always-on; the chat
 * route calls this on every message.
 *
 * Returns null when there's nothing recent enough to be worth saying
 * — the chat route should then skip the section entirely.
 */
export async function buildProjectContextSummary(): Promise<string | null> {
  if (summaryCache && Date.now() - summaryCache.ts < SUMMARY_TTL_MS) {
    return summaryCache.data;
  }
  const all = await listClaudeCodeProjects();
  const active = all.filter((p) => Date.now() - activityMs(p) < SUMMARY_WINDOW_MS);

  if (active.length === 0) {
    summaryCache = { ts: Date.now(), data: null };
    return null;
  }

  const top = active[0];
  const topActivityIso =
    top.lastSessionAt && top.lastCommitAt
      ? (new Date(top.lastSessionAt).getTime() > new Date(top.lastCommitAt).getTime()
        ? top.lastSessionAt : top.lastCommitAt)
      : (top.lastSessionAt ?? top.lastCommitAt);
  const subjects = await topCommitSubjects(top.path, 3);

  const lines: string[] = [];
  lines.push(`The user has been actively working on Claude Code projects. Their most recently touched project is "${top.name}" (last activity: ${relativeAgo(topActivityIso)}).`);

  if (subjects.length > 0) {
    lines.push(`Recent commits in ${top.name}:`);
    lines.push('');
    for (const s of subjects) lines.push(`- ${s}`);
    lines.push('');
  }

  const others = active.slice(1, 5);
  if (others.length > 0) {
    const otherStrs = others.map((p) => {
      const iso = p.lastSessionAt && p.lastCommitAt
        ? (new Date(p.lastSessionAt).getTime() > new Date(p.lastCommitAt).getTime()
          ? p.lastSessionAt : p.lastCommitAt)
        : (p.lastSessionAt ?? p.lastCommitAt);
      return `${p.name} (${relativeAgo(iso)})`;
    });
    lines.push(`Other active projects: ${otherStrs.join(', ')}.`);
  }

  lines.push(`If the user's message relates to engineering work, code, project status, or shipping, this context may be relevant.`);

  const summary = lines.join('\n');
  summaryCache = { ts: Date.now(), data: summary };
  return summary;
}

export function invalidateProjectsCache(): void {
  cache = null;
}

function activityMs(p: Project): number {
  const s = p.lastSessionAt ? new Date(p.lastSessionAt).getTime() : 0;
  const c = p.lastCommitAt ? new Date(p.lastCommitAt).getTime() : 0;
  return Math.max(s, c);
}
