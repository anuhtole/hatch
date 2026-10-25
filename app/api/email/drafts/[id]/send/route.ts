import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { downloadAttachment, type LocalAttachment } from '@/lib/gmail';
import { downloadDriveFileToTemp } from '@/lib/google-drive';
import { createPendingAction, type EmailSendPayload, type EmailSendAttachment } from '@/lib/pending-actions';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const draft = await prisma.emailDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (draft.status !== 'draft') {
    return NextResponse.json({ error: `Draft is already ${draft.status}` }, { status: 400 });
  }

  // Parse recipients — to is a JSON array, but may also be a plain string for backwards compat
  let toAddresses: string[] = [];
  try {
    const parsed = JSON.parse(draft.to);
    toAddresses = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    toAddresses = [draft.to];
  }
  const cleanRecipients = toAddresses.map((a) => a.trim()).filter(Boolean);

  // Safety gate: never send to an empty or malformed recipient list. This is
  // a server-side guard so an invalid-address send is impossible regardless of
  // which UI (or future caller) hits this route.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (cleanRecipients.length === 0) {
    return NextResponse.json({ error: 'No recipient specified.' }, { status: 400 });
  }
  const invalid = cleanRecipients.filter((a) => !EMAIL_RE.test(a));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid recipient address(es): ${invalid.join(', ')}` },
      { status: 400 },
    );
  }
  const to = cleanRecipients.join(', ');

  // Resolve attachments from DB
  const localAttachments: LocalAttachment[] = [];
  if (draft.attachments) {
    try {
      const stored: Array<{ source: string; sourceId: string; filename: string; mimeType?: string }> =
        JSON.parse(draft.attachments);
      for (const att of stored) {
        try {
          if (att.source === 'upload' && att.sourceId && fs.existsSync(att.sourceId)) {
            const mimeType = att.mimeType ?? guessMime(att.filename);
            localAttachments.push({ filename: att.filename, mimeType, filePath: att.sourceId });
          } else if (att.source === 'gmail' && att.sourceId) {
            // sourceId format: "emailId:attachmentId"
            const colonIdx = att.sourceId.indexOf(':');
            if (colonIdx !== -1) {
              const emailId = att.sourceId.slice(0, colonIdx);
              const attachmentId = att.sourceId.slice(colonIdx + 1);
              const filePath = await downloadAttachment('berkeley', emailId, attachmentId, att.filename);
              const mimeType = att.mimeType ?? guessMime(att.filename);
              localAttachments.push({ filename: att.filename, mimeType, filePath });
            }
          } else if (att.source === 'drive' && att.sourceId) {
            const { filePath, filename, mimeType } = await downloadDriveFileToTemp(att.sourceId, att.filename);
            localAttachments.push({ filename, mimeType, filePath });
          } else if (att.source === 'knowledge' && att.sourceId) {
            // Look up the KnowledgeItem and resolve its actual file location
            const item = await prisma.knowledgeItem.findUnique({ where: { id: att.sourceId } });
            if (item) {
              const meta: Record<string, string> = item.metadata ? JSON.parse(item.metadata) : {};
              if (item.source === 'upload' || item.source === 'downloads') {
                const filePath = meta.path ?? item.sourceId;
                if (fs.existsSync(filePath)) {
                  localAttachments.push({ filename: att.filename || item.title, mimeType: meta.mimeType ?? guessMime(item.title), filePath });
                }
              } else if (item.source === 'drive' && meta.fileId) {
                const { filePath, filename, mimeType } = await downloadDriveFileToTemp(meta.fileId, item.title);
                localAttachments.push({ filename, mimeType, filePath });
              } else if (item.source === 'gmail' && meta.messageId && meta.attachmentId) {
                const filePath = await downloadAttachment('berkeley', meta.messageId, meta.attachmentId, item.title);
                localAttachments.push({ filename: item.title, mimeType: meta.mimeType ?? guessMime(item.title), filePath });
              } else {
                // Fallback: write content to a temp .txt file
                const tmpPath = path.join(os.tmpdir(), `knowledge_${item.id}.txt`);
                fs.writeFileSync(tmpPath, item.content, 'utf-8');
                localAttachments.push({ filename: `${item.title}.txt`, mimeType: 'text/plain', filePath: tmpPath });
              }
            }
          }
        } catch (attErr) {
          console.error('[send] Failed to resolve attachment:', att.filename, attErr);
        }
      }
    } catch {}
  }

  // HATCH NEVER SENDS (B-10): this route resolves the final bytes and queues an
  // email_send PendingAction. Dispatch happens ONLY in the pending-action
  // executor, on explicit per-message approval; the executor re-verifies each
  // attachment hash and marks the draft sent afterwards (via payload.draftId).
  try {
    const hashedAttachments: EmailSendAttachment[] = localAttachments.map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      filePath: a.filePath,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(a.filePath)).digest('hex'),
    }));

    const payload: EmailSendPayload = {
      account: 'berkeley',
      to,
      subject: draft.subject,
      body: draft.body,
      attachments: hashedAttachments.length ? hashedAttachments : undefined,
      draftId: id,
    };
    const { id: pendingActionId, summary } = await createPendingAction('email_send', payload);
    return NextResponse.json(
      { success: true, requiresApproval: true, pendingActionId, summary },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
