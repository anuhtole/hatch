/**
 * Vault-based persistent memory for Hatch.
 *
 * Reads ~/vault/memory/ at chat time and injects relevant content into the
 * system prompt. Cache TTL is 2 minutes to avoid re-reading on every turn.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import os from 'os';

const VAULT_PATH = process.env.VAULT_PATH || path.join(os.homedir(), 'vault');
const MEMORY_PATH = path.join(VAULT_PATH, 'memory');

// Max chars for triggered file content — trim beyond this
const MAX_TRIGGER_CHARS = 12_000;
const MAX_TOTAL_CHARS = 20_000;

interface Trigger {
  keywords: string[];
  files: string[];
}

interface CoreCache {
  masterContext: string;
  index: string;
  workingContext: string;
  tasks: string;
  triggers: Trigger[];
  loadedAt: number;
}

let cached: CoreCache | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// ── Phase 7c: Freshness annotation ───────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return result;
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) result[key.trim()] = rest.join(':').trim();
  }
  return result;
}

function annotateFreshness(content: string, filePath: string): string {
  const fm = parseFrontmatter(content);
  const lastVerified = fm.last_verified;
  if (!lastVerified) return content;

  const daysOld = (Date.now() - new Date(lastVerified).getTime()) / 86_400_000;

  if (daysOld > 90) {
    return `WARNING: NOT VERIFIED IN ${Math.floor(daysOld)} DAYS (${filePath}) — verify against recent emails/calendar before asserting as current fact.\n\n${content}`;
  }
  if (daysOld > 30) {
    return `Note: last verified ${Math.floor(daysOld)} days ago (${filePath}).\n\n${content}`;
  }
  return content;
}

function parseTriggers(raw: string): Trigger[] {
  const triggers: Trigger[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    // Match markdown table rows: | keyword, keyword | file1, file2 |
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const kw = m[1].trim();
    const files = m[2].trim();
    // Skip header rows
    if (kw === 'Keyword / phrase' || /^[-\s]+$/.test(kw)) continue;
    triggers.push({
      keywords: kw.split(/,\s*/).map((k) => k.toLowerCase().trim()),
      files: files.split(/,\s*/).map((f) => f.trim()).filter(Boolean),
    });
  }
  return triggers;
}

async function loadCore(): Promise<CoreCache> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached;
  }

  const [masterContext, index, workingContext, tasks, triggersRaw] = await Promise.all([
    safeRead(path.join(VAULT_PATH, 'CLAUDE.md')),
    safeRead(path.join(MEMORY_PATH, 'index.md')),
    safeRead(path.join(MEMORY_PATH, 'working-context.md')),
    safeRead(path.join(VAULT_PATH, 'TASKS.md')),
    safeRead(path.join(MEMORY_PATH, 'triggers.md')),
  ]);

  const triggers = parseTriggers(triggersRaw);
  cached = { masterContext, index, workingContext, tasks, triggers, loadedAt: Date.now() };
  return cached;
}

function resolveFilePath(f: string): string {
  if (f.startsWith('/')) return f;
  if (f.startsWith('~/')) return f.replace('~', os.homedir());
  return path.join(VAULT_PATH, f);
}

export async function buildMemoryContext(userMessage: string): Promise<string> {
  const core = await loadCore();

  // Match triggers against the user message
  const lowerMsg = userMessage.toLowerCase();
  const matchedFiles = new Set<string>();
  for (const trig of core.triggers) {
    if (trig.keywords.some((kw) => lowerMsg.includes(kw))) {
      trig.files.forEach((f) => matchedFiles.add(f));
    }
  }

  // Read triggered files (cap at top 3 if many matched)
  const fileList = Array.from(matchedFiles).slice(0, 3);
  const triggeredContent = (
    await Promise.all(
      fileList.map(async (f) => {
        const raw = await safeRead(resolveFilePath(f));
        if (!raw) return '';
        const annotated = annotateFreshness(raw, f);
        return `### ${f}\n${annotated.slice(0, 4_000)}`;
      })
    )
  ).filter(Boolean);

  const triggerBlock = triggeredContent.join('\n\n---\n\n').slice(0, MAX_TRIGGER_CHARS);

  let result = `<memory_context>
The following comes from the user's Obsidian vault at ~/vault/. This is persistent context that accumulates across sessions. USE this content to answer with full awareness of the user's world — don't search from scratch for things already known here.

## Master context (CLAUDE.md)

${core.masterContext}

## Memory index

${core.index}

## Right now

${core.workingContext}

## Current tasks

${core.tasks}
${triggerBlock ? `\n## Triggered by this message\n\n${triggerBlock}` : ''}
</memory_context>`;

  // Trim if over limit
  if (result.length > MAX_TOTAL_CHARS) {
    result = result.slice(0, MAX_TOTAL_CHARS) + '\n\n[memory_context truncated for length]</memory_context>';
  }

  return result;
}

/** Call at chat start — returns the memory block to prepend to system prompt. Fails gracefully. */
export async function getMemoryBlock(userMessage: string): Promise<string> {
  try {
    return await buildMemoryContext(userMessage);
  } catch (err) {
    console.error('[vault-memory] failed to build context:', err);
    return '';
  }
}

/** Invalidate the cache (call after write-back to reload immediately on next turn). */
export function invalidateMemoryCache(): void {
  cached = null;
}
