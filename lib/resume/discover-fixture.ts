/**
 * lib/resume/discover-fixture.ts — CLI frontend for lab target discovery.
 *
 *   npm run resume:discover -- --lab=bair            (labRoot from targets/<lab>.json)
 *   npm run resume:discover -- --lab=chai --root=https://humancompatible.ai
 *
 * Writes out/<lab>/discovery.{md,json} and prints the shortlist. Produces a
 * SHORTLIST FOR APPROVAL only — never an outreach draft.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { join } from 'path';
import { homedir } from 'os';
import { readFileSync } from 'fs';
import { discoverLab, writeDiscovery } from '@/lib/resume/discover';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main(): Promise<void> {
  const lab = arg('lab');
  if (!lab) { console.error('usage: npm run resume:discover -- --lab=<name> [--root=<url>]'); process.exit(2); }

  let root = arg('root');
  if (!root) {
    const def = JSON.parse(readFileSync(join(homedir(), 'hatch', 'targets', `${lab}.json`), 'utf-8')) as { labRoot?: string };
    if (!def.labRoot) { console.error(`targets/${lab}.json has no "labRoot" and no --root given`); process.exit(2); }
    root = def.labRoot;
  }

  console.log(`\n── discovery: ${lab} ──`);
  const d = await discoverLab(lab, root, (s) => console.log(s));
  const { mdPath, jsonPath } = writeDiscovery(d);

  console.log(`\n── SHORTLIST (${d.shortlist.length}) — approval required before any outreach ──`);
  for (const g of d.shortlist) {
    const contact =
      g.contact?.kind === 'email' ? `${g.contact.value} (published: ${g.contact.sourceUrl})`
      : g.contact?.kind === 'application-page' ? `application page only — ${g.contact.value}`
      : 'application page only (no published route)';
    console.log(`  ${String(g.fitScore).padStart(3)}/100  ${g.name}${g.pi ? ` (PI: ${g.pi})` : ''}`);
    for (const r of g.rationales) console.log(`           · ${r.text} [${r.claimId} | ${r.sourceUrl}]`);
    console.log(`           contact: ${contact}`);
  }
  console.log(`\nwrote ${mdPath}`);
  console.log(`wrote ${jsonPath}`);
}

main().catch((e) => { console.error('DISCOVERY FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
