/**
 * lib/resume/outreach.ts — grounded outreach drafting (B-10 Phase 2).
 *
 * TWO-REGIME GROUNDING (trust rule, structural):
 *   - RECIPIENT-facts (their papers, lab, topics) trace to FETCHED sources;
 *     each recipient-fact sentence carries a sourceUrl citation.
 *   - ANATOLE-facts are vault claims only; each carries claimIds.
 *   - ENGAGEMENT claims ("I read your paper…") are Anatole-facts: allowed ONLY
 *     when backed by a user-stated vault claim (sourcePath user-stated.md).
 *     Hatch may accurately describe a recipient's work; it may never assert
 *     Anatole's familiarity with it.
 *
 * HATCH NEVER SENDS: drafting here produces an artifact + an email_send
 * PendingAction. Dispatch lives EXCLUSIVELY in the pending-action executor and
 * runs only on explicit per-message user approval (see lib/pending-actions.ts
 * + scripts/check-send-surface.ts grep-asserts).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { structuredCreate } from '@/lib/resume/structured';
import { ROUTES } from '@/lib/models';
import { type CandidatePool, type Claim } from '@/lib/resume/candidate-pool';
import { isSelectableClaim } from '@/lib/resume/bullet-hygiene';
import { fetchPage, CRAWL_RATE_LIMIT_MS } from '@/lib/resume/discover';
import { outDirFor } from '@/lib/resume/out-dir';

// ── Pacing constants live in outreach-constants.ts (// EDIT TO RETAILOR there;
// kept client-safe so the UI can show the limits). Re-exported for servers/CLI.
import {
  MAX_DRAFTS_PER_DAY,
  MIN_HOURS_BETWEEN_SENDS_SAME_LAB,
  OUTREACH_WORDS_MIN,
  OUTREACH_WORDS_MAX,
  OUTREACH_ATTACHMENT_FORMAT,
} from '@/lib/resume/outreach-constants';
export { MAX_DRAFTS_PER_DAY, MIN_HOURS_BETWEEN_SENDS_SAME_LAB, OUTREACH_WORDS_MIN, OUTREACH_WORDS_MAX, OUTREACH_ATTACHMENT_FORMAT };

// ── Types ───────────────────────────────────────────────────────────────────────

export interface OutreachRecipient {
  name: string;            // person or group as published
  group: string;
  email: string;           // published address ONLY (validated by discovery/guard)
  emailSourceUrl: string;  // page the address was published on
  sourceUrls: string[];    // published pages describing their work
}

export type SentenceKind = 'recipient-fact' | 'anatole-fact' | 'connective' | 'ask';

export interface DraftSentence {
  text: string;
  kind: SentenceKind;
  sourceUrl?: string;   // required for recipient-fact
  claimIds?: string[];  // required for anatole-fact (and engagement claims)
}

export interface RecipientSource { url: string; text: string }

export interface OutreachDraft {
  id: string;            // slug used for artifact filenames
  lab: string;
  recipient: OutreachRecipient;
  subject: string;
  sentences: DraftSentence[];
  body: string;
  attachmentPath: string;
  attachmentSha256: string;
  sources: RecipientSource[]; // fetched recipient-source texts the guard verifies against
  targetProfileText: string;  // the lab target profile (named-specifics union member)
  createdAt: string;
}

// ── Last green run (attachment gate) — shared module since B-11 ─────────────────

import { loadLastGreen, sha256File, type LastGreen } from '@/lib/resume/last-green';
export { loadLastGreen, sha256File };
export type { LastGreen };

// ── Recipient sources (research-layer style fetch, rate-limited) ────────────────

const SOURCE_EXCERPT_CHARS = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripForSource(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchRecipientSources(recipient: OutreachRecipient): Promise<RecipientSource[]> {
  const out: RecipientSource[] = [];
  for (const url of recipient.sourceUrls.slice(0, 6)) {
    const res = await fetchPage(url);
    await sleep(CRAWL_RATE_LIMIT_MS);
    if (res) out.push({ url, text: stripForSource(res.html).slice(0, SOURCE_EXCERPT_CHARS) });
  }
  if (!out.length) throw new Error(`no recipient sources fetched for ${recipient.name} — cannot ground recipient-facts`);
  return out;
}

// ── Attachment selection (format constant; bytes always last-green-verified) ────

export interface PickedAttachment { path: string; sha256: string; filename: string; mimeType: string }

export function pickAttachment(lg: LastGreen, format = OUTREACH_ATTACHMENT_FORMAT): PickedAttachment {
  if (format === 'pdf') {
    if (!lg.pdfPath || !lg.pdfSha256) {
      throw new Error('last green run has no PDF export — re-run the pipeline (B-11 adds resume.pdf to green runs)');
    }
    return {
      path: lg.pdfPath, sha256: lg.pdfSha256,
      filename: 'Anatole-Seychal-Resume.pdf', mimeType: 'application/pdf',
    };
  }
  return {
    path: lg.docxPath, sha256: lg.sha256,
    filename: 'Anatole-Seychal-Resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

// ── User-stated claims (the ONLY backing for engagement claims) ─────────────────

export function userStatedClaims(pool: CandidatePool): Claim[] {
  return pool.claims.filter((c) => /user-stated\.md$/.test(c.sourcePath));
}

// ── Drafting ────────────────────────────────────────────────────────────────────

interface DraftOutput { subject: string; sentences: DraftSentence[] }

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['recipient-fact', 'anatole-fact', 'connective', 'ask'] },
          sourceUrl: { type: 'string' },
          claimIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'kind'],
      },
    },
  },
  required: ['subject', 'sentences'],
};

export function buildBody(sentences: DraftSentence[]): string {
  // Sentences join into short paragraphs: ask gets its own paragraph.
  const paras: string[][] = [[]];
  for (const s of sentences) {
    if (s.kind === 'ask' && paras[paras.length - 1].length) paras.push([]);
    paras[paras.length - 1].push(s.text.trim());
  }
  return paras.map((p) => p.join(' ')).join('\n\n').trim();
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export interface DraftOpts {
  lab: string;
  recipient: OutreachRecipient;
  pool: CandidatePool;
  sources: RecipientSource[];
  targetProfileText: string; // targets/<lab>.json pastedText + title
  attachment: LastGreen;
  now: string;
}

export async function draftOutreach(opts: DraftOpts): Promise<OutreachDraft> {
  const { lab, recipient, pool, sources, attachment } = opts;

  const catalog = pool.claims
    .filter((c) => (c.kind === 'experience' || c.kind === 'project' || c.kind === 'additional') && isSelectableClaim(c))
    .map((c) => `${c.id} :: [${c.entity}] ${c.text}`);
  const stated = userStatedClaims(pool);

  const sourceBlock = sources
    .map((s) => `=== SOURCE ${s.url}\n${s.text}`)
    .join('\n\n');

  const out = await structuredCreate<DraftOutput>({
    stage: 'outreach-draft',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 4000,
    schema: DRAFT_SCHEMA,
    prompt:
      `Draft ONE short cold-outreach email (${OUTREACH_WORDS_MIN}–${OUTREACH_WORDS_MAX} words) from a UC Berkeley ` +
      `undergraduate to ${recipient.name} (${recipient.group}). Include a subject line.\n\n` +
      `Structure: why-them (their published work), why-me (the candidate's real experience, ` +
      `selected for fit to THEIR topics), then ask = ONE specific small next step (e.g. a brief ` +
      `chat, pointing to their stated process, or considering the attached résumé for their ` +
      `undergrad pipeline). Tone: specific, plain, no flattery inflation. A tailored résumé is ` +
      `attached — you may mention it in one short clause.\n\n` +
      `Return the email as a SENTENCE LIST. Every sentence is tagged:\n` +
      `- kind="recipient-fact": a fact about the recipient/lab. MUST carry sourceUrl = the ` +
      `SOURCE url below that states it. Describe their work accurately in third person.\n` +
      `- kind="anatole-fact": a fact about the candidate. MUST carry claimIds from the catalog. ` +
      `NEVER invent a metric, tool, course, or accomplishment not in a cited claim.\n` +
      `- kind="connective" / kind="ask": glue and the closing ask — no factual specifics beyond ` +
      `names already cited in adjacent sentences.\n` +
      `- NEVER write a digit unless it is copied from a cited claim or source. Spell small ` +
      `counts out in words ("fifteen minutes", "two projects") — any untraceable digit fails ` +
      `the guard.\n\n` +
      `ABSOLUTE RULE — engagement claims: NEVER write that the candidate read / saw / followed / ` +
      `admired the recipient's paper, talk, or work` +
      (stated.length
        ? ` UNLESS it restates one of these user-stated claims (then tag it anatole-fact citing that claim id):\n` +
          stated.map((c) => `${c.id} :: ${c.text}`).join('\n')
        : ` — the candidate has stated no such engagement, so zero engagement claims.`) +
      `\nDescribing their work neutrally ("Your group's page describes work on X") is fine as a ` +
      `recipient-fact; asserting the candidate's familiarity with it is not.\n\n` +
      `THE ONLY CANDIDATE FACTS (catalog — id :: [entity] text):\n${catalog.join('\n')}\n\n` +
      `THE ONLY RECIPIENT FACTS (fetched published sources):\n${sourceBlock}`,
  });
  if (!out) throw new Error('[outreach-draft] structured draft returned null — STOP');

  const body = buildBody(out.sentences);
  const wc = wordCount(body);
  if (wc < OUTREACH_WORDS_MIN * 0.6 || wc > OUTREACH_WORDS_MAX * 1.5) {
    throw new Error(`[outreach-draft] body word count ${wc} far outside ${OUTREACH_WORDS_MIN}–${OUTREACH_WORDS_MAX} — STOP`);
  }

  // Attachment = the configured format from the last GREEN run (B-11: default
  // pdf). Loud-fail when the green run predates the pdf export.
  const att = pickAttachment(attachment);

  const id = `${recipient.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)}`;
  return {
    id,
    lab,
    recipient,
    subject: out.subject.trim(),
    sentences: out.sentences,
    body,
    attachmentPath: att.path,
    attachmentSha256: att.sha256,
    sources,
    targetProfileText: opts.targetProfileText,
    createdAt: opts.now,
  };
}

// ── Per-lab outreach queue (file-based, lives in gitignored out/<lab>/) ─────────

export type QueueStatus = 'queued' | 'drafted' | 'pending_send' | 'sent' | 'denied';

export interface QueueEntry {
  id: string;
  recipient: OutreachRecipient;
  status: QueueStatus;
  reason?: string;          // deny reason — stored as suppression context, NO auto-learning
  draftPath?: string;
  pendingActionId?: string;
  createdAt: string;
  draftedAt?: string;
  sentAt?: string;
}

function queuePath(lab: string): string {
  return join(outDirFor(lab), 'outreach', 'queue.json');
}

export function loadQueue(lab: string): QueueEntry[] {
  const p = queuePath(lab);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf-8')) as QueueEntry[];
}

export function saveQueue(lab: string, entries: QueueEntry[]): void {
  const p = queuePath(lab);
  mkdirSync(join(outDirFor(lab), 'outreach'), { recursive: true });
  writeFileSync(p, JSON.stringify(entries, null, 2));
}

export function updateQueueEntry(lab: string, id: string, patch: Partial<QueueEntry>): QueueEntry | null {
  const q = loadQueue(lab);
  const i = q.findIndex((e) => e.id === id);
  if (i === -1) return null;
  q[i] = { ...q[i], ...patch };
  saveQueue(lab, q);
  return q[i];
}

/** Drafting pacing gate. Throws with a human-readable refusal when over budget. */
export function assertPacing(lab: string, allLabs: string[], now: Date): void {
  const today = now.toISOString().slice(0, 10);
  let draftsToday = 0;
  for (const l of allLabs) {
    for (const e of loadQueue(l)) {
      if (e.draftedAt && e.draftedAt.slice(0, 10) === today) draftsToday++;
    }
  }
  if (draftsToday >= MAX_DRAFTS_PER_DAY) {
    throw new Error(`pacing: ${draftsToday} draft(s) already created today (MAX_DRAFTS_PER_DAY=${MAX_DRAFTS_PER_DAY})`);
  }
  const lastSent = loadQueue(lab)
    .filter((e) => e.sentAt)
    .map((e) => new Date(e.sentAt!).getTime())
    .sort((a, b) => b - a)[0];
  if (lastSent !== undefined) {
    const hours = (now.getTime() - lastSent) / 3_600_000;
    if (hours < MIN_HOURS_BETWEEN_SENDS_SAME_LAB) {
      throw new Error(
        `pacing: last send to "${lab}" was ${hours.toFixed(1)}h ago (MIN_HOURS_BETWEEN_SENDS_SAME_LAB=${MIN_HOURS_BETWEEN_SENDS_SAME_LAB})`,
      );
    }
  }
}

// ── Draft artifact ──────────────────────────────────────────────────────────────

export function writeDraftArtifact(draft: OutreachDraft): string {
  const dir = join(outDirFor(draft.lab), 'outreach');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${draft.id}.json`);
  writeFileSync(p, JSON.stringify(draft, null, 2));
  return p;
}

export function loadDraftArtifact(lab: string, id: string): OutreachDraft {
  return JSON.parse(readFileSync(join(outDirFor(lab), 'outreach', `${id}.json`), 'utf-8')) as OutreachDraft;
}
