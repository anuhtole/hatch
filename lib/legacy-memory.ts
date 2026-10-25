/**
 * Legacy flat memory.json — the second of three memory layers the chat
 * route injects into the system prompt (Layer 2 in app/api/chat/route.ts).
 *
 * Historically this file held auto-extracted contacts/courses/etc., with
 * read/write helpers inlined in the chat route. Extracted here so the
 * Memory modal's manual add/edit/delete endpoints can dual-write into
 * the same file — without that, manual facts only land in the Prisma
 * Memory table and chat retrieval misses them.
 *
 * Manual facts go into `manual_facts`, keyed by the Prisma Memory row
 * id (so updates and deletes from the modal can find them back).
 */

import fs from 'fs';
import path from 'path';

const MEMORY_PATH = path.join(process.cwd(), 'memory.json');

export interface LegacyMemory {
  contacts: Record<string, unknown>;
  courses: Record<string, unknown>;
  user_preferences: Record<string, unknown>;
  corrections: unknown[];
  files: Record<string, unknown>;
  manual_facts?: Record<string, ManualFact>;
  [k: string]: unknown;
}

export interface ManualFact {
  id: string;       // mirrors prisma.memory.id
  text: string;
  category: string; // mirrors prisma.memory.category
  addedAt: string;
  updatedAt: string;
}

function emptyMemory(): LegacyMemory {
  return { contacts: {}, courses: {}, user_preferences: {}, corrections: [], files: {} };
}

export function readMemory(): LegacyMemory {
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    // Defensive defaults — preserves any extra keys the chat route may
    // have written that aren't in our type.
    return { ...emptyMemory(), ...parsed };
  } catch {
    return emptyMemory();
  }
}

export function writeMemoryCategoryKey(category: string, key: string, value: unknown): void {
  const mem = readMemory();
  if (category === 'corrections' && Array.isArray(mem.corrections)) {
    mem.corrections.push(value);
  } else {
    if (!mem[category]) mem[category] = {};
    (mem[category] as Record<string, unknown>)[key] = value;
  }
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2), 'utf-8');
}

// ── Manual fact mirrors (used by /api/memories) ─────────────────────────

export function addManualFactToLegacy(fact: ManualFact): void {
  const mem = readMemory();
  if (!mem.manual_facts) mem.manual_facts = {};
  mem.manual_facts[fact.id] = fact;
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2), 'utf-8');
}

export function updateManualFactInLegacy(id: string, patch: Partial<ManualFact>): void {
  const mem = readMemory();
  if (!mem.manual_facts || !mem.manual_facts[id]) return;
  mem.manual_facts[id] = {
    ...mem.manual_facts[id],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2), 'utf-8');
}

export function removeManualFactFromLegacy(id: string): void {
  const mem = readMemory();
  if (!mem.manual_facts || !mem.manual_facts[id]) return;
  delete mem.manual_facts[id];
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2), 'utf-8');
}
