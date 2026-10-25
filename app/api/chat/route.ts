import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { anthropic, SYSTEM_PROMPT, TOOLS } from '@/lib/claude';
import { getRelevantContext } from '@/lib/knowledge';
import { isRestrictedFile } from '@/lib/sync-config';
import { searchDriveFiles, getDriveFileContent, downloadDriveFileToTemp } from '@/lib/google-drive';
import {
  listEmails, getEmail,
  getAttachments, downloadAttachment, buildForwardPayload,
  type LocalAttachment,
} from '@/lib/gmail';
import { searchVault } from '@/lib/vault';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { checkTracker, listTrackers } from '@/lib/tracker';
import { getUpcomingAssignments } from '@/lib/canvas';
import { getOrGenerateBriefing, generateBriefing, todayDate } from '@/lib/daily-briefing';
import { getApplicationsPipeline, getFollowupsDue, scanPortals, getInterviewPrep } from '@/lib/career-ops';
// B-11 containment: the chat surface may import ONLY pipeline orchestration /
// verified-artifact readers from lib/resume — never content producers
// (tailor/render/cover-letter/outreach). Enforced by guard:send-surface assert E.
import { runTarget, resolveTargetCtx, StageError } from '@/lib/resume/run-pipeline';
import { loadTargetDef, saveTargetDef } from '@/lib/resume/fetch-target';
import { loadLastGreen, buildArtifactPayload, type ArtifactPayload } from '@/lib/resume/last-green';
// B-13: discovery is a published-pages crawler/ranker (shortlists for approval,
// never an outreach draft) — allowlisted in containment assert E2 alongside the
// other orchestration/reader modules.
import { discoverLab, writeDiscovery, type LabDiscovery, type RankedGroup } from '@/lib/resume/discover';
import { outDirFor } from '@/lib/resume/out-dir';
import { verifyPerson } from '@/lib/verify-person';
import { semanticSearch } from '@/lib/indexer';
import { getAllMemories, formatMemoriesForPrompt, extractMemoriesFromConversation } from '@/lib/memory';
import { getMemoryBlock } from '@/lib/vault-memory';
import { extractAndWriteMemory } from '@/lib/vault-writer';
import { readMemory } from '@/lib/legacy-memory';
import { buildProjectContextSummary } from '@/lib/projects';
import { ROUTES } from '@/lib/models';
import {
  createPendingAction,
  defaultVaultPath,
  decideVaultMode,
  type PendingActionType,
} from '@/lib/pending-actions';

// ── Memory helpers ────────────────────────────────────────────────────────────
// Inlined readMemory/writeMemory moved to lib/legacy-memory.ts so the
// Memory modal's manual add/edit/delete endpoints can dual-write into
// the same memory.json without duplicating the file I/O code. Layer 2
// retrieval below still uses readMemory() — same behavior, same file.

// ── Types ────────────────────────────────────────────────────────────────────

type Emitter = (event: NdjsonEvent) => void;

export type AttachmentDetail = {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  pdfPageCount?: number;
  pdfTitle?: string;
  pdfAuthor?: string;
};

export type ContextLayerName =
  | 'vault'
  | 'memory'
  | 'legacy_memory'
  | 'project'
  | 'knowledge'
  | 'canvas_gmail';

export type ContextLayerStatus = 'fetched' | 'empty' | 'error' | 'skipped';

export type ContextLayerReport = {
  name: ContextLayerName;
  status: ContextLayerStatus;
  itemCount?: number;
  durationMs: number;
  error?: string;
};

type NdjsonEvent =
  | { t: 'text'; v: string }
  | { t: 'tool_call'; id: string; name: string; label: string; status: 'starting' | 'ready' }
  | { t: 'draft'; id: string; to: string; subject: string; body: string; attachments: string[]; attachmentDetails: AttachmentDetail[] }
  | { t: 'pending_action'; id: string; actionType: PendingActionType; summary: string }
  // B-13: verified-artifact card (display-only; payload built from re-verified last-green)
  | { t: 'artifact'; payload: ArtifactPayload }
  // B-13: discovery shortlist card (ranked groups w/ cited rationales + verbatim published contacts)
  | { t: 'discovery'; lab: string; generatedAt: string; shortlist: RankedGroup[] }
  | { t: 'context_status'; layers: ContextLayerReport[] }
  | { t: 'conv'; id: string; title: string };

// ── PDF metadata extractor (no external deps) ─────────────────────────────────
// Scans the raw PDF bytes for /Count (page tree), /Title, and /Author entries.
// Heuristic — works for standard PDFs with an Info dictionary.

function extractPdfMeta(buffer: Buffer): { pages?: number; title?: string; author?: string } {
  const text = buffer.toString('latin1'); // latin1 preserves raw byte values

  // Page count: /Count N appears in the Pages object
  const countMatch = text.match(/\/Count\s+(\d+)/);
  const pages = countMatch ? parseInt(countMatch[1], 10) : undefined;

  // Title / Author from the Info dict (plain string form: /Title (foo))
  const titleMatch = text.match(/\/Title\s*\(([^)]*)\)/);
  const authorMatch = text.match(/\/Author\s*\(([^)]*)\)/);

  return {
    pages,
    title: titleMatch?.[1]?.trim() || undefined,
    author: authorMatch?.[1]?.trim() || undefined,
  };
}

function buildAttachmentDetails(attachments: LocalAttachment[]): AttachmentDetail[] {
  return attachments.map((att) => {
    let sizeBytes = 0;
    let pdfPageCount: number | undefined;
    let pdfTitle: string | undefined;
    let pdfAuthor: string | undefined;

    try {
      const stat = require('fs').statSync(att.filePath);
      sizeBytes = stat.size;

      if (att.mimeType === 'application/pdf') {
        const buf: Buffer = require('fs').readFileSync(att.filePath);
        const meta = extractPdfMeta(buf);
        pdfPageCount = meta.pages;
        pdfTitle = meta.title;
        pdfAuthor = meta.author;
      }
    } catch { /* best-effort */ }

    return { filename: att.filename, sizeBytes, mimeType: att.mimeType, pdfPageCount, pdfTitle, pdfAuthor };
  });
}

// ── Tool label helpers ────────────────────────────────────────────────────────

function toolLabel(name: string, input: Record<string, string>): string {
  switch (name) {
    case 'web_search':            return `Searching the web for "${input.query ?? '...'}"`;
    case 'search_drive':          return `Searching Drive for "${input.query ?? '...'}"`;
    case 'read_drive_file':       return `Reading "${input.file_name ?? 'file'}"`;
    case 'attach_drive_file':     return `Downloading "${input.file_name ?? 'file'}" from Drive`;
    case 'search_emails':         return `Searching Gmail for "${input.query ?? '...'}"`;
    case 'read_email':            return 'Reading email';
    case 'get_email_attachments': return 'Fetching email attachments';
    case 'draft_email':           return `Drafting email to ${input.to ?? '...'}`;
    case 'send_email':            return `Sending email to ${input.to ?? '...'}`;
    case 'forward_email':         return `Forwarding email to ${input.to ?? '...'}`;
    case 'add_todo':              return `Adding task: "${input.text ?? '...'}"`;
    case 'save_memory':           return `Saving to memory: ${input.key ?? '...'}`;
    case 'search_vault':          return `Searching vault for "${input.query ?? '...'}"`;
    case 'save_to_vault':         return `Saving to vault: ${input.title ?? input.path ?? '...'}`;
    case 'create_tracker':        return `Creating tracker: "${input.title ?? '...'}"`;
    case 'list_trackers':         return 'Listing trackers';
    case 'check_tracker_now':     return `Checking tracker ${input.tracker_id ?? '...'}`;
    case 'delete_tracker':        return `Deleting tracker: "${input.title ?? '...'}"`;
    case 'complete_assignment':   return `Marking assignment complete: "${input.title ?? '...'}"`;
    case 'get_today_briefing':    return 'Fetching today\'s briefing';
    case 'regenerate_briefing':   return 'Regenerating today\'s briefing';
    case 'get_pipeline':            return 'Fetching job application pipeline';
    case 'get_followups':           return 'Checking overdue follow-ups';
    case 'add_to_pipeline':         return `Adding job to pipeline: ${input.url ?? '...'}`;
    case 'scan_for_new_jobs':       return 'Scanning 70+ companies for new job postings…';
    case 'resume_tailor':           return `Running the guarded resume pipeline${input.target ? ` for "${input.target}"` : ''}…`;
    case 'resume_artifact':         return `Fetching verified resume artifacts for "${input.target ?? '...'}"`;
    case 'discover_targets':        return `Consulting lab discovery for "${input.lab ?? input.rootUrl ?? '...'}"`;
    case 'verify_person':           return `Live-verifying ${input.name ?? '...'} @ ${input.org ?? '...'}`;
    case 'suggest_interview_prep':  return `Pulling interview prep for ${input.company ?? '...'} — ${input.role ?? '...'}`;
    case 'update_pipeline_status':  return `Updating pipeline status for card ${input.cardId ?? input.url ?? '...'}`;
    default:                        return name;
  }
}

// resume_tailor runs are async (the pipeline outlives the chat watchdog) and
// deduped per target so repeated asks can't stack concurrent runs.
const resumeRunsInFlight = new Set<string>();
// B-13: discovery crawls are async + deduped per lab for the same reason.
const discoveryRunsInFlight = new Set<string>();

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, any>,
  emit: Emitter,
  conversationId: string | null = null,
): Promise<string> {
  try {
    switch (name) {
      // ── Drive ──────────────────────────────────────────────────────────────
      case 'search_drive': {
        const allFiles = await searchDriveFiles(input.query ?? '');
        const files = allFiles.filter((f) => !isRestrictedFile(f.name));
        if (!files.length) {
          return `No results found for query: "${input.query}". The file does not exist in the user's Google Drive, or may be named differently. Do not guess — tell the user exactly this and suggest alternative search terms.`;
        }
        return JSON.stringify(
          files.map((f) => ({ id: f.id, name: f.name, type: f.mimeType, modified: f.modifiedTime }))
        );
      }

      case 'read_drive_file': {
        return await getDriveFileContent(input.file_id, input.file_name);
      }

      case 'attach_drive_file': {
        const { filePath, filename, mimeType } = await downloadDriveFileToTemp(
          input.file_id,
          input.file_name
        );
        return JSON.stringify({ filePath, filename, mimeType });
      }

      // ── Gmail — reading ────────────────────────────────────────────────────
      case 'search_emails': {
        const emails = await listEmails('berkeley', input.query, 10);
        if (!emails.length) {
          return `No results found for query: "${input.query}". No emails matching this description exist in the user's Gmail. Do not make up email content — tell the user exactly this.`;
        }
        return JSON.stringify(
          emails.map((e) => ({ id: e.id, from: e.from, subject: e.subject, date: e.date, snippet: e.snippet }))
        );
      }

      case 'read_email': {
        const email = await getEmail('berkeley', input.email_id);
        return `From: ${email.from}\nTo: ${email.to}\nDate: ${email.date}\nSubject: ${email.subject}\n\n${email.body}`;
      }

      case 'get_email_attachments': {
        const metas = await getAttachments('berkeley', input.email_id);
        if (!metas.length) return 'This email has no attachments.';

        if (!input.download) {
          return JSON.stringify(
            metas.map((a) => ({
              attachmentId: a.attachmentId,
              name: a.name,
              mimeType: a.mimeType,
              sizeKB: Math.round(a.size / 1024),
            }))
          );
        }

        // Download each attachment and return local paths
        const downloaded: { name: string; mimeType: string; filePath: string }[] = [];
        for (const meta of metas) {
          const filePath = await downloadAttachment('berkeley', input.email_id, meta.attachmentId, meta.name);
          downloaded.push({ name: meta.name, mimeType: meta.mimeType, filePath });
        }
        return JSON.stringify(downloaded);
      }

      // ── Gmail — sending ────────────────────────────────────────────────────
      case 'draft_email': {
        console.log('[draft_email] Tool called with:', JSON.stringify(input));
        const attachmentPaths: string[] = input.attachment_paths ?? [];
        const attachments: LocalAttachment[] = resolveAttachments(attachmentPaths);
        const attachmentDetails = buildAttachmentDetails(attachments);
        console.log('[draft_email] Resolved attachments:', attachments.length, '| Creating DB record...');

        const dbDraft = await prisma.emailDraft.create({
          data: {
            to: JSON.stringify([input.to ?? ''].filter(Boolean)),
            subject: input.subject ?? '',
            body: input.body ?? '',
            attachments: attachmentDetails.length > 0 ? JSON.stringify(
              attachmentDetails.map((a, i) => ({
                source: 'upload',
                sourceId: attachmentPaths[i] ?? '',
                filename: a.filename,
                sizeBytes: a.sizeBytes,
                mimeType: a.mimeType,
              }))
            ) : null,
          },
        });

        const draftEvent = {
          t: 'draft' as const,
          id: dbDraft.id,
          to: input.to ?? '',
          subject: input.subject ?? '',
          body: input.body ?? '',
          attachments: attachmentDetails.map((a) => a.filename),
          attachmentDetails,
        };
        console.log('[draft_email] Emitting draft event:', JSON.stringify(draftEvent));
        emit(draftEvent);

        console.log('[draft_email] Draft event emitted, id:', dbDraft.id);
        return `Draft created (id: ${dbDraft.id}). The editable draft card is now visible in the chat. Awaiting user confirmation before sending.`;
      }

      case 'send_email': {
        // SAFETY: the model has NO send capability. `send_email` was removed
        // from the TOOLS registry (lib/claude.ts), so this case is unreachable
        // in normal operation. It is kept ONLY as a defensive fallback: if a
        // send_email tool_use ever reaches here (stale client, prompt-injection,
        // future regression), it MUST NOT send. Never call sendEmail() here.
        // Email is sent exclusively when the user clicks Send in the draft card
        // (POST /api/email/drafts/[id]/send).
        console.warn('[send_email] BLOCKED — model attempted a direct send; no email was sent.');
        return (
          "I can't send email directly — I can only draft. The draft is ready in " +
          'the card above; click Send in that card to send it yourself.'
        );
      }

      case 'forward_email': {
        const payload = await buildForwardPayload(
          'berkeley',
          input.email_id,
          input.to,
          input.additional_message
        );
        const forwardDetails = buildAttachmentDetails(payload.attachments);

        const fwdDraft = await prisma.emailDraft.create({
          data: {
            to: JSON.stringify([input.to ?? ''].filter(Boolean)),
            subject: payload.subject,
            body: payload.body,
            attachments: forwardDetails.length > 0 ? JSON.stringify(
              payload.attachments.map((a, i) => ({
                source: 'upload',
                sourceId: a.filePath,
                filename: a.filename,
                sizeBytes: forwardDetails[i]?.sizeBytes ?? 0,
                mimeType: a.mimeType,
              }))
            ) : null,
          },
        });

        emit({
          t: 'draft',
          id: fwdDraft.id,
          to: payload.to,
          subject: payload.subject,
          body: payload.body,
          attachments: forwardDetails.map((a) => a.filename),
          attachmentDetails: forwardDetails,
        });

        return `Forward draft created (id: ${fwdDraft.id}). The editable draft card is now visible in the chat. Awaiting user confirmation before sending.`;
      }

      // ── Vault ─────────────────────────────────────────────────────────────
      case 'search_vault': {
        const results = searchVault(input.query as string, input.limit as number | undefined);
        if (results.length === 0) return `No vault notes found for "${input.query}".`;
        return results.map((r) => `**${r.title}** (${r.path})\n${r.excerpt}`).join('\n\n---\n\n');
      }

      case 'save_to_vault': {
        // Confirmation gate (audit risk #1): queue a PendingAction, emit a
        // card event, do NOT write to disk until the user approves.
        const relPath = (input.path as string) || defaultVaultPath(input.title as string | undefined);
        const mode = decideVaultMode(relPath, input.mode as string | undefined);
        const { id, summary } = await createPendingAction(
          'vault_write',
          { path: relPath, content: input.content as string, mode, title: input.title as string | undefined },
          conversationId ?? undefined,
        );
        emit({ t: 'pending_action', id, actionType: 'vault_write', summary });
        return `Vault write QUEUED for user approval (pending action id: ${id}). Nothing has been written yet. The inline approval card is now visible in the chat. Tell the user briefly what you proposed and wait — do not assume the write happened.`;
      }

      case 'read_vault_file': {
        const { readFile } = await import('fs/promises');
        const vaultPath = process.env.VAULT_PATH ?? path.join(require('os').homedir(), 'vault');
        const safePath = path.resolve(path.join(vaultPath, input.path as string));
        if (!safePath.startsWith(path.resolve(vaultPath))) {
          return 'Error: path escapes vault root';
        }
        try {
          const content = await readFile(safePath, 'utf-8');
          return content.slice(0, 50000);
        } catch {
          return `File not found or unreadable: ${input.path}`;
        }
      }

      // ── Trackers ──────────────────────────────────────────────────────────
      case 'create_tracker': {
        // Use smart-create: call the API endpoint which uses Claude to parse description
        const scRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/api/trackers/smart-create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: input.title, description: input.description }),
        });
        if (!scRes.ok) {
          const err = await scRes.text();
          return `Failed to create tracker: ${err}`;
        }
        const tracker = await scRes.json();
        checkTracker(tracker.id).catch(() => {});
        return `Tracker created: "${tracker.title}" (id: ${tracker.id}). Monitoring ${tracker.checkFrequency} via ${tracker.monitorType}.`;
      }

      case 'list_trackers': {
        const all = await listTrackers(input.activeOnly === true);
        if (!all.length) return 'No trackers found.';
        return all.map((t: { title: string; monitorType: string; currentStatus: string | null; lastChecked: Date | null }) =>
          `• ${t.title} [${t.monitorType}] — ${t.currentStatus ?? 'not checked yet'} · last checked: ${t.lastChecked ? new Date(t.lastChecked).toLocaleString() : 'never'}`
        ).join('\n');
      }

      case 'check_tracker_now': {
        const result = await checkTracker(input.tracker_id);
        return `Checked tracker ${input.tracker_id}:\nStatus: ${result.status}\n${result.details ? `Details: ${result.details}` : ''}`;
      }

      case 'delete_tracker': {
        const matches = await prisma.tracker.findMany({
          where: { title: { contains: input.title } },
        });
        if (matches.length === 0) return `No tracker found matching "${input.title}".`;
        if (matches.length > 1) {
          return `Multiple trackers match "${input.title}":\n${matches.map((t: { title: string; id: string }) => `• ${t.title} (id: ${t.id})`).join('\n')}\nPlease be more specific.`;
        }
        const t = matches[0];
        await prisma.tracker.delete({ where: { id: t.id } });
        return `Deleted tracker "${t.title}".`;
      }

      case 'complete_assignment': {
        // Bypass created cutoff so any assignment can be completed via chat
        const allAssignments = await getUpcomingAssignments(180, true);
        const query = String(input.title ?? '').toLowerCase();
        const matched = allAssignments.filter((a) => a.name.toLowerCase().includes(query));
        if (matched.length === 0) return `No assignment found matching "${input.title}".`;
        if (matched.length > 1) {
          return `Multiple assignments match "${input.title}":\n${matched.map((a) => `• ${a.name} (${a.courseName})`).join('\n')}\nPlease be more specific.`;
        }
        const a = matched[0];
        await prisma.assignment.upsert({
          where: { canvasId: String(a.id) },
          update: { userCompleted: true },
          create: {
            canvasId: String(a.id),
            courseId: String(a.course_id),
            courseName: a.courseName,
            title: a.name,
            description: a.description,
            dueAt: a.due_at ? new Date(a.due_at) : null,
            pointsPossible: a.points_possible,
            submissionStatus: a.submission?.workflow_state ?? null,
            userCompleted: true,
          },
        });
        return `Marked "${a.name}" as completed. It will no longer appear in your assignments.`;
      }

      // ── Daily Briefing ────────────────────────────────────────────────────
      case 'get_today_briefing': {
        const content = await getOrGenerateBriefing(todayDate());
        return JSON.stringify(content);
      }

      case 'regenerate_briefing': {
        const content = await generateBriefing(todayDate());
        return JSON.stringify(content);
      }

      // ── Career-ops ────────────────────────────────────────────────────────
      case 'get_pipeline': {
        const pipeline = await getApplicationsPipeline();
        return JSON.stringify(pipeline, null, 2);
      }

      case 'get_followups': {
        const followups = await getFollowupsDue();
        return JSON.stringify(followups, null, 2);
      }

      case 'add_to_pipeline': {
        // Confirmation gate (audit risk #1): queue a PendingAction.
        const { url, notes } = input as { url: string; notes?: string };
        const { id, summary } = await createPendingAction(
          'pipeline_add',
          { url, notes },
          conversationId ?? undefined,
        );
        emit({ t: 'pending_action', id, actionType: 'pipeline_add', summary });
        return `Pipeline add QUEUED for user approval (pending action id: ${id}). Nothing has been added yet. The inline approval card is now visible in the chat. Wait for the user.`;
      }

      case 'scan_for_new_jobs': {
        const result = await scanPortals();
        return JSON.stringify(result, null, 2);
      }

      // evaluate_job_posting RETIRED (B-11) — it freehand-evaluated from
      // career-ops files and persisted reports outside every guard. The guarded
      // pipeline below is the only resume/evaluation producer.

      case 'resume_tailor': {
        const { target, url, pastedText, name, title } = input as {
          target?: string; url?: string; pastedText?: string; name?: string; title?: string;
        };
        // Resolve or create the target def — NO content generation here; the
        // guarded pipeline (run-pipeline.ts, all gates) does all the work.
        let targetName = target?.trim().toLowerCase();
        if (targetName) {
          loadTargetDef(targetName); // throws with a clear error if missing
        } else {
          const urls = url?.trim() ? [url.trim()] : [];
          if (!urls.length && !pastedText?.trim()) {
            return 'Need either an existing target name, or a url/pastedText to create a new target.';
          }
          const slugSource = name?.trim() || title?.trim() || (url ? new URL(url).hostname.replace(/^www\./, '').split('.')[0] : '');
          targetName = slugSource.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
          if (!targetName) return 'Need a short target name (e.g. "deepmind-pm") to create a new target.';
          saveTargetDef({ name: targetName, title: title?.trim() || targetName, urls, pastedText: pastedText?.trim() || undefined });
        }

        // The pipeline takes minutes; the chat stream has a 120s watchdog. So
        // the run is kicked off ASYNCHRONOUSLY (deduped per target) and the
        // user watches live progress in Resume Studio. resume_artifact (or the
        // studio) serves the sha-verified outputs once the run goes green.
        if (resumeRunsInFlight.has(targetName)) {
          return `A pipeline run for "${targetName}" is already in progress — watch it at /resume (target "${targetName}").`;
        }
        resumeRunsInFlight.add(targetName);
        const runConvId = conversationId; // captured for the completion message
        void (async () => {
          try {
            const ctx = await resolveTargetCtx(targetName);
            await runTarget(ctx, {
              log: () => { /* progress is visible in Resume Studio, not the chat */ },
              stage: (n, status, detail) => console.log(`[resume_tailor:${targetName}] ${status} ${n}${detail ? ` — ${detail}` : ''}`),
            }, []);
            console.log(`[resume_tailor:${targetName}] GREEN — last-green updated`);
            // B-13: surface the completion as an inline artifact card. The chat
            // stream is long gone, so persist an assistant message carrying
            // artifactTarget — the messages route rehydrates it into a card
            // (re-verifying hashes) when the conversation renders.
            if (runConvId) {
              const lg = loadLastGreen(targetName);
              await prisma.chatMessage.create({
                data: {
                  role: 'assistant',
                  content: `Pipeline finished GREEN for "${targetName}" (completed ${lg.completedAt}; all gates passed). The verified artifact card is below.`,
                  conversationId: runConvId,
                  artifactTarget: targetName,
                },
              }).catch((e) => console.error(`[resume_tailor:${targetName}] completion message failed:`, e));
            }
          } catch (e) {
            console.error(`[resume_tailor:${targetName}] STOPPED:`, e instanceof StageError ? `[${e.stage}] ${e.detail}` : e);
          } finally {
            resumeRunsInFlight.delete(targetName);
          }
        })();

        let previous = '';
        try {
          const lg = loadLastGreen(targetName);
          previous =
            `\nA PREVIOUS green run exists meanwhile (completed ${lg.completedAt}):\n` +
            `- resume (docx): /api/resume/artifact/${targetName}/tailored-resume.docx\n` +
            (lg.pdfPath ? `- resume (pdf): /api/resume/artifact/${targetName}/resume.pdf\n` : '');
        } catch { /* no prior green run — nothing to offer yet */ }
        return (
          `Guarded pipeline STARTED for target "${targetName}" (vault-grounded; all gates enforced; no content is generated in chat). ` +
          `Live stage progress: open /resume and select "${targetName}". When it finishes green, use resume_artifact ` +
          `(or the studio) for sha-verified outputs; if a gate fails, the run stops and shows the exact gate.` +
          previous
        );
      }

      case 'resume_artifact': {
        const { target } = input as { target: string };
        const t = target.trim().toLowerCase();
        // B-13: typed artifact card. buildArtifactPayload calls loadLastGreen
        // (hash re-verification) and throws loudly on any mismatch.
        const payload = buildArtifactPayload(t);
        emit({ t: 'artifact', payload });
        return (
          `Verified artifact card for "${t}" is now displayed inline in the chat (completed ${payload.completedAt}, ` +
          `docx sha256 ${payload.sha256.slice(0, 12)}…; hashes re-verified just now). The card has the first-page preview, ` +
          `PDF view, and download buttons — do NOT repeat raw /api/resume/artifact links in your reply; refer the user to the card.`
        );
      }

      // ── B-13: targeting intelligence ───────────────────────────────────────
      case 'discover_targets': {
        const { lab, rootUrl } = input as { lab?: string; rootUrl?: string };
        let slug = lab?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') ?? '';
        if (!slug && rootUrl) slug = new URL(rootUrl).hostname.replace(/^www\./, '').split('.')[0];
        if (!slug) return 'Need a lab name (e.g. "chai") or a rootUrl to discover targets.';

        // Resolve the lab root: targets/<slug>.json labRoot → first url → given rootUrl.
        let root = rootUrl?.trim() || '';
        const defPath = path.join(require('os').homedir(), 'hatch', 'targets', `${slug}.json`);
        if (fs.existsSync(defPath)) {
          const def = JSON.parse(fs.readFileSync(defPath, 'utf-8')) as { labRoot?: string; urls?: string[] };
          root = root || def.labRoot || def.urls?.[0] || '';
        }
        if (!root) return `No lab root known for "${slug}" — pass rootUrl (the lab's public site) to run discovery.`;

        // Fresh discovery on disk? Serve it (published-pages shortlist, cited
        // rationales, verbatim contacts). Older than 7 days → re-run.
        const jsonPath = path.join(outDirFor(slug), 'discovery.json');
        const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
        if (fs.existsSync(jsonPath)) {
          const d = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as LabDiscovery;
          const age = Date.now() - new Date(d.generatedAt).getTime();
          if (age < MAX_AGE_MS && d.shortlist.length > 0) {
            emit({ t: 'discovery', lab: slug, generatedAt: d.generatedAt, shortlist: d.shortlist });
            const lines = d.shortlist.map((g, i) => {
              const contact = g.contact
                ? `${g.contact.kind === 'email' ? g.contact.value : `application page: ${g.contact.value}`} (published at ${g.contact.sourceUrl})`
                : 'application page only — no published contact';
              const why = g.rationales.slice(0, 2).map((r) => `${r.text} [${r.sourceUrl}]`).join(' · ');
              return `${i + 1}. ${g.name}${g.pi ? ` (PI: ${g.pi})` : ''} — fit ${g.fitScore}/100 — contact: ${contact}${why ? `\n   why: ${why}` : ''}`;
            });
            return (
              `Discovery shortlist for "${slug}" (generated ${d.generatedAt}, from published pages only) is now displayed ` +
              `as a card in the chat. Use ONLY these published contact routes — never guess an email address. Summary:\n` +
              lines.join('\n')
            );
          }
        }

        // No fresh discovery — run it asynchronously (crawl + rank outlives the
        // chat watchdog), deduped per lab like resume_tailor.
        if (discoveryRunsInFlight.has(slug)) {
          return `Discovery for "${slug}" is already running — ask again in a couple of minutes.`;
        }
        discoveryRunsInFlight.add(slug);
        void (async () => {
          try {
            const d = await discoverLab(slug, root, (s) => console.log(`[discover:${slug}] ${s}`));
            writeDiscovery(d);
            console.log(`[discover:${slug}] DONE — ${d.shortlist.length} groups shortlisted`);
          } catch (e) {
            console.error(`[discover:${slug}] FAILED:`, e);
          } finally {
            discoveryRunsInFlight.delete(slug);
          }
        })();
        return (
          `No fresh discovery on disk for "${slug}" — a published-pages discovery crawl just started (takes a few minutes). ` +
          `Tell the user it's running and to ask again shortly; do NOT recommend contacts from memory in the meantime.`
        );
      }

      case 'verify_person': {
        const { name: personName, org } = input as { name: string; org: string };
        if (!personName?.trim()) return 'Need the person\'s name to verify.';
        const v = await verifyPerson(personName.trim(), (org ?? '').trim() || 'unknown org');
        return JSON.stringify(v, null, 2);
      }

      case 'suggest_interview_prep': {
        const { company, role } = input as { company: string; role: string };
        const result = await getInterviewPrep(company, role);
        return JSON.stringify(result, null, 2);
      }

      case 'update_pipeline_status': {
        // Confirmation gate (audit risk #1): queue a PendingAction. We
        // still pre-validate that the card exists so the model gets a
        // useful error message instead of queueing a write that will
        // definitely fail at approve time.
        const { cardId, url, newStatus, notes: statusNotes } = input as {
          cardId?: string;
          url?: string;
          newStatus: string;
          notes?: string;
        };

        let card = null;
        if (cardId) {
          card = await prisma.pipelineCard.findUnique({ where: { id: cardId } });
        } else if (url) {
          card = await prisma.pipelineCard.findFirst({ where: { url } });
        }
        if (!card) {
          throw new Error(`Pipeline card not found (cardId=${cardId ?? 'n/a'}, url=${url ?? 'n/a'})`);
        }

        const { id, summary } = await createPendingAction(
          'pipeline_update',
          { cardId: card.id, url: card.url ?? undefined, newStatus, notes: statusNotes },
          conversationId ?? undefined,
        );
        emit({ t: 'pending_action', id, actionType: 'pipeline_update', summary });
        return `Pipeline status update QUEUED for user approval (pending action id: ${id}). Card located: ${card.org} — ${card.role} (current status: ${card.status}). Nothing has been changed yet. Wait for the user.`;
      }

      // ── Todos ─────────────────────────────────────────────────────────────
      case 'add_todo': {
        const last = await prisma.todo.findFirst({ orderBy: { order: 'desc' } });
        const order = (last?.order ?? -1) + 1;
        const todo = await prisma.todo.create({
          data: {
            text: String(input.text).trim(),
            priority: input.priority ?? null,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            order,
          },
        });
        return `Todo added: "${todo.text}" (id: ${todo.id})${todo.priority ? `, priority: ${todo.priority}` : ''}${todo.dueDate ? `, due: ${todo.dueDate.toDateString()}` : ''}.`;
      }

      // ── Memory ────────────────────────────────────────────────────────────
      case 'save_memory': {
        // Confirmation gate (audit risk #1): queue a PendingAction.
        const { id, summary } = await createPendingAction(
          'memory_write',
          {
            category: String(input.category ?? 'fact'),
            key:      String(input.key ?? ''),
            value:    typeof input.value === 'string' ? input.value : JSON.stringify(input.value),
          },
          conversationId ?? undefined,
        );
        emit({ t: 'pending_action', id, actionType: 'memory_write', summary });
        return `Memory write QUEUED for user approval (pending action id: ${id}). Nothing has been written yet. The inline approval card is now visible in the chat. Wait for the user — do not assume the memory was saved.`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[executeTool] Tool "${name}" threw an error:`, err);
    if (msg.includes('No OAuth tokens') || msg.includes('Not connected')) {
      return `Gmail/Drive not connected. Ask the user to connect their Berkeley email in Settings.`;
    }
    return `Tool "${name}" failed with error: ${msg}. Report this exact error to the user verbatim — do not paraphrase or make up a reason.`;
  }
}

// Converts an array of file paths into LocalAttachment objects by inferring
// the filename and MIME type from the path on disk.
function resolveAttachments(filePaths: string[]): LocalAttachment[] {
  const mime = (p: string): string => {
    const ext = path.extname(p).toLowerCase();
    const map: Record<string, string> = {
      '.pdf':  'application/pdf',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.txt':  'text/plain',
      '.csv':  'text/csv',
      '.zip':  'application/zip',
    };
    return map[ext] ?? 'application/octet-stream';
  };

  return filePaths
    .filter((p) => {
      try { return require('fs').existsSync(p); } catch { return false; }
    })
    .map((p) => ({
      filePath: p,
      // Strip the timestamp prefix we added (e.g. "1713024000000_resume.pdf" → "resume.pdf")
      filename: path.basename(p).replace(/^\d+_/, ''),
      mimeType: mime(p),
    }));
}

// ── Tool call cap + dedup ─────────────────────────────────────────────────────

const MAX_TOOL_CALLS_PER_RESPONSE = 3;

type LoopCounter = { toolCalls: number; gmailQueries: string[] };

/** Returns the fraction of significant words shared between two query strings. */
function sharedWords(a: string, b: string): number {
  const stop = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'were', 'from', 'with', 'by', 'about']);
  const words = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !stop.has(w)));
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  return intersection / Math.min(wa.size, wb.size);
}

// ── Core streaming loop ───────────────────────────────────────────────────────

async function runLoop(
  messages: Anthropic.MessageParam[],
  emit: Emitter,
  systemPrompt: string,
  model: string,
  conversationId: string | null = null,
  iteration = 0,
  counter: LoopCounter = { toolCalls: 0, gmailQueries: [] },
): Promise<void> {
  if (iteration > 6) {
    emit({ t: 'text', v: '\n\n[Reached maximum tool iterations]' });
    return;
  }

  // Always include tools — omitting them when tool_results are in the message history
  // causes an Anthropic API error. The system-prompt cap rule handles enforcement.
  const stream = anthropic.messages.stream(
    {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    },
    // 90-second timeout per Anthropic call — prevents silent hangs when the API
    // stalls mid-stream. The outer runLoop wrapper adds a second safety net.
    { timeout: 90_000 },
  );

  // Track tool_use blocks being assembled from streamed input_json_delta chunks
  const pendingTools = new Map<
    number,
    { id: string; name: string; inputJson: string }
  >();

  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        const id = event.content_block.id;
        const name = event.content_block.name;
        pendingTools.set(event.index, { id, name, inputJson: '' });
        // Emit the tool indicator the moment the model decides to call a tool.
        // The label is generic at this point (we don't have parsed input yet);
        // we'll emit a refined-label "ready" event at content_block_stop.
        emit({ t: 'tool_call', id, name, label: toolLabel(name, {}), status: 'starting' });
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        emit({ t: 'text', v: event.delta.text });
      } else if (event.delta.type === 'input_json_delta') {
        const block = pendingTools.get(event.index);
        if (block) block.inputJson += event.delta.partial_json;
      }
    } else if (event.type === 'content_block_stop') {
      const block = pendingTools.get(event.index);
      if (block) {
        let input: Record<string, string> = {};
        try { input = JSON.parse(block.inputJson || '{}'); } catch {}
        // Refine the indicator now that we have parsed input. The client matches
        // on `id` and updates the existing segment in place rather than appending.
        emit({ t: 'tool_call', id: block.id, name: block.name, label: toolLabel(block.name, input), status: 'ready' });
      }
    }
  }

  const finalMsg = await stream.finalMessage();

  if (finalMsg.stop_reason === 'tool_use') {
    counter.toolCalls += pendingTools.size;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const [, block] of pendingTools) {
      let input: Record<string, string> = {};
      try { input = JSON.parse(block.inputJson || '{}'); } catch {}

      let result: string;

      // Gmail dedup: skip searches whose query is ≥60% word-overlap with a prior one
      if (block.name === 'search_emails') {
        const query = input.query ?? '';
        const isDuplicate = counter.gmailQueries.some((q) => sharedWords(query, q) >= 0.6);
        if (isDuplicate) {
          result = `Skipped duplicate Gmail search. You already ran a very similar query. Use the results from your previous search_emails call instead of repeating it.`;
        } else {
          counter.gmailQueries.push(query);
          result = await executeTool(block.name, input, emit, conversationId);
        }
      } else {
        result = await executeTool(block.name, input, emit, conversationId);
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      });
    }

    // Continue the conversation with tool results
    await runLoop(
      [
        ...messages,
        { role: 'assistant', content: finalMsg.content },
        { role: 'user',      content: toolResults },
      ],
      emit,
      systemPrompt,
      model,
      conversationId,
      iteration + 1,
      counter,
    );
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const rawMessages: { role: 'user' | 'assistant'; content: string }[] =
    body.messages ?? [];
  const incomingConvId: string | null = body.conversationId ?? null;
  const incomingAttachments: Array<{ id: string; url: string }> =
    body.attachments ?? [];
  // All user-facing chat runs on the default CHAT model. (The former "Deep"
  // toggle was removed — CHAT and DEEP resolve to the same model, so there is
  // nothing to switch. ROUTES.APP_DEFAULT is retained in lib/models.ts for future use.)
  const requestedModel: string = ROUTES.APP_DEFAULT;

  if (!rawMessages.length) {
    return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
  }

  const latest = rawMessages[rawMessages.length - 1];

  // Resolve or create the conversation
  let convId = incomingConvId;
  let convTitle = 'New Chat';
  const isNewConversation = !convId;

  if (isNewConversation) {
    // Auto-title from the first user message
    convTitle = latest.content.trim().slice(0, 60) || 'New Chat';
    const conv = await prisma.conversation.create({ data: { title: convTitle } });
    convId = conv.id;
  } else {
    // Refresh updatedAt to keep it at the top of the list
    const conv = await prisma.conversation.update({
      where: { id: convId! },
      data: { updatedAt: new Date() },
    });
    convTitle = conv.title;
  }

  // Persist user message with conversationId
  await prisma.chatMessage.create({
    data: {
      role: latest.role,
      content: latest.content,
      conversationId: convId,
      attachments: incomingAttachments.length ? JSON.stringify(incomingAttachments) : undefined,
    },
  });

  // ── /memory command handler ───────────────────────────────────────────────────
  const memCmd = latest.content.trim().match(/^\/memory\s*(\S+)?(?:\s+(.+))?$/i);
  if (memCmd) {
    const sub = (memCmd[1] ?? '').toLowerCase();
    const arg = memCmd[2]?.trim() ?? '';
    const resolvedConvId = convId!;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (text: string) =>
          controller.enqueue(encoder.encode(JSON.stringify({ t: 'text', v: text }) + '\n'));

        controller.enqueue(encoder.encode(JSON.stringify({ t: 'conv', id: resolvedConvId, title: convTitle }) + '\n'));

        try {
          if (sub === 'save') {
            send('Extracting memories from this conversation...');
            await extractAndWriteMemory(resolvedConvId);
            await prisma.conversation.update({ where: { id: resolvedConvId }, data: { memoryExtracted: true } });
            send('\n\nDone. Memory files updated and index regenerated.');
          } else if (sub === 'off') {
            await prisma.conversation.update({ where: { id: resolvedConvId }, data: { memoryExcluded: true } });
            send('Memory extraction is **off** for this conversation. Nothing from this chat will be written to the vault.');
          } else if (sub === 'on') {
            await prisma.conversation.update({ where: { id: resolvedConvId }, data: { memoryExcluded: false, memoryExtracted: false } });
            send('Memory extraction is **on** for this conversation.');
          } else if (sub === 'show') {
            const { readFile } = await import('fs/promises');
            const os = await import('os');
            const indexPath = require('path').join(process.env.VAULT_PATH || require('path').join(os.homedir(), 'vault'), 'memory', 'index.md');
            try {
              const index = await readFile(indexPath, 'utf-8');
              send(`**Memory index:**\n\`\`\`\n${index.slice(0, 3000)}\n\`\`\``);
            } catch {
              send('No memory index found yet.');
            }
          } else if (sub === 'forget' && arg) {
            const { unlink } = await import('fs/promises');
            const os = await import('os');
            const memPath = require('path').join(process.env.VAULT_PATH || require('path').join(os.homedir(), 'vault'), 'memory');
            const candidates = [
              require('path').join(memPath, 'people', `${arg}.md`),
              require('path').join(memPath, 'projects', `${arg}.md`),
            ];
            let deleted = false;
            for (const p of candidates) {
              try { await unlink(p); deleted = true; send(`Deleted \`${p}\``); } catch { /* not found */ }
            }
            if (!deleted) send(`No memory file found for slug \`${arg}\`.`);
          } else {
            send('**Memory commands:**\n- `/memory save` — extract and write memories now\n- `/memory show` — show memory index\n- `/memory off` — exclude this conversation from extraction\n- `/memory on` — re-enable extraction for this conversation\n- `/memory forget <slug>` — delete a person/project memory file');
          }
        } catch (err) {
          send(`\n\nError: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Persist the assistant response
        const responseText = sub === 'save' ? 'Memory saved.' : `Memory command: /memory ${sub} ${arg}`.trim();
        await prisma.chatMessage.create({ data: { role: 'assistant', content: responseText, conversationId: resolvedConvId } });

        controller.close();
      },
    });

    return new NextResponse(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
  }

  // Build system prompt with memory + knowledge context.
  //
  // Trustworthiness audit risk #2: every retrieval layer below used to be
  // wrapped in `try {} catch {}` (silent failure). The user couldn't tell
  // whether a layer ran, returned empty, or threw. Now each layer reports
  // its status into `layerReports`, which is emitted as a `context_status`
  // event before the model starts streaming text.
  let systemPrompt = SYSTEM_PROMPT;
  const layerReports: ContextLayerReport[] = [];

  async function runLayer(
    name: ContextLayerName,
    fn: () => Promise<number>, // returns itemCount (0 ⇒ empty, >0 ⇒ fetched)
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const itemCount = await fn();
      const durationMs = Date.now() - t0;
      layerReports.push({
        name,
        status: itemCount > 0 ? 'fetched' : 'empty',
        itemCount,
        durationMs,
      });
    } catch (err) {
      const durationMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[chat] layer ${name} failed:`, err);
      layerReports.push({ name, status: 'error', durationMs, error: msg });
    }
  }

  // Layer 0 — Vault-based persistent memory (CLAUDE.md + memory/ folder)
  await runLayer('vault', async () => {
    const vaultBlock = await getMemoryBlock(latest.content);
    if (vaultBlock) {
      systemPrompt = `${vaultBlock}\n\n${systemPrompt}`;
      console.log('[chat] vault memory block chars:', vaultBlock.length);
      return 1;
    }
    return 0;
  });

  // Layer 1 — Structured memories from the Memory table (fast, no embedding needed)
  await runLayer('memory', async () => {
    const memories = await getAllMemories(40);
    const memBlock = formatMemoriesForPrompt(memories);
    if (memBlock) {
      systemPrompt += `\n\n<persistent_memory>\nFacts learned about Anatole across past conversations — treat as established truth unless corrected:\n\n${memBlock}\n</persistent_memory>`;
    }
    return memories.length;
  });

  // Layer 2 — Legacy flat memory.json (kept for backwards compat during transition)
  await runLayer('legacy_memory', async () => {
    const legacyMem = readMemory();
    const populatedKeys = Object.values(legacyMem).filter((v) =>
      Array.isArray(v) ? v.length > 0 : Object.keys(v as object).length > 0
    ).length;
    if (populatedKeys > 0) {
      systemPrompt += `\n\n<legacy_memory>\n${JSON.stringify(legacyMem, null, 2)}\n</legacy_memory>`;
    }
    return populatedKeys;
  });

  // C4 (revised) — always-on Claude Code project context. Reads
  // ~/.claude/projects/ via lib/projects.ts, builds a short summary of
  // recent work + commit subjects, injects it under a clearly-labeled
  // section. Cached 60s so we don't hit the filesystem on every turn.
  await runLayer('project', async () => {
    const projectSummary = await buildProjectContextSummary();
    if (projectSummary) {
      systemPrompt += `\n\n## RECENT WORK CONTEXT\n${projectSummary}`;
      return 1;
    }
    return 0;
  });

  // Layer 3 — Semantic RAG + legacy Canvas/Gmail keyword search.
  // Run both concurrently — they don't share state.
  await Promise.all([
    runLayer('knowledge', async () => {
      const ragResults = await semanticSearch(latest.content, { limit: 6, minSimilarity: 0.25 });
      if (ragResults.length) {
        const ragBlock = ragResults
          .map((r) => {
            const meta: Record<string, unknown> = r.item.metadata ? JSON.parse(r.item.metadata) : {};
            const sourceNote =
              r.item.source === 'gmail'
                ? `From: ${meta.from ?? '?'} · Subject: ${meta.subject ?? '?'} · Date: ${meta.date ?? '?'}`
                : r.item.source === 'drive'
                ? `Drive: ${meta.webViewLink ?? ''}`
                : r.item.source === 'downloads'
                ? `Local file: ${meta.path ?? r.item.sourceId}`
                : r.item.source === 'vault'
                ? `Vault: ${r.item.sourceId}`
                : `Upload: ${r.item.sourceId}`;
            return `[${r.item.source.toUpperCase()}] ${r.item.title} (similarity: ${(r.similarity * 100).toFixed(0)}%)\n${sourceNote}\n---\n${r.item.content.slice(0, 2000)}`;
          })
          .join('\n\n');
        systemPrompt += `\n\n<relevant_knowledge>\nRelevant documents from the knowledge index — use these to answer grounded, specific questions:\n\n${ragBlock}\n</relevant_knowledge>`;
      }
      return ragResults.length;
    }),
    runLayer('canvas_gmail', async () => {
      const ctx = await getRelevantContext(latest.content);
      if (ctx) {
        systemPrompt += `\n\n<canvas_context>\n${ctx}\n</canvas_context>`;
        return 1;
      }
      return 0;
    }),
  ]);

  const messages: Anthropic.MessageParam[] = rawMessages.map((m, i) => {
    const isLast = i === rawMessages.length - 1;
    if (isLast && m.role === 'user' && incomingAttachments.length > 0) {
      const imageBlocks: Anthropic.ImageBlockParam[] = [];
      for (const att of incomingAttachments) {
        try {
          const filePath = path.join(process.cwd(), 'public', att.url);
          const data = fs.readFileSync(filePath).toString('base64');
          const ext = path.extname(att.url).slice(1).toLowerCase();
          const mediaType =
            ext === 'png'  ? 'image/png'  :
            ext === 'gif'  ? 'image/gif'  :
            ext === 'webp' ? 'image/webp' : 'image/jpeg';
          imageBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data },
          });
        } catch { /* skip unreadable files */ }
      }
      const content: Anthropic.ContentBlockParam[] = [
        ...imageBlocks,
        ...(m.content.trim() ? [{ type: 'text' as const, text: m.content }] : []),
      ];
      return { role: m.role, content };
    }
    return { role: m.role, content: m.content };
  });

  let assistantText = '';
  // Durable link: the last EmailDraft created during this turn. Persisted on
  // the assistant ChatMessage so the draft/sent card can be rehydrated from
  // history (the draft segment is otherwise live-stream-only and lost on reload).
  let lastDraftId: string | null = null;
  // B-13: same durability for the artifact card — the messages route rebuilds
  // it from artifactTarget via loadLastGreen (hashes re-verified on every fetch).
  let lastArtifactTarget: string | null = null;
  const resolvedConvId = convId!;

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      let closed = false;
      const emit: Emitter = (event) => {
        if (event.t === 'text') assistantText += event.v;
        if (event.t === 'draft') lastDraftId = event.id;
        if (event.t === 'artifact') lastArtifactTarget = event.payload.target;
        if (closed) { console.log('[chat route] emit SKIPPED (closed), t=' + event.t); return; }
        console.log('[chat route] emitting event:', event.t, JSON.stringify(event).slice(0, 120));
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true; // controller closed unexpectedly — mark and move on
        }
      };

      // Always tell the client which conversation this belongs to
      emit({ t: 'conv', id: resolvedConvId, title: convTitle });

      // Surface retrieval health BEFORE the first text delta so the UI can
      // attach the layer report to the about-to-render assistant message.
      emit({ t: 'context_status', layers: layerReports });

      try {
        // 120-second hard ceiling — if runLoop hasn't finished in 2 minutes, kill it.
        // The per-Anthropic-call timeout (90s) should fire first; this is the backstop.
        let loopTimeout: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          loopTimeout = setTimeout(
            () => reject(new Error('[chat] Response timed out — no completion in 120 s')),
            120_000,
          );
        });
        try {
          await Promise.race([runLoop(messages, emit, systemPrompt, requestedModel, resolvedConvId), timeoutPromise]);
        } finally {
          if (loopTimeout) clearTimeout(loopTimeout);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[chat/route] runLoop error:', err);
        emit({ t: 'text', v: `\n\n⚠️ ${msg}` });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed by client disconnect */ }

        if (assistantText || lastDraftId || lastArtifactTarget) {
          await prisma.chatMessage.create({
            data: {
              role: 'assistant',
              content: assistantText,
              conversationId: resolvedConvId,
              emailDraftId: lastDraftId ?? undefined,
              artifactTarget: lastArtifactTarget ?? undefined,
            },
          });
          // Fire-and-forget memory extraction — doesn't block the response
          extractMemoriesFromConversation(resolvedConvId).catch((err) =>
            console.error('[chat] memory extraction failed:', err)
          );
        }
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
