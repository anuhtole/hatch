/**
 * Pending-action queue — confirmation gate for write tools.
 *
 * Tools that mutate persistent state (save_to_vault, save_memory,
 * add_to_pipeline, update_pipeline_status) call
 * createPendingAction() instead of executing directly. The chat UI shows
 * an inline PendingActionCard with Approve / Discard. Approve hits
 * /api/pending-actions/[id]/approve which calls executePendingAction()
 * here, which performs the actual write.
 *
 * Audit risk #1 from audit-2026-06-04-trustworthiness.md.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { prisma } from '@/lib/prisma';
import { writeNote, readNote } from '@/lib/vault';
import { writeMemoryCategoryKey } from '@/lib/legacy-memory';
import { addToPipeline } from '@/lib/career-ops';
import { sendEmail, type LocalAttachment } from '@/lib/gmail';
import { outDirFor } from '@/lib/resume/out-dir';
import { regenerateMemoryIndex } from '@/lib/memory-index';
import { indexVaultFile } from '@/lib/indexer';

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(os.homedir(), 'vault');
const VAULT_AUDIT_LOG = path.join(VAULT_PATH, 'audit', 'vault-writes.log');

// ── Types ───────────────────────────────────────────────────────────────────

export type PendingActionType =
  | 'vault_write'
  | 'memory_write'
  | 'memory_delete'
  | 'pipeline_add'
  | 'pipeline_update'
  | 'email_send';

export type VaultWritePayload = {
  path: string;
  content: string;
  /** B-13: 'delete' removes the file (content ignored; a .bak copy is kept and
   *  the removal is audit-logged) — used by the gated stale-note audit flow. */
  mode: 'create' | 'overwrite' | 'append' | 'delete';
  title?: string;
};

export type MemoryWritePayload = {
  category: string;
  key: string;
  value: string;
  /** B-12: 'db' targets the prisma Memory table (auto-extraction, modal edits);
   *  'legacy'/absent keeps the original file-store behavior (save_memory tool). */
  store?: 'db' | 'legacy';
  confidence?: number;
  /** db-store only: update this exact row (modal edit) instead of upserting by category/key. */
  id?: string;
  /** db-store only: mark the row user-curated so auto-extraction won't overwrite it. */
  userEdited?: boolean;
};

export type MemoryDeletePayload = {
  id: string;
};

export type PipelineAddPayload = {
  url: string;
  notes?: string;
};

export type PipelineUpdatePayload = {
  cardId?: string;
  url?: string;
  newStatus: string;
  notes?: string;
};

export type EmailSendAttachment = {
  filename: string;
  mimeType: string;
  filePath: string;
  sha256: string; // hash of the exact bytes approved — re-verified before dispatch
};

export type EmailSendPayload = {
  account: string;          // gmail account label (e.g. 'berkeley')
  to: string;
  toName?: string;
  subject: string;
  body: string;
  attachments?: EmailSendAttachment[];
  draftId?: string;         // legacy EmailDraft row to mark sent after dispatch
  lab?: string;             // outreach queue bookkeeping (out/<lab>/outreach/queue.json)
  queueId?: string;
};

export type AnyPayload =
  | VaultWritePayload
  | MemoryWritePayload
  | MemoryDeletePayload
  | PipelineAddPayload
  | PipelineUpdatePayload
  | EmailSendPayload;

/**
 * Explicit per-message user-approval record (B-10 structural send gate).
 * ONLY the approve API route constructs this, after loading a status='pending'
 * row the user approved in the UI. The email_send executor REFUSES to dispatch
 * without it — there is no other way to reach the mail API (enforced by
 * `npm run guard:send-surface`). No batch-approve exists.
 */
export interface SendApproval {
  explicit: true;
  actionId: string;
  approvedAt: string;
  via: 'pending-action-approve';
}

// ── Summary helpers ─────────────────────────────────────────────────────────

export function summarizeAction(type: PendingActionType, payload: AnyPayload): string {
  switch (type) {
    case 'vault_write': {
      const p = payload as VaultWritePayload;
      if (p.mode === 'delete') return `Delete from vault: ${p.path} (backup kept)`;
      const len = p.content?.length ?? 0;
      return `Save to vault: ${p.path} (${p.mode}, ${len} chars)`;
    }
    case 'memory_write': {
      const p = payload as MemoryWritePayload;
      const v = typeof p.value === 'string' ? p.value : JSON.stringify(p.value);
      const short = v.length > 80 ? v.slice(0, 80) + '…' : v;
      return `Remember: ${p.key}: ${short} (${p.category}${p.store === 'db' ? ', memory table' : ''})`;
    }
    case 'memory_delete': {
      const p = payload as MemoryDeletePayload;
      return `Delete memory row ${p.id}`;
    }
    case 'pipeline_add': {
      const p = payload as PipelineAddPayload;
      return `Add to pipeline: ${p.url}${p.notes ? ` — ${p.notes}` : ''}`;
    }
    case 'pipeline_update': {
      const p = payload as PipelineUpdatePayload;
      const target = p.cardId ?? p.url ?? '(unknown)';
      return `Update pipeline: ${target} → ${p.newStatus}`;
    }
    case 'email_send': {
      const p = payload as EmailSendPayload;
      const att = p.attachments?.length ? ` + ${p.attachments.map((a) => a.filename).join(', ')}` : '';
      return `Send email to ${p.toName ? `${p.toName} <${p.to}>` : p.to}: "${p.subject}"${att}`;
    }
  }
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createPendingAction(
  type: PendingActionType,
  payload: AnyPayload,
  conversationId?: string,
): Promise<{ id: string; summary: string }> {
  const summary = summarizeAction(type, payload);
  const row = await prisma.pendingAction.create({
    data: {
      type,
      payload: JSON.stringify(payload),
      summary,
      conversationId: conversationId ?? null,
    },
  });
  return { id: row.id, summary };
}

// ── Execute (approve) ───────────────────────────────────────────────────────

/**
 * Performs the actual write that was queued. Called by the approve API
 * route after the user clicks Approve in the inline card.
 *
 * Returns a short human-readable outcome string suitable for storing on
 * the PendingAction row and showing in the approved-state card.
 */
export async function executePendingAction(
  type: PendingActionType,
  payload: AnyPayload,
  approval?: SendApproval,
): Promise<string> {
  switch (type) {
    case 'vault_write':       return executeVaultWrite(payload as VaultWritePayload);
    case 'memory_write':      return executeMemoryWrite(payload as MemoryWritePayload);
    case 'memory_delete':     return executeMemoryDelete(payload as MemoryDeletePayload);
    case 'pipeline_add':      return executePipelineAdd(payload as PipelineAddPayload);
    case 'pipeline_update':   return executePipelineUpdate(payload as PipelineUpdatePayload);
    case 'email_send':        return executeEmailSend(payload as EmailSendPayload, approval);
  }
}

/**
 * B-12 helper: propose a vault write as a PendingAction. The ONLY way any
 * automated path (memory extraction, refresh, scheduler) may touch ~/vault —
 * nothing lands until the user approves the card.
 */
export async function proposeVaultWrite(
  p: VaultWritePayload,
  conversationId?: string,
): Promise<{ id: string; summary: string }> {
  return createPendingAction('vault_write', p, conversationId);
}

// ── Per-type executors ──────────────────────────────────────────────────────

function appendAuditLog(line: string): void {
  try {
    const dir = path.dirname(VAULT_AUDIT_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(VAULT_AUDIT_LOG, line + '\n', 'utf-8');
  } catch (err) {
    console.error('[pending-actions] audit log append failed:', err);
  }
}

function vaultAbsolutePath(relativePath: string): string {
  return path.resolve(path.join(VAULT_PATH, relativePath));
}

async function executeVaultWrite(p: VaultWritePayload): Promise<string> {
  const abs = vaultAbsolutePath(p.path);
  // Defensive: refuse paths that escape the vault root.
  if (!abs.startsWith(path.resolve(VAULT_PATH))) {
    throw new Error(`Path escapes vault root: ${p.path}`);
  }

  const exists = fs.existsSync(abs);
  let backupPath: string | null = null;

  if ((p.mode === 'overwrite' || p.mode === 'delete') && exists) {
    backupPath = `${abs}.bak.${Date.now()}`;
    fs.copyFileSync(abs, backupPath);
  }

  // B-13: gated deletion — backup taken above, removal audit-logged below.
  if (p.mode === 'delete') {
    if (!exists) throw new Error(`Refusing to delete — file does not exist: ${p.path}`);
    fs.unlinkSync(abs);
    appendAuditLog(`${new Date().toISOString()}\tdelete\t${p.path}\t0b\tbak:${backupPath}`);
    if (p.path.startsWith('memory/')) {
      try { await regenerateMemoryIndex(); } catch (err) {
        console.error('[pending-actions] memory index regeneration failed:', err);
      }
    }
    return `Deleted ${p.path} (backup at ${path.basename(backupPath!)})`;
  }

  let finalContent: string;
  if (p.mode === 'append' && exists) {
    const existing = fs.readFileSync(abs, 'utf-8');
    const sep = existing.endsWith('\n') ? '' : '\n';
    finalContent = existing + sep + p.content;
    writeNote(p.path, finalContent);
  } else if (p.mode === 'create' && exists) {
    // Refuse to clobber on create-mode if file exists.
    throw new Error(`Refusing to create — file already exists: ${p.path} (use overwrite or append)`);
  } else {
    finalContent = p.content;
    writeNote(p.path, finalContent);
  }

  const hash = crypto.createHash('sha256').update(finalContent).digest('hex').slice(0, 12);
  const ts = new Date().toISOString();
  appendAuditLog(
    `${ts}\t${p.mode}\t${p.path}\t${finalContent.length}b\tsha256:${hash}${backupPath ? `\tbak:${backupPath}` : ''}`,
  );

  // B-12: approved writes under memory/ regenerate the derived index + bust the
  // prompt-side cache (this executor is the only writer, so it owns the hook).
  if (p.path.startsWith('memory/')) {
    try { await regenerateMemoryIndex(); } catch (err) {
      console.error('[pending-actions] memory index regeneration failed:', err);
    }
  } else {
    // B-41: index the just-written note into the knowledge store so the chat agent's
    // ambient context (the RAG / keyword layer over KnowledgeItem) surfaces it on the
    // NEXT turn instead of lagging a turn behind. Strictly ADDITIVE and NON-BLOCKING:
    // the write has ALREADY committed above; indexing runs after, and ANY throw is
    // caught, logged, and SWALLOWED. An index failure leaves a stale index
    // (degraded-safe) — it must NEVER fail, block, or roll back the approved write.
    // (memory/ paths regenerate their own derived index above; deletes return earlier
    // and are out of scope — no vault-delete is reachable from the chat tools.)
    try { await indexVaultFile(abs); } catch (err) {
      console.error('[pending-actions] index-on-write failed (write already committed; index left stale):', err);
    }
  }

  const sizeNote = `${finalContent.length} chars`;
  const bakNote = backupPath ? `, backup at ${path.basename(backupPath)}` : '';
  return `Wrote ${sizeNote} to ${p.path} (${p.mode}${bakNote})`;
}

async function executeMemoryWrite(p: MemoryWritePayload): Promise<string> {
  if (p.store === 'db') {
    // B-12: prisma Memory-table writes live ONLY here. Modal edits target an
    // exact row id; extraction upserts by category/key, and a user-curated row
    // (userEdited) is never overwritten by an extraction proposal — only its
    // lastSeenAt refreshes.
    if (p.id) {
      await prisma.memory.update({
        where: { id: p.id },
        data: { value: p.value, ...(p.userEdited ? { userEdited: true } : {}), updatedAt: new Date() },
      });
      return `Memory row updated: ${p.category}["${p.key}"]`;
    }
    const existing = await prisma.memory.findUnique({
      where: { category_key: { category: p.category, key: p.key } },
      select: { id: true, userEdited: true },
    });
    if (existing?.userEdited) {
      await prisma.memory.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
      return `Memory row is user-curated — only lastSeenAt refreshed: ${p.category}["${p.key}"]`;
    }
    await prisma.memory.upsert({
      where: { category_key: { category: p.category, key: p.key } },
      create: { category: p.category, key: p.key, value: p.value, confidence: p.confidence ?? 1.0 },
      update: { value: p.value, confidence: Math.max(p.confidence ?? 1.0, 0.5), lastSeenAt: new Date() },
    });
    return `Memory saved (table): ${p.category}["${p.key}"]`;
  }
  writeMemoryCategoryKey(p.category, p.key, p.value);
  return `Memory saved: ${p.category}["${p.key}"]`;
}

async function executeMemoryDelete(p: MemoryDeletePayload): Promise<string> {
  await prisma.memory.delete({ where: { id: p.id } });
  return `Memory row deleted: ${p.id}`;
}

async function executePipelineAdd(p: PipelineAddPayload): Promise<string> {
  await addToPipeline(p.url, p.notes ?? '');
  return `Added to pipeline: ${p.url}`;
}

async function executePipelineUpdate(p: PipelineUpdatePayload): Promise<string> {
  let card = null;
  if (p.cardId) {
    card = await prisma.pipelineCard.findUnique({ where: { id: p.cardId } });
  } else if (p.url) {
    card = await prisma.pipelineCard.findFirst({ where: { url: p.url } });
  }
  if (!card) {
    throw new Error(`Pipeline card not found (cardId=${p.cardId ?? 'n/a'}, url=${p.url ?? 'n/a'})`);
  }
  const prevStatus = card.status;
  await prisma.pipelineCard.update({
    where: { id: card.id },
    data: {
      status: p.newStatus,
      ...(p.newStatus === 'applied'      ? { appliedAt:    new Date() } : {}),
      ...(p.newStatus === 'interviewing' ? { interviewAt:  new Date() } : {}),
      ...(p.newStatus === 'offer'        ? { offerAt:      new Date() } : {}),
      ...(p.newStatus === 'closed'       ? { closedAt:     new Date() } : {}),
    },
  });
  await prisma.pipelineEvent.create({
    data: {
      cardId: card.id,
      type: 'status_change',
      fromStatus: prevStatus,
      toStatus: p.newStatus,
      notes: p.notes ?? `Status updated via chat (user-approved).`,
    },
  });
  return `Pipeline updated: ${card.org} — ${card.role} (${prevStatus} → ${p.newStatus})`;
}

// ── email_send executor (B-10: the ONLY code path that can dispatch mail) ───

/** Minimal outreach-queue bookkeeping (kept local: pending-actions must not
 *  import the heavy resume drafting modules). */
function updateOutreachQueue(lab: string, queueId: string, patch: Record<string, unknown>): void {
  try {
    const p = path.join(outDirFor(lab), 'outreach', 'queue.json');
    if (!fs.existsSync(p)) return;
    const q = JSON.parse(fs.readFileSync(p, 'utf-8')) as Array<{ id: string }>;
    const i = q.findIndex((e) => e.id === queueId);
    if (i === -1) return;
    q[i] = { ...q[i], ...patch };
    fs.writeFileSync(p, JSON.stringify(q, null, 2));
  } catch (err) {
    console.error('[pending-actions] outreach queue update failed:', err);
  }
}

function sha256OfFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * HATCH NEVER SENDS AUTONOMOUSLY (lesson of the autonomous-send incident —
 * structural, permanent). This function is the sole caller of the Gmail send
 * API in the entire codebase (`npm run guard:send-surface` asserts it). It
 * REFUSES to dispatch unless handed an explicit per-message SendApproval,
 * which only the single-id approve route constructs. Exported so the e2e
 * fixture can prove the refusal behavior with `sendFn` mocked.
 */
export async function executeEmailSend(
  p: EmailSendPayload,
  approval?: SendApproval,
  sendFn: typeof sendEmail = sendEmail,
): Promise<string> {
  if (!approval || approval.explicit !== true || !approval.actionId || approval.via !== 'pending-action-approve') {
    throw new Error(
      'email_send REFUSED: no explicit user-approval record. Outgoing email exists only as a ' +
      'PendingAction and is dispatched solely on per-message user approval.',
    );
  }

  // Re-verify the approved bytes: every attachment must still hash to what the
  // user saw on the card. Any drift since approval aborts the send.
  const attachments: LocalAttachment[] = [];
  for (const a of p.attachments ?? []) {
    if (!fs.existsSync(a.filePath)) throw new Error(`email_send aborted: attachment missing on disk: ${a.filePath}`);
    const actual = sha256OfFile(a.filePath);
    if (actual !== a.sha256) {
      throw new Error(`email_send aborted: attachment "${a.filename}" changed since approval (sha ${actual.slice(0, 12)}… ≠ approved ${a.sha256.slice(0, 12)}…)`);
    }
    attachments.push({ filename: a.filename, mimeType: a.mimeType, filePath: a.filePath });
  }

  await sendFn(p.account, p.to, p.subject, p.body, attachments.length ? attachments : undefined);

  const ts = new Date().toISOString();
  appendAuditLog(
    `${ts}\tEMAIL_SEND\tto:${p.to}\tsubject:${JSON.stringify(p.subject)}\t` +
    `attachments:${(p.attachments ?? []).map((a) => `${a.filename}@${a.sha256.slice(0, 12)}`).join(',') || 'none'}\t` +
    `approval:${approval.actionId}@${approval.approvedAt}`,
  );

  if (p.draftId) {
    try {
      await prisma.emailDraft.update({ where: { id: p.draftId }, data: { status: 'sent', sentAt: new Date() } });
    } catch (err) {
      console.error('[pending-actions] draft status update failed (email DID send):', err);
    }
  }
  if (p.lab && p.queueId) updateOutreachQueue(p.lab, p.queueId, { status: 'sent', sentAt: ts });

  const attNote = attachments.length ? ` with ${attachments.map((a) => a.filename).join(', ')}` : '';
  return `Sent to ${p.to}${attNote} (approval ${approval.actionId})`;
}

/**
 * Deny bookkeeping for an email_send action: archives the queue entry with the
 * user's reason (stored as suppression context only — NO auto-learning).
 * Called by the discard route; never sends anything.
 */
export function archiveDeniedEmailSend(p: EmailSendPayload, reason: string): void {
  if (p.lab && p.queueId) {
    updateOutreachQueue(p.lab, p.queueId, { status: 'denied', reason, deniedAt: new Date().toISOString() });
  }
}

// ── Suggested vault path helper (for save_to_vault summary) ─────────────────

/**
 * Picks a reasonable default vault path for an arbitrary note when the
 * model didn't supply one. Used only as a fallback so save_to_vault always
 * has *some* concrete path in the summary string. The model SHOULD pass
 * an explicit `path` — but if it omits it, we pick today's inbox file.
 */
export function defaultVaultPath(title?: string): string {
  const slug = (title ?? 'note')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'note';
  const today = new Date().toISOString().slice(0, 10);
  return `00-inbox/${today}-${slug}.md`;
}

/**
 * Decide whether a target path will be a new file, overwrite, or append.
 * Used by save_to_vault when the caller didn't specify a mode.
 */
export function decideVaultMode(relativePath: string, requestedMode?: string): 'create' | 'overwrite' | 'append' {
  if (requestedMode === 'create' || requestedMode === 'overwrite' || requestedMode === 'append') {
    return requestedMode;
  }
  const exists = readNote(relativePath) !== null;
  return exists ? 'append' : 'create';
}
