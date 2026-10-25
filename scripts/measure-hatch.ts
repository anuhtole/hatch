/**
 * scripts/measure-hatch.ts
 *
 * Derive ONLY mechanically-measurable metrics from THIS repo — each paired with the
 * exact shell command that reproduces it — and write them into the Hatch vault file
 * as grounded, provenance-annotated claims. NEVER writes a metric it didn't measure.
 * User-impact / time / usage metrics are NOT measurable here and are left as
 * TODO(Anatole) in the vault (not touched by this script).
 *
 * Run:  npx tsx scripts/measure-hatch.ts          (prints the table + writes vault)
 *       npx tsx scripts/measure-hatch.ts --dry     (prints only, no vault write)
 *
 * The vault write is a MANAGED BLOCK between markers — re-runs replace it in place
 * and never delete other claims.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const REPO = join(process.env.HOME ?? '', 'hatch');
const VAULT_FILE = join(process.env.HOME ?? '', 'vault', '04-projects', 'hatch', 'hatch.md');
const BEGIN = '<!-- BEGIN measured-metrics (scripts/measure-hatch.ts) -->';
const END = '<!-- END measured-metrics -->';

const today = new Date().toISOString().slice(0, 10);

interface Metric {
  key: string;
  label: string;
  command: string;     // the literal reproducing command (run via sh -c)
  parse?: (out: string) => string; // stdout → value (default: trimmed first int)
  value?: string;
  /** The grounded résumé claim sentence (number-bearing, unit-attached). */
  claim: (v: string) => string;
}

const firstInt = (out: string) => (out.match(/\d[\d,]*/)?.[0] ?? '0');

const METRICS: Metric[] = [
  {
    key: 'tools',
    label: 'model-callable tools',
    command: `grep -cE "^[[:space:]]+name: '" lib/claude.ts`,
    claim: (v) => `Exposed ${v} model-callable tools spanning email, calendar, Drive, Canvas, vault, memory, trackers, and the job pipeline from a single streaming agent.`,
  },
  {
    key: 'apiRoutes',
    label: 'API route handlers',
    command: `find app/api -name route.ts | wc -l`,
    claim: (v) => `Implemented ${v} Next.js API route handlers backing the chat agent, OAuth integrations, and résumé pipeline.`,
  },
  {
    key: 'prismaModels',
    label: 'Prisma models',
    command: `grep -c "^model " prisma/schema.prisma`,
    claim: (v) => `Modeled the application domain in ${v} Prisma models on SQLite/libSQL.`,
  },
  {
    key: 'guardScripts',
    label: 'anti-fabrication guard scripts',
    command: `ls lib/resume/check-*.ts | wc -l`,
    claim: (v) => `Enforced output integrity with ${v} layered anti-fabrication guard scripts (numeric provenance, résumé drift, cover-letter drift, and education membership).`,
  },
  {
    key: 'resumeModules',
    label: 'résumé-pipeline TypeScript modules',
    command: `ls lib/resume/*.ts | wc -l`,
    claim: (v) => `Built the vault-grounded résumé/cover-letter pipeline as ${v} TypeScript modules.`,
  },
  {
    key: 'tsLoc',
    label: 'lines of TypeScript (lib/app/components)',
    command: `find lib app components -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1`,
    parse: (out) => firstInt(out),
    claim: (v) => `Authored ${v} lines of application TypeScript across lib/, app/, and components/.`,
  },
  {
    key: 'branchCommits',
    label: 'commits on the redesign branch',
    command: `git rev-list --count main..HEAD`,
    claim: (v) => `Shipped the redesign across ${v} commits on the active feature branch.`,
  },
];

function measure(): Metric[] {
  for (const m of METRICS) {
    const out = execSync(m.command, { cwd: REPO, encoding: 'utf-8', shell: '/bin/sh' });
    m.value = (m.parse ? m.parse(out) : firstInt(out)).trim();
  }
  return METRICS;
}

function printTable(metrics: Metric[]): void {
  const w1 = Math.max(...metrics.map((m) => m.label.length), 6);
  console.log('=== HATCH MEASURED METRICS (metric → value → command) ===');
  for (const m of metrics) {
    console.log(`  ${m.label.padEnd(w1)} │ ${String(m.value).padStart(7)} │ ${m.command}`);
  }
}

function buildBlock(metrics: Metric[]): string {
  const lines: string[] = [BEGIN, '', '## Engineering Metrics (mechanically measured)', ''];
  for (const m of metrics) {
    // Provenance lives in the source: a separate annotation line (kept OUT of the
    // claim text) records the exact command + date. The bullet itself is clean.
    lines.push(`<!-- measured: ${m.command} @ ${today} -->`);
    lines.push(`- ${m.claim(m.value!)}`);
  }
  lines.push('', END);
  return lines.join('\n');
}

function writeVault(block: string): void {
  const src = readFileSync(VAULT_FILE, 'utf-8');
  let next: string;
  if (src.includes(BEGIN) && src.includes(END)) {
    next = src.replace(new RegExp(`${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}`), block);
  } else {
    next = `${src.trimEnd()}\n\n${block}\n`;
  }
  writeFileSync(VAULT_FILE, next);
  console.log(`\n[measure-hatch] wrote managed block → ${VAULT_FILE}`);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function main(): void {
  const dry = process.argv.includes('--dry');
  const metrics = measure();
  printTable(metrics);
  const block = buildBlock(metrics);
  console.log(`\n=== MANAGED BLOCK (written verbatim unless --dry) ===\n${block}`);
  if (!dry) writeVault(block);
  else console.log('\n[measure-hatch] --dry: vault NOT written.');
}

main();
