/**
 * Phase 8: Passive reality sync.
 *
 * Refreshes memory files from recent emails and calendar events, then writes
 * corrections/confirmations back to ~/vault/memory/ with updated last_verified dates.
 *
 * Designed to run nightly (via cron/memory route) and on manual /memory refresh.
 */

import Anthropic from '@anthropic-ai/sdk';
import { appendFile, readFile, writeFile, readdir, access, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { proposeVaultWrite } from '@/lib/pending-actions';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { google } from 'googleapis';
import { withGoogleRetry } from '@/lib/google-auth';
import { touchMemoryFile } from '@/lib/vault-writer';
import {
  EXCLUDED_SENDER_DOMAINS,
  EXCLUDED_SENDER_KEYWORDS,
  EXCLUDED_SUBJECT_KEYWORDS,
  isRestrictedFile,
} from '@/lib/sync-config';
import { invalidateMemoryCache } from '@/lib/vault-memory';
import { ROUTES } from '@/lib/models';

const VAULT_PATH = process.env.VAULT_PATH || path.join(os.homedir(), 'vault');
const MEMORY_PATH = path.join(VAULT_PATH, 'memory');
// B-12: diagnostics logs live OUTSIDE the vault (no ungated vault writes).
const LOGS_DIR = path.join(os.homedir(), 'hatch', 'out', 'memory-logs');
const ERRORS_LOG = path.join(LOGS_DIR, 'errors.md');
const REVIEW_LOG = path.join(LOGS_DIR, 'review-needed.md');
const LOG_PATH = path.join(LOGS_DIR, 'log.md');
const GAPS_PATH = path.join(LOGS_DIR, 'gaps.md');

async function ensureLogsDir(): Promise<void> {
  await mkdir(LOGS_DIR, { recursive: true }).catch(() => {});
}

// ── Privacy helpers ───────────────────────────────────────────────────────────

function isExcludedSender(from: string): boolean {
  const lower = from.toLowerCase();
  return (
    EXCLUDED_SENDER_DOMAINS.some((d) => lower.includes(d)) ||
    EXCLUDED_SENDER_KEYWORDS.some((k) => lower.includes(k))
  );
}

function isExcludedSubject(subject: string): boolean {
  const lower = subject.toLowerCase();
  return EXCLUDED_SUBJECT_KEYWORDS.some((k) => lower.includes(k));
}

function getHeader(msg: any, name: string): string {
  return msg?.payload?.headers?.find((h: any) => h.name === name)?.value ?? '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logError(fn: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await ensureLogsDir();
  await ensureLogsDir(); await appendFile(ERRORS_LOG, `\n- ${new Date().toISOString()}: [memory-refresh:${fn}] ${msg}`).catch(() => {});
}

async function loadMemoryFiles(subdir: string): Promise<Record<string, string>> {
  const dir = path.join(MEMORY_PATH, subdir);
  const files: Record<string, string> = {};
  try {
    const names = await readdir(dir);
    for (const name of names.filter((f) => f.endsWith('.md'))) {
      if (isRestrictedFile(name)) continue;
      const content = await readFile(path.join(dir, name), 'utf-8').catch(() => '');
      if (content) files[`${subdir}/${name}`] = content;
    }
  } catch { /* dir may not exist yet */ }
  return files;
}

async function applyMemoryUpdate(update: {
  memory_file: string;
  new_content: string;
  confidence: number;
  source_email: string;
  supersedes: string | null;
  operation: string;
}): Promise<void> {
  const filePath = path.join(MEMORY_PATH, update.memory_file);
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf-8');
  } catch {
    // File doesn't exist — only create for known types
    if (!update.memory_file.startsWith('people/') && !update.memory_file.startsWith('projects/')) return;
    const slug = path.basename(update.memory_file, '.md');
    const type = update.memory_file.startsWith('people/') ? 'person' : 'project';
    const today = new Date().toISOString().slice(0, 10);
    existing = `---\ntype: ${type}\nupdated: ${today}\nlast_verified: ${today}\nconfidence: ${update.confidence.toFixed(2)}\nsource: email\n---\n\n# ${slug}\n`;
  }

  if (update.supersedes) {
    existing = existing.replace(update.supersedes, update.new_content);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const line = `- ${today}: ${update.new_content} _(source: ${update.source_email})_`;
    if (existing.includes('## Recent updates')) {
      existing = existing.replace('## Recent updates\n', `## Recent updates\n${line}\n`);
    } else {
      existing += `\n\n## Recent updates\n${line}\n`;
    }
  }

  // Update freshness frontmatter
  const today = new Date().toISOString().slice(0, 10);
  existing = existing.replace(/updated:\s*\S+/, `updated: ${today}`);
  if (existing.includes('last_verified:')) {
    existing = existing.replace(/last_verified:\s*\S+/, `last_verified: ${today}`);
  } else {
    existing = existing.replace(/(updated:\s*\S+)/, `$1\nlast_verified: ${today}`);
  }
  if (existing.includes('confidence:')) {
    existing = existing.replace(/confidence:\s*[\d.]+/, `confidence: ${update.confidence.toFixed(2)}`);
  }

  // B-12: refresh updates are PROPOSED as vault_write PendingActions.
  await proposeVaultWrite({
    path: path.posix.join('memory', update.memory_file),
    content: existing,
    mode: existsSync(filePath) ? 'overwrite' : 'create',
    title: `Memory refresh: ${update.memory_file}`,
  });
}

// ── Phase 8a: Email-based refresh ────────────────────────────────────────────

export async function refreshFromRecentEmails({ daysBack = 14 }: { daysBack?: number } = {}): Promise<{
  updatesApplied: number;
  contradictionsFlagged: number;
}> {
  try {
    const [peopleFiles, projectFiles] = await Promise.all([
      loadMemoryFiles('people'),
      loadMemoryFiles('projects'),
    ]);

    const existingMemory = { ...peopleFiles, ...projectFiles };
    if (Object.keys(existingMemory).length === 0) {
      return { updatesApplied: 0, contradictionsFlagged: 0 };
    }

    // Fetch recent email metadata (no bodies — just From/Subject/Snippet/Date)
    const emailSummaries: Array<{ from: string; subject: string; snippet: string; date: string }> = [];

    try {
      await withGoogleRetry('berkeley', async (auth) => {
        const gmail = google.gmail({ version: 'v1', auth });
        const after = Math.floor((Date.now() - daysBack * 86_400_000) / 1000);
        const listRes = await gmail.users.messages.list({
          userId: 'me',
          q: `after:${after}`,
          maxResults: 100,
        });

        for (const m of listRes.data.messages ?? []) {
          const msg = await gmail.users.messages.get({
            userId: 'me',
            id: m.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });

          const from = getHeader(msg.data, 'From');
          const subject = getHeader(msg.data, 'Subject');
          if (isExcludedSender(from) || isExcludedSubject(subject)) continue;

          emailSummaries.push({
            from,
            subject,
            snippet: (msg.data.snippet ?? '').slice(0, 200),
            date: getHeader(msg.data, 'Date'),
          });
        }
      });
    } catch (err) {
      await logError('refreshFromRecentEmails/gmail', err);
      return { updatesApplied: 0, contradictionsFlagged: 0 };
    }

    if (emailSummaries.length === 0) return { updatesApplied: 0, contradictionsFlagged: 0 };

    const memoryBlock = Object.entries(existingMemory)
      .map(([f, c]) => `### ${f}\n${c.slice(0, 1500)}`)
      .join('\n\n---\n\n')
      .slice(0, 20_000);

    const emailBlock = emailSummaries
      .slice(0, 60)
      .map((e) => `FROM: ${e.from}\nSUBJECT: ${e.subject}\nDATE: ${e.date}\nSNIPPET: ${e.snippet}`)
      .join('\n\n---\n\n');

    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await claude.messages.create({
      model: ROUTES.LIGHTWEIGHT,
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are refreshing Anatole's persistent memory against recent emails. Below is his CURRENT memory and a list of recent emails.

Identify ONLY cases where recent emails:
1. CONTRADICT a memory claim (e.g. memory says "seeking return offer", email says "return offer accepted")
2. CONFIRM an existing claim (raising confidence)
3. Add a clearly NEW durable fact (new person role, project status, meeting outcome)

CRITICAL: Only act on strong evidence. Be conservative — flag ambiguous cases under contradictions_flagged instead of auto-updating.
CRITICAL: NEVER update financial, medical, or identity-related content. NEVER create entries for excluded sender domains.

Output ONLY valid JSON:
{
  "updates": [
    {
      "memory_file": "people/jackson-geiger.md",
      "operation": "update_status" | "add_fact" | "correct_fact" | "verify_existing",
      "new_content": "Single sentence of new/corrected fact",
      "confidence": 0.7-1.0,
      "source_email": "From: X / Subject: Y",
      "supersedes": "exact quoted text from memory this replaces, or null if new"
    }
  ],
  "contradictions_flagged": [
    "Brief description: memory says X but email implies Y — needs human review"
  ]
}

Current memory:
${memoryBlock}

Recent emails (last ${daysBack} days):
${emailBlock}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed: { updates: any[]; contradictions_flagged: string[] };
    try {
      parsed = JSON.parse(clean);
    } catch (err) {
      await logError('refreshFromRecentEmails/parse', err);
      return { updatesApplied: 0, contradictionsFlagged: 0 };
    }

    let updatesApplied = 0;
    for (const upd of parsed.updates ?? []) {
      if (upd.confidence < 0.7) continue;
      if (isRestrictedFile(upd.memory_file)) continue;
      try {
        await applyMemoryUpdate(upd);
        updatesApplied++;
      } catch (err) {
        await logError('applyMemoryUpdate', err);
      }
    }

    const contradictions = parsed.contradictions_flagged ?? [];
    if (contradictions.length > 0) {
      const date = new Date().toISOString().slice(0, 10);
      const entries = contradictions.map((c: string) => `- ${date} [email-refresh]: ${c}`).join('\n');
      await ensureLogsDir(); await appendFile(REVIEW_LOG, `\n${entries}`).catch(() => {});
    }

    await ensureLogsDir(); await appendFile(
      LOG_PATH,
      `\n- ${new Date().toISOString().slice(0, 16)}: Email refresh (${daysBack}d) — ${updatesApplied} updates, ${contradictions.length} flagged`
    ).catch(() => {});

    invalidateMemoryCache();
    return { updatesApplied, contradictionsFlagged: contradictions.length };
  } catch (err) {
    await logError('refreshFromRecentEmails', err);
    return { updatesApplied: 0, contradictionsFlagged: 0 };
  }
}

// ── Phase 8b: Calendar-based refresh ─────────────────────────────────────────

export async function refreshFromCalendar({ daysBack = 14 }: { daysBack?: number } = {}): Promise<{
  updatesApplied: number;
}> {
  try {
    const [peopleFiles, projectFiles] = await Promise.all([
      loadMemoryFiles('people'),
      loadMemoryFiles('projects'),
    ]);

    const existingMemory = { ...peopleFiles, ...projectFiles };
    if (Object.keys(existingMemory).length === 0) return { updatesApplied: 0 };

    let events: Array<{ summary: string; start: string; attendees: string[] }> = [];
    try {
      await withGoogleRetry('berkeley', async (auth) => {
        const calendar = google.calendar({ version: 'v3', auth });
        const res = await calendar.events.list({
          calendarId: 'primary',
          timeMin: new Date(Date.now() - daysBack * 86_400_000).toISOString(),
          timeMax: new Date().toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 100,
        });
        events = (res.data.items ?? [])
          .filter((e) => e.summary && !e.summary.toLowerCase().includes('ooo'))
          .map((e) => ({
            summary: e.summary ?? '',
            start: e.start?.dateTime ?? e.start?.date ?? '',
            attendees: (e.attendees ?? [])
              .map((a) => a.email ?? '')
              .filter((em) => em && !isExcludedSender(em)),
          }));
      });
    } catch (err) {
      await logError('refreshFromCalendar/calendar', err);
      return { updatesApplied: 0 };
    }

    if (events.length === 0) return { updatesApplied: 0 };

    const memoryBlock = Object.entries(existingMemory)
      .map(([f, c]) => `### ${f}\n${c.slice(0, 1000)}`)
      .join('\n\n---\n\n')
      .slice(0, 15_000);

    const eventBlock = events
      .slice(0, 50)
      .map((e) => `EVENT: ${e.summary}\nSTART: ${e.start}\nATTENDEES: ${e.attendees.join(', ') || 'none'}`)
      .join('\n\n');

    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await claude.messages.create({
      model: ROUTES.LIGHTWEIGHT,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are refreshing Anatole's memory from recent calendar events. Identify cases where events:
1. Confirm a known person relationship (they met, raising confidence)
2. Reveal a project milestone (interview completed, meeting occurred)
3. Imply a status change (internship interview = application active, etc.)

Only extract DURABLE facts — meetings that imply ongoing relationships or project states, not one-off logistics.

Output ONLY valid JSON:
{
  "updates": [
    {
      "memory_file": "people/jackson-geiger.md",
      "operation": "verify_existing" | "add_fact",
      "new_content": "Single durable fact from this event",
      "confidence": 0.7-0.9,
      "source_email": "Event: [event summary]",
      "supersedes": null
    }
  ]
}

Current memory:
${memoryBlock}

Recent calendar events (last ${daysBack} days):
${eventBlock}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed: { updates: any[] };
    try {
      parsed = JSON.parse(clean);
    } catch {
      return { updatesApplied: 0 };
    }

    let updatesApplied = 0;
    for (const upd of parsed.updates ?? []) {
      if (upd.confidence < 0.7) continue;
      if (isRestrictedFile(upd.memory_file)) continue;
      try {
        await applyMemoryUpdate(upd);
        updatesApplied++;
      } catch (err) {
        await logError('applyMemoryUpdate/calendar', err);
      }
    }

    if (updatesApplied > 0) {
      await ensureLogsDir(); await appendFile(
        LOG_PATH,
        `\n- ${new Date().toISOString().slice(0, 16)}: Calendar refresh (${daysBack}d) — ${updatesApplied} updates`
      ).catch(() => {});
      invalidateMemoryCache();
    }

    return { updatesApplied };
  } catch (err) {
    await logError('refreshFromCalendar', err);
    return { updatesApplied: 0 };
  }
}

// ── Phase 8c: Resume/LinkedIn paste refresh ───────────────────────────────────

export async function refreshFromCareerPaste(content: string): Promise<{
  updatesApplied: number;
  summary: string;
}> {
  if (!content.trim()) return { updatesApplied: 0, summary: 'No content provided.' };

  try {
    const projectFiles = await loadMemoryFiles('projects');
    const memoryBlock = Object.entries(projectFiles)
      .map(([f, c]) => `### ${f}\n${c.slice(0, 1200)}`)
      .join('\n\n---\n\n');

    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await claude.messages.create({
      model: ROUTES.LIGHTWEIGHT,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Anatole has pasted his latest LinkedIn profile or resume content. Diff it against his current career memory and identify any changes that need to be updated in memory.

Look for: changed job titles, new roles confirmed vs in-progress, dates that now show as past (meaning completed), new skills or achievements.

Output ONLY valid JSON:
{
  "updates": [
    {
      "memory_file": "projects/microsoft-summer-2026.md",
      "operation": "correct_fact" | "add_fact" | "verify_existing",
      "new_content": "What the career profile confirms or corrects",
      "confidence": 0.9,
      "source_email": "LinkedIn/resume paste",
      "supersedes": "exact text from memory to replace, or null"
    }
  ],
  "summary": "1-2 sentence summary of what was learned from this paste"
}

Current career memory:
${memoryBlock}

Pasted career content:
${content.slice(0, 8000)}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed: { updates: any[]; summary: string };
    try {
      parsed = JSON.parse(clean);
    } catch {
      return { updatesApplied: 0, summary: 'Failed to parse refresh response.' };
    }

    let updatesApplied = 0;
    for (const upd of parsed.updates ?? []) {
      if (upd.confidence < 0.8) continue;
      if (isRestrictedFile(upd.memory_file)) continue;
      try {
        await applyMemoryUpdate(upd);
        updatesApplied++;
      } catch (err) {
        await logError('refreshFromCareerPaste', err);
      }
    }

    await ensureLogsDir(); await appendFile(
      LOG_PATH,
      `\n- ${new Date().toISOString().slice(0, 16)}: Career paste refresh — ${updatesApplied} updates`
    ).catch(() => {});

    invalidateMemoryCache();
    return { updatesApplied, summary: parsed.summary ?? '' };
  } catch (err) {
    await logError('refreshFromCareerPaste', err);
    return { updatesApplied: 0, summary: String(err) };
  }
}

// ── Phase 10a: New-person detection ─────────────────────────────────────────

function parseEmailAddress(from: string): { email: string; name: string } {
  const m = from.match(/^"?([^"<]+?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: from.trim().toLowerCase() };
}

async function getKnownPeopleEmails(): Promise<Set<string>> {
  const dir = path.join(MEMORY_PATH, 'people');
  const known = new Set<string>();
  try {
    const files = await readdir(dir);
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      const content = await readFile(path.join(dir, f), 'utf-8').catch(() => '');
      const matches = content.matchAll(/\*\*Email:\*\*\s*([^\s\n]+)/g);
      for (const m of matches) known.add(m[1].trim().toLowerCase());
      // Also check inline email patterns
      const inline = content.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      for (const m of inline) known.add(m[0].toLowerCase());
    }
  } catch { /* people dir may be empty */ }
  return known;
}

async function createStubPersonFile(slug: string, person: { email: string; name: string; count: number }): Promise<void> {
  const filePath = path.join(MEMORY_PATH, 'people', `${slug}.md`);
  // Don't overwrite existing files
  try { await access(filePath); return; } catch { /* doesn't exist — create it */ }

  const today = new Date().toISOString().slice(0, 10);
  const displayName = person.name || slug;
  const fm = {
    type: 'person',
    updated: today,
    last_verified: today,
    confidence: 0.50,
    source: 'email-auto-detect',
    source_facts: [{ source: 'email-auto-detect', date: today, claim: `${person.count} emails in last 30 days` }],
  };
  const body = `\n# ${displayName}\n\n**Email:** ${person.email}\n**First seen:** ${today} (${person.count} emails in last 30 days)\n\n_Auto-created by detectNewPeople — fill in details when known._\n`;
  // B-12: stub person files are PROPOSED, never written directly.
  await proposeVaultWrite({
    path: path.posix.join('memory', 'people', `${slug}.md`),
    content: matter.stringify(body, fm),
    mode: 'create',
    title: 'New person detected from email',
  });
}

export async function detectNewPeople(): Promise<{ newPeople: Array<{ email: string; name: string; count: number }> }> {
  try {
    const senderCounts = new Map<string, { email: string; name: string; count: number }>();

    await withGoogleRetry('berkeley', async (auth) => {
      const gmail = google.gmail({ version: 'v1', auth });
      const after = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: `after:${after}`,
        maxResults: 200,
      });

      for (const m of listRes.data.messages ?? []) {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: m.id!,
          format: 'metadata',
          metadataHeaders: ['From'],
        });
        const from = getHeader(msg.data, 'From');
        if (!from || isExcludedSender(from)) continue;
        const parsed = parseEmailAddress(from);
        if (!parsed.email.includes('@')) continue;
        const existing = senderCounts.get(parsed.email);
        senderCounts.set(parsed.email, {
          email: parsed.email,
          name: parsed.name || existing?.name || '',
          count: (existing?.count ?? 0) + 1,
        });
      }
    });

    const knownEmails = await getKnownPeopleEmails();
    const newPeople = Array.from(senderCounts.values()).filter(
      (s) => s.count >= 2 && !knownEmails.has(s.email)
    );

    for (const p of newPeople) {
      const slug = p.email.split('@')[0].replace(/\./g, '-');
      await createStubPersonFile(slug, p);
    }

    if (newPeople.length > 0) {
      await ensureLogsDir(); await appendFile(
        LOG_PATH,
        `\n- ${new Date().toISOString().slice(0, 16)}: detectNewPeople — ${newPeople.length} new stub(s) created`
      ).catch(() => {});
    }

    return { newPeople };
  } catch (err) {
    await logError('detectNewPeople', err);
    return { newPeople: [] };
  }
}

// ── Phase 10b: Gap detection ─────────────────────────────────────────────────

export async function detectGaps(): Promise<{ gaps: string[] }> {
  const gaps: string[] = [];

  try {
    // People: missing email
    try {
      const peopleDir = path.join(MEMORY_PATH, 'people');
      const peopleFiles = await readdir(peopleDir);
      for (const file of peopleFiles.filter((f) => f.endsWith('.md'))) {
        const content = await readFile(path.join(peopleDir, file), 'utf-8').catch(() => '');
        if (!content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)) {
          gaps.push(`people/${file}: no email address on file`);
        }
      }
    } catch { /* dir missing */ }

    // Projects: stale last_verified (>90 days)
    try {
      const projectsDir = path.join(MEMORY_PATH, 'projects');
      const projectFiles = await readdir(projectsDir);
      for (const file of projectFiles.filter((f) => f.endsWith('.md'))) {
        const content = await readFile(path.join(projectsDir, file), 'utf-8').catch(() => '');
        const match = content.match(/last_verified:\s*(\S+)/);
        if (match) {
          const daysOld = (Date.now() - new Date(match[1]).getTime()) / 86_400_000;
          if (daysOld > 90) {
            gaps.push(`projects/${file}: not verified in ${Math.floor(daysOld)} days`);
          }
        } else {
          gaps.push(`projects/${file}: no last_verified date`);
        }
      }
    } catch { /* dir missing */ }

    const today = new Date().toISOString().slice(0, 10);
    await ensureLogsDir();
    await writeFile(
      GAPS_PATH,
      `---\nupdated: ${today}\n---\n\n# Memory Gaps\n\n${gaps.length === 0 ? '_No gaps detected._' : gaps.map((g) => `- ${g}`).join('\n')}\n`
    );

    if (gaps.length > 0) {
      await ensureLogsDir(); await appendFile(
        LOG_PATH,
        `\n- ${new Date().toISOString().slice(0, 16)}: detectGaps — ${gaps.length} gap(s) written to gaps.md`
      ).catch(() => {});
    }

    return { gaps };
  } catch (err) {
    await logError('detectGaps', err);
    return { gaps: [] };
  }
}
