/**
 * career-ops integration for Hatch.
 *
 * Thin wrapper around the career-ops CLI scripts at CAREER_OPS_PATH.
 * Exposes typed helpers for the daily briefing, Claude tools, and pipeline UI.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from './models';
import { execFile, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { readdirSync, existsSync } from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const CAREER_OPS_PATH = process.env.CAREER_OPS_PATH || path.join(process.env.HOME || '', 'career-ops');
const APPS_FILE = path.join(CAREER_OPS_PATH, 'data', 'applications.md');
const PIPELINE_FILE = path.join(CAREER_OPS_PATH, 'data', 'pipeline.md');

// ── Claude binary resolver ─────────────────────────────────────────────────────
//
// Node's spawn() uses a stripped-down PATH — it won't find binaries that are
// only on the interactive shell PATH (e.g. VSCode extension binaries, ~/.local/bin).
// This function resolves the absolute path once at startup so every spawn call works.

let _claudeBin: string | null = null;

function getClaudeBin(): string {
  if (_claudeBin) return _claudeBin;

  // 1. Explicit override from .env.local — always wins
  if (process.env.CLAUDE_CLI_PATH) {
    _claudeBin = process.env.CLAUDE_CLI_PATH;
    return _claudeBin;
  }

  // 2. Try the interactive shell (catches npm global installs, ~/.local/bin, etc.)
  try {
    const found = execSync('command -v claude', {
      shell: '/bin/zsh',
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (found) {
      _claudeBin = found;
      return _claudeBin;
    }
  } catch { /* not on shell PATH either */ }

  // 3. VSCode extension bundled binary — find the newest installed version
  const extensionsDir = path.join(process.env.HOME || '', '.vscode', 'extensions');
  try {
    const dirs = readdirSync(extensionsDir)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse(); // lexicographic sort puts newest semver last → reverse to get newest first
    for (const dir of dirs) {
      const candidate = path.join(extensionsDir, dir, 'resources', 'native-binary', 'claude');
      if (existsSync(candidate)) {
        _claudeBin = candidate;
        return _claudeBin;
      }
    }
  } catch { /* no .vscode/extensions dir */ }

  // 4. Common fallback paths
  const fallbacks = [
    `${process.env.HOME}/.npm-global/bin/claude`,
    `${process.env.HOME}/.claude/bin/claude`,
    `${process.env.HOME}/.local/bin/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of fallbacks) {
    if (existsSync(p)) {
      _claudeBin = p;
      return _claudeBin;
    }
  }

  throw new Error(
    'Claude CLI not found. Set CLAUDE_CLI_PATH in .env.local to the absolute path of your claude binary, ' +
    'or install Claude Code from https://claude.ai/download.'
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Application {
  num: number;
  date: string;
  company: string;
  role: string;
  status: string;
  score: string | null;
  pdf: boolean;
  reportUrl: string | null;
  notes: string;
}

export interface FollowupEntry {
  num: number;
  company: string;
  role: string;
  status: string;
  daysSinceApplied: number | null;
  followupDue: boolean;
  daysOverdue: number | null;
  contact: string | null;
}

export interface PatternResult {
  patterns: Array<{
    dimension: string;
    value: string;
    count: number;
    positiveRate: number;
    insight: string;
  }>;
  totalApplications: number;
}

export interface PipelineSummary {
  total: number;
  byStatus: Record<string, number>;
  applications: Application[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runScript(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync('node', [path.join(CAREER_OPS_PATH, script), ...args], {
    cwd: CAREER_OPS_PATH,
    timeout: 30_000,
  });
  return stdout;
}

function parseApplicationsTable(md: string): Application[] {
  const lines = md.split('\n');
  const tableStart = lines.findIndex((l) => l.includes('| # |') || l.includes('|---|'));
  if (tableStart === -1) return [];

  const rows = lines.slice(tableStart + 2).filter((l) => l.startsWith('|') && !l.startsWith('|---'));
  return rows.map((row) => {
    const cols = (row ?? '').split('|').map((c) => c.trim()).filter(Boolean);
    if (cols.length < 7) return null;
    const [numStr, date, company, role, status, scoreRaw, pdfRaw, reportRaw, ...notesParts] = cols;
    const scoreMatch = scoreRaw?.match(/[\d.]+\/5/);
    const reportMatch = reportRaw?.match(/\[(\d+)\]\(([^)]+)\)/);
    return {
      num: parseInt(numStr) || 0,
      date: date || '',
      company: company || '',
      role: role || '',
      status: status?.replace(/\*\*/g, '').trim() || '',
      score: scoreMatch ? scoreMatch[0] : null,
      pdf: pdfRaw?.includes('✅') || false,
      reportUrl: reportMatch ? reportMatch[2] : null,
      notes: notesParts.join(' ').trim(),
    } as Application;
  }).filter(Boolean) as Application[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read and parse the current applications tracker.
 */
export async function getApplicationsPipeline(): Promise<PipelineSummary> {
  let md = '';
  try {
    md = await readFile(APPS_FILE, 'utf-8');
  } catch {
    return { total: 0, byStatus: {}, applications: [] };
  }

  const applications = parseApplicationsTable(md);
  const byStatus: Record<string, number> = {};
  for (const app of applications) {
    const s = app.status.toLowerCase();
    byStatus[s] = (byStatus[s] || 0) + 1;
  }

  return { total: applications.length, byStatus, applications };
}

/**
 * Get follow-ups due today using followup-cadence.mjs.
 */
export async function getFollowupsDue(): Promise<FollowupEntry[]> {
  try {
    const json = await runScript('followup-cadence.mjs', ['--overdue-only']);
    const parsed = JSON.parse(json);
    const entries: FollowupEntry[] = (parsed.followups ?? parsed.entries ?? []).map(
      (e: Record<string, unknown>) => ({
        num: Number(e.num) || 0,
        company: String(e.company || ''),
        role: String(e.role || ''),
        status: String(e.status || ''),
        daysSinceApplied: e.days_since_applied != null ? Number(e.days_since_applied) : null,
        followupDue: Boolean(e.followup_due ?? e.overdue),
        daysOverdue: e.days_overdue != null ? Number(e.days_overdue) : null,
        contact: e.contact != null ? String(e.contact) : null,
      })
    );
    return entries;
  } catch {
    return [];
  }
}

/**
 * Get rejection pattern analysis using analyze-patterns.mjs.
 */
export async function getPatterns(): Promise<PatternResult> {
  try {
    const json = await runScript('analyze-patterns.mjs');
    const parsed = JSON.parse(json);
    return {
      patterns: parsed.patterns ?? [],
      totalApplications: parsed.total ?? 0,
    };
  } catch {
    return { patterns: [], totalApplications: 0 };
  }
}

/**
 * Add a URL to the pipeline inbox (data/pipeline.md) for later evaluation.
 */
export async function addToPipeline(url: string, notes = ''): Promise<void> {
  await mkdir(path.dirname(PIPELINE_FILE), { recursive: true });
  let existing = '';
  try {
    existing = await readFile(PIPELINE_FILE, 'utf-8');
  } catch {
    existing = '# Pipeline Inbox\n\nPaste job URLs here for evaluation.\n\n';
  }
  const line = `- ${url}${notes ? ` — ${notes}` : ''}\n`;
  await writeFile(PIPELINE_FILE, existing + line);
}

/**
 * Brief summary for the daily briefing (≤ 3 bullets).
 * Returns null if no pipeline data exists yet.
 */
export async function getDailyCareerBrief(): Promise<string | null> {
  const [pipeline, followups] = await Promise.all([
    getApplicationsPipeline(),
    getFollowupsDue(),
  ]);

  if (pipeline.total === 0 && followups.length === 0) return null;

  const lines: string[] = [];

  if (pipeline.total > 0) {
    const active = (pipeline.byStatus['applied'] ?? 0) +
      (pipeline.byStatus['interview'] ?? 0) +
      (pipeline.byStatus['responded'] ?? 0);
    lines.push(`**Pipeline:** ${pipeline.total} tracked — ${active} active (applied/interview/responded)`);
  }

  if (followups.length > 0) {
    const companies = followups.slice(0, 3).map((f) => f.company).join(', ');
    lines.push(`**Follow-ups due:** ${companies}${followups.length > 3 ? ` +${followups.length - 3} more` : ''}`);
  }

  if (pipeline.byStatus['offer']) {
    lines.push(`**Offers in hand:** ${pipeline.byStatus['offer']}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

// ── Types (Phase 4) ───────────────────────────────────────────────────────────

export interface ScanJob {
  url: string;
  title: string;
  company: string;
  portal: string;
  scannedAt: string;
}

export interface ScanResult {
  totalScanned: number;
  newJobs: ScanJob[];
  companyCount: number;
}

export interface EvaluationResult {
  reportPath: string;
  company: string;
  role: string;
  score: number;
  archetype: string;
  legitimacy: string;
  topStrengths: string[];
  topGaps: string[];
  starStories: string[];
}

export interface InterviewPrepResult {
  company: string;
  role: string;
  starStories: string[];
  likelyQuestions: string[];
  proofPoints: string[];
  companyContext: string;
}

// ── Helpers (Phase 4) ─────────────────────────────────────────────────────────

async function parseScanHistory(): Promise<ScanJob[]> {
  const tsvPath = path.join(CAREER_OPS_PATH, 'data', 'scan-history.tsv');
  try {
    const content = await readFile(tsvPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];
    const [header, ...rows] = lines;
    const cols = header.split('\t');
    return rows.map((row) => {
      const vals = row.split('\t');
      const obj: Record<string, string> = {};
      cols.forEach((c, i) => { obj[c.trim()] = vals[i]?.trim() ?? ''; });
      return {
        url: obj['url'] ?? '',
        title: obj['title'] ?? '',
        company: obj['company'] ?? '',
        portal: obj['portal'] ?? '',
        scannedAt: obj['first_seen'] ?? '',
      } as ScanJob;
    }).filter((j) => j.url);
  } catch {
    return [];
  }
}


function extractListAfterHeading(md: string, heading: string, max: number): string[] {
  const patterns = [
    // Wrap heading in (?:...) so | alternation inside the heading string
    // doesn't break the outer regex structure and orphan the capture group.
    new RegExp(`##[^#]*(?:${heading})[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i'),
  ];
  for (const re of patterns) {
    const match = md.match(re);
    if (match) {
      return (match[1] ?? '')
        .split('\n')
        .map((l) => l.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean)
        .slice(0, max);
    }
  }
  return [];
}

async function parseEvaluationReport(reportPath: string): Promise<EvaluationResult> {
  const content = await readFile(reportPath, 'utf-8');

  // Header fields: **Score:** X/5, **Arquetipo:** ..., **Legitimacy:** ...
  const scoreMatch = content.match(/\*\*Score:\*\*\s*([\d.]+)/);
  const archetypeMatch = content.match(/\*\*Arquetipo:\*\*\s*(.+)/);
  const legitimacyMatch = content.match(/\*\*Legitimacy:\*\*\s*(.+)/);

  // Company + role from filename: {###}-{company-slug}-{YYYY-MM-DD}.md
  const filename = path.basename(reportPath, '.md');
  const parts = filename.split('-');
  const company = parts.slice(1, -3).join('-');
  const role = archetypeMatch?.[1]?.split('(')[0]?.trim() ?? 'Unknown';

  return {
    reportPath,
    company,
    role,
    score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
    archetype: archetypeMatch ? archetypeMatch[1].trim() : 'unknown',
    legitimacy: legitimacyMatch ? legitimacyMatch[1].trim() : 'unknown',
    topStrengths: extractListAfterHeading(content, 'Match|Fortalezas|Strengths', 3),
    topGaps: extractListAfterHeading(content, 'Gap|Brechas', 3),
    starStories: extractListAfterHeading(content, 'STAR|Historias', 5),
  };
}

export function extractCompanyFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // greenhouse: boards.greenhouse.io/company → company
    const ghMatch = hostname.match(/greenhouse\.io/) || url.match(/greenhouse\.io\/([^/?#]+)/);
    if (ghMatch && url.includes('greenhouse.io')) {
      const m = url.match(/greenhouse\.io\/([^/?#]+)/);
      if (m) return m[1];
    }
    // ashby: jobs.ashbyhq.com/company
    const ashbyM = hostname.match(/ashbyhq\.com/);
    if (ashbyM) {
      const m = url.match(/ashbyhq\.com\/([^/?#]+)/);
      if (m) return m[1];
    }
    // fallback: second-level domain
    const parts = hostname.replace(/^www\./, '').split('.');
    return parts[0];
  } catch {
    return 'unknown';
  }
}

export async function getMemoryForCompany(company: string): Promise<string> {
  const vaultPath = process.env.VAULT_PATH || path.join(process.env.HOME || '', 'vault');
  const projectsDir = path.join(vaultPath, 'memory', 'projects');
  try {
    const files = await readdir(projectsDir);
    const matching = files.filter((f) => f.toLowerCase().includes(company.toLowerCase()));
    let combined = '';
    for (const f of matching.slice(0, 3)) {
      const content = await readFile(path.join(projectsDir, f), 'utf-8');
      combined += `\n\n### ${f}\n${content}`;
    }
    return combined;
  } catch {
    return '';
  }
}

// (syncEvaluationToMemory removed in B-12 — ungated vault writer)


// ── JD fetch (for SDK-based evaluation) ──────────────────────────────────────

export async function fetchJobDescription(url: string): Promise<string> {
  // Try ATS-specific structured APIs first
  try {
    const ashbyMatch = url.match(/ashbyhq\.com\/([^/]+)\/([a-f0-9-]{36})/i);
    if (ashbyMatch) {
      const [, , jobId] = ashbyMatch;
      const res = await fetch(`https://api.ashbyhq.com/posting-public/jobPosting?jobPostingId=${jobId}`);
      if (res.ok) {
        const data = await res.json() as { title?: string; organizationName?: string; descriptionHtml?: string };
        return `# ${data.title ?? 'Role'} at ${data.organizationName ?? 'Company'}\n\n${(data.descriptionHtml ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`;
      }
    }

    const ghMatch = url.match(/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
    if (ghMatch) {
      const [, board, jobId] = ghMatch;
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`);
      if (res.ok) {
        const data = await res.json() as { title?: string; location?: { name?: string }; content?: string };
        return `# ${data.title ?? 'Role'}\nLocation: ${data.location?.name ?? 'Unknown'}\n\n${(data.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`;
      }
    }

    const leverMatch = url.match(/lever\.co\/([^/]+)\/([a-f0-9-]{36})/i);
    if (leverMatch) {
      const [, company, postingId] = leverMatch;
      const res = await fetch(`https://api.lever.co/v0/postings/${company}/${postingId}`);
      if (res.ok) {
        const data = await res.json() as { text?: string; description?: string; lists?: { text: string; content: string }[] };
        const sections = (data.lists ?? []).map((l) => `## ${l.text}\n${l.content}`).join('\n\n');
        return `# ${data.text ?? 'Role'} at ${company}\n\n${data.description ?? ''}\n\n${sections}`.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      }
    }
  } catch { /* fall through to plain fetch */ }

  // Plain HTML fallback
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Hatch/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await res.text();
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10_000);
}

async function getNextReportNumber(): Promise<number> {
  const reportsDir = path.join(CAREER_OPS_PATH, 'reports');
  try {
    const files = await readdir(reportsDir);
    const nums = files
      .filter((f) => f.endsWith('.md') && /^\d{3}-/.test(f))
      .map((f) => parseInt(f.slice(0, 3), 10))
      .filter((n) => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
  } catch {
    return 1;
  }
}

// ── Spawn helper (for portal scanner, PDF generator, interview prep) ──────────

function spawnPromise(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Process timed out after ${opts.timeoutMs / 1000}s`));
    }, opts.timeoutMs);

    proc.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      console.log('[career-ops stdout]', s.trimEnd());
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      console.log('[career-ops stderr]', s.trimEnd());
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      console.log(`[career-ops] process exited ${code} — stdout ${stdout.length}b stderr ${stderr.length}b`);
      if (code !== 0) return reject(new Error(`Process exited ${code}: ${stderr.slice(0, 500)}`));
      resolve(stdout);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Public API (Phase 4) ──────────────────────────────────────────────────────

/**
 * Run the zero-token portal scanner across all configured companies.
 * Parses scan-history.tsv for entries added today.
 */
export async function scanPortals(): Promise<ScanResult> {
  const today = new Date().toISOString().slice(0, 10);

  await spawnPromise('node', ['scan.mjs'], {
    cwd: CAREER_OPS_PATH,
    timeoutMs: 5 * 60 * 1000,
  });

  const history = await parseScanHistory();
  const allCompanies = new Set(history.map((j) => j.company));
  const newJobs = history.filter((j) => j.scannedAt === today);

  return {
    totalScanned: history.length,
    newJobs,
    companyCount: allCompanies.size,
  };
}

/**
 * Evaluate a single job URL using the career-ops A-F+G evaluation framework.
 * Fetches JD content directly, calls Anthropic SDK, writes report to reports/.
 */
export async function evaluateJob(jobUrl: string): Promise<EvaluationResult> {
  const company = extractCompanyFromUrl(jobUrl);

  // Fetch JD content
  let jdContent = '';
  try {
    console.log(`[career-ops] fetching JD from ${jobUrl}`);
    jdContent = await fetchJobDescription(jobUrl);
    console.log(`[career-ops] JD fetched — ${jdContent.length} chars`);
  } catch (err) {
    console.warn('[career-ops] JD fetch failed, proceeding with URL only:', err);
    jdContent = `URL: ${jobUrl}\n(Could not fetch content automatically — evaluate based on URL and any context available.)`;
  }

  // Load evaluation context from career-ops files
  const [ofertaMode, profile, cv, memCtx] = await Promise.all([
    readFile(path.join(CAREER_OPS_PATH, 'modes', 'oferta.md'), 'utf-8').catch(() => ''),
    readFile(path.join(CAREER_OPS_PATH, 'modes', '_profile.md'), 'utf-8').catch(() => ''),
    readFile(path.join(CAREER_OPS_PATH, 'cv.md'), 'utf-8').catch(() => ''),
    getMemoryForCompany(company),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  console.log(`[career-ops] calling Anthropic SDK for evaluation (oferta mode: ${ofertaMode.length}b profile: ${profile.length}b cv: ${cv.length}b)`);

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropicClient.messages.create({
    model: MODELS.DEEP,
    max_tokens: 8000,
    system: `You are a career evaluation AI for Anatole Seychal. Evaluate job postings using the following framework and generate complete evaluation reports.

## Evaluation Framework
${ofertaMode}

## Candidate Profile
${profile}

## Candidate CV
${cv}
${memCtx ? `\n## Prior Context on This Company\n${memCtx}` : ''}

Today's date: ${today}

CRITICAL: Generate the full evaluation report in the exact markdown format from the "Guardar report .md" section of the framework. Begin directly with "# Evaluación: {Company} — {Role}". Include all blocks A through G with full content. Do not truncate.`,
    messages: [{
      role: 'user',
      content: `Evaluate this job posting:\n\nURL: ${jobUrl}\n\nJob Description:\n${jdContent}`,
    }],
  });

  const reportText = msg.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('');

  console.log(`[career-ops] evaluation complete — ${reportText.length} chars`);

  // Write report to reports/
  const nextNum = await getNextReportNumber();
  const companySlug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = `${String(nextNum).padStart(3, '0')}-${companySlug}-${today}.md`;
  const reportPath = path.join(CAREER_OPS_PATH, 'reports', filename);
  await mkdir(path.join(CAREER_OPS_PATH, 'reports'), { recursive: true });
  await writeFile(reportPath, reportText, 'utf-8');
  console.log(`[career-ops] report written to ${reportPath}`);

  const result = await parseEvaluationReport(reportPath);
  // B-12: syncEvaluationToMemory REMOVED — it wrote ~/vault/memory ungated.
  // Evaluations stay in career-ops reports only; vault writes require PendingAction approval.

  return result;
}

/**
 * Pull STAR stories, company context, and likely interview questions for a given company+role.
 */
export async function getInterviewPrep(company: string, role: string): Promise<InterviewPrepResult> {
  const prompt = `Run interview-prep mode for company="${company}", role="${role}".

Pull all relevant STAR stories from interview-prep/story-bank.md that match this role. Do company research. Suggest 5 likely behavioral questions. Map each to Anatole's strongest proof points. Return structured output as JSON with fields: starStories (array of strings), likelyQuestions (array), proofPoints (array), companyContext (string).`;

  const stdout = await spawnPromise(getClaudeBin(), ['-p', prompt], {
    cwd: CAREER_OPS_PATH,
    timeoutMs: 8 * 60 * 1000,
  });

  // Try to parse JSON from stdout
  const jsonMatch = stdout.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        company,
        role,
        starStories: parsed.starStories ?? [],
        likelyQuestions: parsed.likelyQuestions ?? [],
        proofPoints: parsed.proofPoints ?? [],
        companyContext: parsed.companyContext ?? '',
      };
    } catch { /* fall through to text parse */ }
  }

  // Fallback: return stdout as context
  return {
    company,
    role,
    starStories: [],
    likelyQuestions: [],
    proofPoints: [],
    companyContext: stdout.slice(0, 2000),
  };
}
