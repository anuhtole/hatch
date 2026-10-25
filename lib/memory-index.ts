/**
 * lib/memory-index.ts — derived ~/vault/memory/index.md regeneration (B-12).
 *
 * Moved out of vault-writer so the ONLY caller is the vault_write executor in
 * lib/pending-actions.ts: after an approved write lands under memory/, the
 * index (a derived catalog, not content) is regenerated and the prompt-side
 * memory cache busted. Containment assert F keeps this module import-locked to
 * pending-actions.
 */

import { writeFile, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { invalidateMemoryCache } from '@/lib/vault-memory';

const MEMORY_PATH = path.join(process.env.VAULT_PATH || path.join(os.homedir(), 'vault'), 'memory');

async function listMd(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', ''));
  } catch {
    return [];
  }
}

export async function regenerateMemoryIndex(): Promise<void> {
  const [people, projects, decisions, insights] = await Promise.all([
    listMd(path.join(MEMORY_PATH, 'people')),
    listMd(path.join(MEMORY_PATH, 'projects')),
    listMd(path.join(MEMORY_PATH, 'decisions')),
    listMd(path.join(MEMORY_PATH, 'insights')),
  ]);

  const index = `---
type: index
updated: ${new Date().toISOString().slice(0, 10)}
---

# Memory index

Auto-regenerated catalog of all memory pages.

## People
${people.map((p) => `- [[people/${p}]]`).join('\n') || '- (none yet)'}

## Projects
${projects.map((p) => `- [[projects/${p}]]`).join('\n') || '- (none yet)'}

## Recent decisions
${decisions.slice(-10).map((d) => `- [[decisions/${d}]]`).join('\n') || '- (none yet)'}

## Recent insights
${insights.slice(-10).map((i) => `- [[insights/${i}]]`).join('\n') || '- (none yet)'}
`;

  await writeFile(path.join(MEMORY_PATH, 'index.md'), index);
  invalidateMemoryCache();
}
