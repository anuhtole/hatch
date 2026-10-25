/**
 * Memory scheduling — two concerns:
 *
 * 1. runIdleExtraction() — scans conversations that have gone idle (>5 min, no
 *    new messages) and haven't had memory extracted yet, then writes vault facts
 *    for each one (max 5 per sweep, oldest idle first).
 *
 * 2. dailyRealityCheck() — full reality-sync pipeline (email, calendar, stale
 *    file detection, gap reporting). Runs daily at 6 am before briefing generation.
 */

import { prisma } from '@/lib/prisma';
import { extractAndWriteMemory } from '@/lib/vault-writer';
import { appendFile, readFile, readdir, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { refreshFromRecentEmails, refreshFromCalendar, detectNewPeople, detectGaps } from '@/lib/memory-refresh';
import { isRestrictedFile } from '@/lib/sync-config';

const VAULT_PATH = process.env.VAULT_PATH || path.join(os.homedir(), 'vault');
const MEMORY_PATH = path.join(VAULT_PATH, 'memory');
// B-12: scheduler logs live OUTSIDE the vault (no ungated vault writes).
const LOGS_DIR = path.join(os.homedir(), 'hatch', 'out', 'memory-logs');
const LOG_PATH = path.join(LOGS_DIR, 'log.md');
const GAPS_LOG = path.join(LOGS_DIR, 'gaps.md');

const STALE_DAYS = 90;

// ── Idle conversation extraction ─────────────────────────────────────────────

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PER_RUN = 5;

export async function runIdleExtraction(): Promise<{ processed: string[]; errors: string[] }> {
  const processed: string[] = [];
  const errors: string[] = [];

  const cutoff = new Date(Date.now() - IDLE_THRESHOLD_MS);

  let candidates: { id: string }[] = [];
  try {
    candidates = await prisma.conversation.findMany({
      where: {
        memoryExtracted: false,
        memoryExcluded: false,
        updatedAt: { lte: cutoff },
        messages: { some: {} },
      },
      orderBy: { updatedAt: 'asc' },
      take: MAX_PER_RUN,
      select: { id: true },
    });
  } catch (err) {
    console.error('[memory-scheduler] DB query failed:', err);
    return { processed, errors: [String(err)] };
  }

  for (const { id } of candidates) {
    try {
      await extractAndWriteMemory(id);
      await prisma.conversation.update({ where: { id }, data: { memoryExtracted: true } });
      processed.push(id);
      console.log(`[memory-scheduler] extracted memory for conversation ${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${id}: ${msg}`);
      console.error(`[memory-scheduler] failed for conversation ${id}:`, err);
    }
  }

  return { processed, errors };
}

// ── Stale file detection ──────────────────────────────────────────────────────

function parseFrontmatterField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^${field}:\\s*(\\S+)`, 'm'));
  return match?.[1] ?? null;
}

async function detectStaleFiles(): Promise<{ staleFiles: string[]; unverifiedFiles: string[] }> {
  const staleFiles: string[] = [];
  const unverifiedFiles: string[] = [];

  for (const subdir of ['people', 'projects']) {
    const dir = path.join(MEMORY_PATH, subdir);
    try {
      const names = await readdir(dir);
      for (const name of names.filter((f) => f.endsWith('.md'))) {
        if (isRestrictedFile(name)) continue;
        const content = await readFile(path.join(dir, name), 'utf-8').catch(() => '');
        if (!content) continue;

        const lastVerified = parseFrontmatterField(content, 'last_verified');
        if (!lastVerified) {
          unverifiedFiles.push(`${subdir}/${name}`);
          continue;
        }

        const daysOld = (Date.now() - new Date(lastVerified).getTime()) / 86_400_000;
        if (daysOld > STALE_DAYS) {
          staleFiles.push(`${subdir}/${name} (${Math.floor(daysOld)}d since verified)`);
        }
      }
    } catch { /* dir may not exist yet */ }
  }

  return { staleFiles, unverifiedFiles };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface RealityCheckResult {
  emailUpdates: number;
  emailContradictions: number;
  calendarUpdates: number;
  staleFiles: string[];
  unverifiedFiles: string[];
  newPeopleCount: number;
  gapCount: number;
  ranAt: string;
}

export async function dailyRealityCheck(): Promise<RealityCheckResult> {
  const ranAt = new Date().toISOString();

  // Run all checks in parallel — they are independent
  const [emailResult, calendarResult, staleResult, peopleResult, gapsResult] = await Promise.all([
    refreshFromRecentEmails({ daysBack: 14 }),
    refreshFromCalendar({ daysBack: 14 }),
    detectStaleFiles(),
    detectNewPeople(),
    detectGaps(),
  ]);

  // Log stale/unverified files to gaps.md for human review
  if (staleResult.staleFiles.length > 0 || staleResult.unverifiedFiles.length > 0) {
    const date = new Date().toISOString().slice(0, 10);
    const lines: string[] = [`\n\n## Reality check — ${date}`];
    if (staleResult.staleFiles.length > 0) {
      lines.push(
        `\n### Stale (>${STALE_DAYS}d unverified)`,
        ...staleResult.staleFiles.map((f) => `- ${f}`)
      );
    }
    if (staleResult.unverifiedFiles.length > 0) {
      lines.push(
        '\n### Missing last_verified field',
        ...staleResult.unverifiedFiles.map((f) => `- ${f}`)
      );
    }
    await mkdir(LOGS_DIR, { recursive: true }).catch(() => {}); await appendFile(GAPS_LOG, lines.join('\n')).catch(() => {});
  }

  await mkdir(LOGS_DIR, { recursive: true }).catch(() => {}); await appendFile(
    LOG_PATH,
    `\n- ${ranAt.slice(0, 16)}: Daily reality check — email: ${emailResult.updatesApplied} updates, ${emailResult.contradictionsFlagged} flagged; calendar: ${calendarResult.updatesApplied} updates; stale: ${staleResult.staleFiles.length} files; new people: ${peopleResult.newPeople.length}; gaps: ${gapsResult.gaps.length}`
  ).catch(() => {});

  return {
    emailUpdates: emailResult.updatesApplied,
    emailContradictions: emailResult.contradictionsFlagged,
    calendarUpdates: calendarResult.updatesApplied,
    staleFiles: staleResult.staleFiles,
    unverifiedFiles: staleResult.unverifiedFiles,
    newPeopleCount: peopleResult.newPeople.length,
    gapCount: gapsResult.gaps.length,
    ranAt,
  };
}

// ── Career status reader (used by Phase 9b in daily-briefing.ts) ─────────────

export interface ConfirmedCareerFact {
  slug: string;
  summary: string;
  confidence: number;
  lastVerified: string;
}

/**
 * Reads ~/vault/memory/projects/ and returns structured confirmed career facts.
 * Called by buildCareerSection() before prompt assembly so Claude knows what's
 * already confirmed and doesn't suggest stale/obsolete actions.
 */
export async function loadConfirmedCareerFacts(): Promise<ConfirmedCareerFact[]> {
  const dir = path.join(MEMORY_PATH, 'projects');
  const facts: ConfirmedCareerFact[] = [];

  try {
    const names = await readdir(dir);
    for (const name of names.filter((f) => f.endsWith('.md'))) {
      if (isRestrictedFile(name)) continue;
      const content = await readFile(path.join(dir, name), 'utf-8').catch(() => '');
      if (!content) continue;

      const confidence = parseFloat(parseFrontmatterField(content, 'confidence') ?? '0');
      const lastVerified = parseFrontmatterField(content, 'last_verified') ?? '';
      const slug = name.replace('.md', '');

      // Strip frontmatter — get the actual content body
      const body = content.replace(/^---[\s\S]*?---\n/, '').trim();
      // Take first 600 chars as the summary for the briefing prompt
      const summary = body.slice(0, 600);

      facts.push({ slug, summary, confidence, lastVerified });
    }
  } catch { /* dir may not exist */ }

  return facts;
}
