/**
 * Conversation memory system for Hatch.
 *
 * After each conversation, Claude extracts structured facts (people, courses,
 * projects, decisions, preferences) and stores them in the Memory table.
 * On each new chat request, relevant memories are injected into the system prompt.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from './models';
import { prisma } from './prisma';
import { createPendingAction, executePendingAction } from '@/lib/pending-actions';
import { decayConfidence } from './vault-writer';
import { ROUTES } from '@/lib/models';

type Memory = Awaited<ReturnType<typeof prisma.memory.findFirst>> & object;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Extract memories from a completed conversation ────────────────────────────

export async function extractMemoriesFromConversation(conversationId: string): Promise<Memory[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });

  if (messages.length < 2) return [];

  // Build a transcript (cap at ~15k chars to fit in a short Claude call)
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`)
    .join('\n\n')
    .slice(0, 15_000);

  let parsed: Array<{
    category: string;
    key: string;
    value: Record<string, unknown>;
    confidence?: number;
  }> = [];

  try {
    const response = await anthropic.messages.create({
      model: ROUTES.APP_DEFAULT, // upgraded from Haiku per spec — extraction now goes through default chat tier
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Analyze this conversation between Anatole (user) and Hatch (assistant). Extract persistent facts about Anatole that will be useful in future conversations.

Focus on:
- People he knows (name, email, role, relationship)
- Courses he takes (code, name, professor, term)
- Projects he works on (name, status, context)
- Decisions he made
- Preferences or working style
- Specific facts he stated about himself

Return ONLY valid JSON — no prose, no markdown fences:

{"memories":[{"category":"person"|"course"|"project"|"preference"|"fact"|"decision","key":"kebab_case_id","value":{...},"confidence":0.0-1.0}]}

Examples of good memories:
{"category":"person","key":"jackson-geiger","value":{"name":"Jackson Geiger","email":"jacksongeiger@berkeley.edu","relationship":"roommate"},"confidence":1.0}
{"category":"course","key":"nwmedia-151ac","value":{"code":"NWMedia 151AC","term":"Summer 2026","modality":"online"},"confidence":0.95}

Only extract clearly stated or strongly implied facts. Skip trivial small talk. Aim for 0-8 memories.

Conversation:
${transcript}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const obj = JSON.parse(clean);
    parsed = Array.isArray(obj.memories) ? obj.memories : [];
  } catch (err) {
    console.error('[memory] extractMemories parse failed:', err);
    return [];
  }

  // B-12: extraction PROPOSES — every fact becomes a memory_write PendingAction
  // (store 'db'); nothing reaches the Memory table until the user approves the
  // card. The userEdited protection now lives in the executor.
  let queued = 0;
  for (const mem of parsed) {
    if (!mem.category || !mem.key) continue;
    try {
      await createPendingAction(
        'memory_write',
        {
          category: mem.category,
          key: mem.key,
          value: JSON.stringify(mem.value ?? {}),
          store: 'db',
          confidence: mem.confidence ?? 1.0,
        },
        conversationId,
      );
      queued++;
    } catch (err) {
      console.error('[memory] proposal failed for', mem.key, err);
    }
  }

  console.log(`[memory] queued ${queued} memory proposal(s) from conversation ${conversationId} (nothing saved until approved)`);
  return [];
}

// ── Retrieve memories for injection into chat context ─────────────────────────

/**
 * Returns memories ordered by recency, with confidence decayed at read
 * time (audit risk #5). Decay uses a 60-day half-life from lastSeenAt;
 * the stored DB value is left untouched — this is a pure read-side
 * transform. After decaying, rows are re-sorted by decayed confidence
 * within their recency bucket so stale facts surface less prominently.
 */
export async function getAllMemories(limit = 50): Promise<Memory[]> {
  const rows = await prisma.memory.findMany({
    orderBy: [{ lastSeenAt: 'desc' }, { confidence: 'desc' }],
    take: limit,
  });
  return rows.map((m) => {
    const decayed = decayConfidence({
      last_verified: new Date(m.lastSeenAt).toISOString(),
      confidence:    m.confidence,
    });
    return { ...m, confidence: decayed };
  });
}

export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (!memories.length) return '';

  const byCategory: Record<string, string[]> = {};

  for (const mem of memories) {
    let valueStr: string;
    try {
      const v = JSON.parse(mem.value);
      valueStr = Object.entries(v)
        .map(([k, val]) => `${k}: ${val}`)
        .join(', ');
    } catch {
      valueStr = mem.value;
    }
    const cat = mem.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(`  • [${mem.key}] ${valueStr}`);
  }

  const lines = Object.entries(byCategory)
    .map(([cat, items]) => `${cat.toUpperCase()}:\n${items.join('\n')}`)
    .join('\n\n');

  return lines;
}

// ── CRUD for API routes ────────────────────────────────────────────────────────

export async function listMemories(): Promise<Memory[]> {
  // Newest-first. The Memory modal groups by category for display, then
  // sorts within each category by this same createdAt — so adding a fact
  // makes it appear at the top of its section regardless of what category
  // it lands in.
  return prisma.memory.findMany({ orderBy: [{ createdAt: 'desc' }] });
}

export async function deleteMemory(id: string): Promise<void> {
  // B-12: user-gesture delete from the Memory modal — through the executor.
  await executePendingAction('memory_delete', { id });
}

/**
 * Updates a memory's value via the Memory modal. Sets `userEdited=true`
 * so the auto-extractor knows to leave this row's value/confidence alone
 * on its next pass (audit risk #3).
 */
export async function updateMemory(id: string, value: string): Promise<Memory> {
  // B-12: the write goes through the pending-action executor (the single
  // Memory-table writer). The modal edit is an explicit user gesture on the
  // exact content — same direct-executor precedent as the interview flow.
  const row = await prisma.memory.findUnique({ where: { id } });
  if (!row) throw new Error(`Memory row not found: ${id}`);
  await executePendingAction('memory_write', {
    category: row.category, key: row.key, value, store: 'db', id, userEdited: true,
  });
  const updated = await prisma.memory.findUnique({ where: { id } });
  if (!updated) throw new Error(`Memory row vanished after update: ${id}`);
  return updated;
}
