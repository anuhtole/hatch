import { NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';

export const runtime = 'nodejs';

const VAULT_PATH = process.env.VAULT_PATH || path.join(os.homedir(), 'vault');
const MEMORY_PATH = path.join(VAULT_PATH, 'memory');

function daysAgo(dateStr: string): number | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export type MemoryFileStatus = {
  slug: string;
  subdir: string;
  type: string;
  lastVerified: string | null;
  daysOld: number | null;
  confidence: number | null;
  source: string | null;
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
};

async function readSubdir(subdir: string): Promise<MemoryFileStatus[]> {
  const dir = path.join(MEMORY_PATH, subdir);
  const results: MemoryFileStatus[] = [];
  try {
    const files = await readdir(dir);
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      const raw = await readFile(path.join(dir, f), 'utf-8').catch(() => '');
      if (!raw) continue;
      const { data } = matter(raw);

      const lastVerified = data.last_verified ? String(data.last_verified) : null;
      const confidence = typeof data.confidence === 'number' ? data.confidence : null;
      const type = data.type ? String(data.type) : subdir.replace(/s$/, '');

      // source: top-level field, or fall back to source_facts[0].source
      const sourceFacts = Array.isArray(data.source_facts) ? data.source_facts : [];
      const source: string | null =
        data.source ? String(data.source) :
        sourceFacts[0]?.source ? String(sourceFacts[0].source) :
        null;

      const days = lastVerified ? daysAgo(lastVerified) : null;
      const freshness: MemoryFileStatus['freshness'] =
        days === null ? 'unknown' : days > 90 ? 'stale' : days > 30 ? 'aging' : 'fresh';

      results.push({
        slug: f.replace('.md', ''),
        subdir,
        type,
        lastVerified: lastVerified ?? null,
        daysOld: days,
        confidence,
        source,
        freshness,
      });
    }
  } catch { /* dir missing */ }
  return results;
}

export async function GET(): Promise<NextResponse> {
  const [people, projects] = await Promise.all([
    readSubdir('people'),
    readSubdir('projects'),
  ]);

  // Read gaps.md summary
  let gapsSummary: string[] = [];
  try {
    const gapsContent = await readFile(path.join(os.homedir(), 'hatch', 'out', 'memory-logs', 'gaps.md'), 'utf-8');
    gapsSummary = gapsContent
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2));
  } catch { /* gaps.md may not exist */ }

  return NextResponse.json({ people, projects, gapsSummary });
}
