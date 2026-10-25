/**
 * Vault memory write-back for Hatch.
 *
 * B-12: this module no longer writes ~/vault. After a conversation goes idle,
 * it extracts durable facts via Claude and PROPOSES each write as a
 * vault_write PendingAction — nothing lands in the vault until the user
 * approves the card (the executor also regenerates memory/index.md after an
 * approved memory/ write). Diagnostics logs moved OUT of the vault to
 * ~/hatch/out/. Enforced by guard:send-surface assert F.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
import { appendFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { prisma } from '@/lib/prisma';
import { isRestrictedFile } from '@/lib/sync-config';
import { proposeVaultWrite } from '@/lib/pending-actions';

// Diagnostics only — deliberately OUTSIDE the vault (B-12).
const ERRORS_LOG = path.join(os.homedir(), 'hatch', 'out', 'memory-errors.log');

async function logError(fn: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await appendFile(ERRORS_LOG, `\n- ${new Date().toISOString()}: [${fn}] ${msg}`).catch(() => {});
}

/** Public alias — lets callers outside this module log to the same errors file. */
export async function logMemoryError(fn: string, err: unknown): Promise<void> {
  return logError(fn, err);
}

const VAULT_PATH = process.env.VAULT_PATH || path.join(os.homedir(), 'vault');
const MEMORY_PATH = path.join(VAULT_PATH, 'memory');

const FINANCIAL_KEYWORDS = [
  'tax', 'bank', 'loan', 'mortgage', 'credit card', 'payroll', 'salary', 'w-2', 'w2',
  '1099', '401k', 'ira', 'brokerage', 'invoice', 'billing', 'ssn', 'routing number',
  'social security', 'birth certificate', 'passport', 'visa', 'immigration', 'i-20',
  'medical record', 'diagnosis', 'prescription', 'health insurance', 'hipaa',
];

function containsPrivateContent(text: string): boolean {
  const lower = text.toLowerCase();
  return FINANCIAL_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── Operation types returned by Claude ────────────────────────────────────────

interface UpsertPersonOp {
  type: 'UPSERT_PERSON';
  slug: string;
  content_to_merge: string;
}

interface UpsertProjectOp {
  type: 'UPSERT_PROJECT';
  slug: string;
  content_to_merge: string;
}

interface AppendDecisionOp {
  type: 'APPEND_DECISION';
  slug: string;
  content: string;
}

interface AppendInsightOp {
  type: 'APPEND_INSIGHT';
  slug: string;
  content: string;
}

interface UpdateWorkingContextOp {
  type: 'UPDATE_WORKING_CONTEXT';
  content: string;
}

type MemoryOp =
  | UpsertPersonOp
  | UpsertProjectOp
  | AppendDecisionOp
  | AppendInsightOp
  | UpdateWorkingContextOp;

interface ExtractionResult {
  operations: MemoryOp[];
  log_entry: string;
}

// ── Phase 7b: Confidence decay ────────────────────────────────────────────────

/**
 * Exponential decay: half-life of 60 days.
 * Returns a value between 0.1 (floor) and 1.0.
 */
export function decayConfidence(fact: { last_verified: string; confidence: number }): number {
  const daysSince = (Date.now() - new Date(fact.last_verified).getTime()) / 86_400_000;
  const decayed = fact.confidence * Math.pow(0.5, daysSince / 60);
  return Math.max(decayed, 0.1);
}

// ── Main extraction entry point ───────────────────────────────────────────────

export async function extractAndWriteMemory(conversationId: string): Promise<void> {
  try {
    return await _extractAndWriteMemory(conversationId);
  } catch (err) {
    await logError('extractAndWriteMemory', err);
    throw err; // re-throw so the scheduler can record the failure
  }
}

async function _extractAndWriteMemory(conversationId: string): Promise<void> {
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });

  if (messages.length < 2) return; // skip trivial conversations

  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 800)}`)
    .join('\n\n')
    .slice(0, 30_000);

  const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let parsed: ExtractionResult;
  try {
    const response = await claude.messages.create({
      model: ROUTES.APP_DEFAULT,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Analyze this conversation between Anatole (user) and Hatch (AI assistant). Extract ONLY durable facts worth keeping across sessions. Skip small talk, intermediate reasoning, and tool noise.

For each new fact, output an operation. Use these types:
- UPSERT_PERSON — new person mentioned or existing person info updated
- UPSERT_PROJECT — new project, course, or initiative mentioned or updated
- APPEND_DECISION — Anatole made a significant decision
- APPEND_INSIGHT — a durable idea or realization emerged
- UPDATE_WORKING_CONTEXT — current priorities or focus shifted

Respond ONLY with valid JSON:
{
  "operations": [
    {"type": "UPSERT_PERSON", "slug": "jackson-geiger", "content_to_merge": "- 2026-04-20: Sent NWMedia 151AC syllabus"},
    {"type": "UPSERT_PROJECT", "slug": "nwmedia-151ac", "content_to_merge": "- Syllabus found at ~/Downloads/nwmedia-syllabus.pdf"},
    {"type": "APPEND_DECISION", "slug": "use-openai-embeddings", "content": "---\\ntype: decision\\n---\\n# Use OpenAI embeddings\\nDecided to use text-embedding-3-small for semantic search.\\n\\n**Rationale:** cost-effective, good quality at small scale."},
    {"type": "APPEND_INSIGHT", "slug": "prisma-singleton-caching", "content": "---\\ntype: insight\\n---\\n# Prisma singleton stays stale across hot reloads\\nMust restart dev server after schema changes."},
    {"type": "UPDATE_WORKING_CONTEXT", "content": "---\\ntype: working-context\\n---\\n# Working context\\n..."}
  ],
  "log_entry": "One-line summary of what happened in this session."
}

If nothing durable emerged, return {"operations":[],"log_entry":""}.
SKIP anything about: financial accounts, medical info, SSN/passport, bank details.

Conversation:
${transcript}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (err) {
    console.error('[vault-writer] extraction/parse failed:', err);
    return;
  }

  if (!parsed.operations?.length && !parsed.log_entry) return;

  let queued = 0;
  for (const op of parsed.operations ?? []) {
    if (containsPrivateContent(JSON.stringify(op))) {
      console.warn('[vault-writer] skipping op with private content:', op.type, (op as UpsertPersonOp).slug ?? '');
      continue;
    }
    if (op.type === 'UPSERT_PERSON' && isRestrictedFile(op.slug)) continue;
    try {
      if (await proposeOperation(op, conversationId)) queued++;
    } catch (err) {
      console.error('[vault-writer] op proposal failed:', op.type, err);
      await logError('proposeOperation', err);
    }
  }

  if (parsed.log_entry && !containsPrivateContent(parsed.log_entry)) {
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toTimeString().slice(0, 5);
    await proposeVaultWrite(
      { path: 'memory/log.md', content: `- ${date} ${time}: ${parsed.log_entry}`, mode: 'append', title: 'Memory log entry' },
      conversationId,
    );
    queued++;
  }

  console.log(`[vault-writer] queued ${queued} vault-write proposal(s) for conversation ${conversationId} (nothing written until approved)`);
}

// ── Propose a single operation as a vault_write PendingAction ─────────────────

async function proposeOperation(op: MemoryOp, conversationId?: string): Promise<boolean> {
  const propose = async (relPath: string, content: string) => {
    const abs = path.join(VAULT_PATH, relPath);
    const mode = existsSync(abs) ? 'overwrite' as const : 'create' as const;
    await proposeVaultWrite({ path: relPath, content, mode }, conversationId);
    return true;
  };

  if (op.type === 'UPSERT_PERSON') {
    const relPath = path.join('memory', 'people', `${op.slug}.md`);
    return propose(relPath, await buildUpsertContent(path.join(VAULT_PATH, relPath), op.content_to_merge, 'Recent interactions', 'person'));
  }
  if (op.type === 'UPSERT_PROJECT') {
    const relPath = path.join('memory', 'projects', `${op.slug}.md`);
    return propose(relPath, await buildUpsertContent(path.join(VAULT_PATH, relPath), op.content_to_merge, 'Updates', 'project'));
  }
  if (op.type === 'APPEND_DECISION') {
    const date = new Date().toISOString().slice(0, 10);
    return propose(path.join('memory', 'decisions', `${date}-${op.slug}.md`), op.content);
  }
  if (op.type === 'APPEND_INSIGHT') {
    const date = new Date().toISOString().slice(0, 10);
    return propose(path.join('memory', 'insights', `${date}-${op.slug}.md`), op.content);
  }
  if (op.type === 'UPDATE_WORKING_CONTEXT') {
    if (containsPrivateContent(op.content)) return false;
    return propose(path.join('memory', 'working-context.md'), op.content);
  }
  return false;
}

// ── Build the upserted content for a markdown file (pure: no writes) ──────────

async function buildUpsertContent(
  filePath: string,
  appendContent: string,
  sectionHeader: string,
  fileType: 'person' | 'project',
  source = 'conversation',
  confidence = 0.9
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf-8');
  } catch {
    // New file — scaffold with full Phase 7 frontmatter schema
    const slug = path.basename(filePath, '.md');
    const fm = {
      type: fileType,
      updated: today,
      last_verified: today,
      confidence,
      source,
      source_facts: [{ source, date: today, claim: `Created via ${source}` }],
    };
    existing = matter.stringify(`\n# ${slug}\n\n## ${sectionHeader}\n`, fm);
  }

  // Append under the section header
  const sectionRegex = new RegExp(`(## ${sectionHeader}[ \\t]*\\n)`, 'i');
  if (sectionRegex.test(existing)) {
    existing = existing.replace(sectionRegex, `$1${appendContent}\n`);
  } else {
    existing += `\n\n## ${sectionHeader}\n${appendContent}\n`;
  }

  // Update frontmatter timestamps and inject freshness fields if missing
  existing = existing.replace(/updated:\s*\S+/, `updated: ${today}`);
  if (existing.includes('last_verified:')) {
    existing = existing.replace(/last_verified:\s*\S+/, `last_verified: ${today}`);
  } else {
    existing = existing.replace(/(updated:\s*\S+)/, `$1\nlast_verified: ${today}\nconfidence: ${confidence}`);
  }

  return existing;
}

/**
 * Propose a freshness update (last_verified / confidence frontmatter) for an
 * existing memory file. B-12: queued as a vault_write PendingAction.
 */
export async function touchMemoryFile(filePath: string, newConfidence?: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    let content = await readFile(filePath, 'utf-8');
    content = content.replace(/updated:\s*\S+/, `updated: ${today}`);
    if (content.includes('last_verified:')) {
      content = content.replace(/last_verified:\s*\S+/, `last_verified: ${today}`);
    } else {
      content = content.replace(/(updated:\s*\S+)/, `$1\nlast_verified: ${today}`);
    }
    if (newConfidence !== undefined) {
      if (content.includes('confidence:')) {
        content = content.replace(/confidence:\s*[\d.]+/, `confidence: ${newConfidence.toFixed(2)}`);
      } else {
        content = content.replace(/(last_verified:\s*\S+)/, `$1\nconfidence: ${newConfidence.toFixed(2)}`);
      }
    }
    await proposeVaultWrite({
      path: path.relative(VAULT_PATH, filePath),
      content,
      mode: 'overwrite',
      title: 'Memory freshness update',
    });
  } catch (err) {
    await logError('touchMemoryFile', err);
    throw err;
  }
}

// (regenerateIndex moved to lib/memory-index.ts — invoked ONLY by the
//  vault_write executor after an approved memory/ write. B-12.)

// ── Phase 7 backfill — add missing frontmatter fields to existing files ────────

export async function backfillFrontmatter(): Promise<{ path: string; added: string[] }[]> {
  const today = new Date().toISOString().slice(0, 10);
  const results: { path: string; added: string[] }[] = [];

  for (const folder of ['people', 'projects'] as const) {
    const dir = path.join(MEMORY_PATH, folder);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const filename of files) {
      if (!filename.endsWith('.md')) continue;
      const filePath = path.join(dir, filename);
      const raw = await readFile(filePath, 'utf-8').catch(() => '');
      if (!raw) continue;

      const parsed = matter(raw);
      const data = { ...parsed.data } as Record<string, unknown>;
      const added: string[] = [];

      if (!data.last_verified) {
        data.last_verified = data.updated ?? today;
        added.push('last_verified');
      }
      if (typeof data.confidence !== 'number') {
        data.confidence = 0.85;
        added.push('confidence');
      }
      if (!Array.isArray(data.source_facts)) {
        data.source_facts = [
          {
            source: 'initial scaffolding',
            date: data.updated ?? today,
            claim: 'Created during memory system Phase 1 setup',
          },
        ];
        added.push('source_facts');
      }

      if (added.length === 0) continue;

      // B-12: backfill is proposed per file, never written directly.
      const updated = matter.stringify(parsed.content, data);
      await proposeVaultWrite({
        path: `memory/${folder}/${filename}`,
        content: updated,
        mode: 'overwrite',
        title: `Frontmatter backfill (${added.join(', ')})`,
      });
      results.push({ path: `${folder}/${filename}`, added });
    }
  }

  return results;
}
