import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { withGoogleRetry } from './google-auth';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AttachmentMeta = {
  attachmentId: string;
  name: string;
  mimeType: string;
  size: number;
};

export type LocalAttachment = {
  filename: string;
  mimeType: string;
  filePath: string;
};

const TEMP_DIR = '/tmp/aria-attachments';

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeBase64(data: string) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function decodeBase64Buffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Walk the MIME tree recursively, collecting the first text/html and
 * text/plain bodies we encounter. Gmail's parts are nested — promo
 * mail typically looks like multipart/mixed > multipart/alternative >
 * (text/plain, text/html). The old single-level walker preferred
 * text/plain at top level, which is often the alt-text wall of
 * tracking URLs marketing emails ship. Now we collect both and the
 * caller (and renderer) decides what to display.
 */
function collectBodies(payload: any, out: { html: string | null; text: string | null }): void {
  if (!payload || (out.html && out.text)) return;
  if (payload.mimeType === 'text/html' && payload.body?.data && !out.html) {
    out.html = decodeBase64(payload.body.data);
  } else if (payload.mimeType === 'text/plain' && payload.body?.data && !out.text) {
    out.text = decodeBase64(payload.body.data);
  }
  for (const part of payload.parts ?? []) collectBodies(part, out);
}

export function extractBodies(payload: any): { html: string | null; text: string | null } {
  const out: { html: string | null; text: string | null } = { html: null, text: null };
  collectBodies(payload, out);
  // Top-level message with no parts and a body of its own (rare; usually
  // single-part text/plain Gmail "Updates" notifications).
  if (!out.html && !out.text && payload?.body?.data) {
    if (payload.mimeType === 'text/html') out.html = decodeBase64(payload.body.data);
    else out.text = decodeBase64(payload.body.data);
  }
  return out;
}

/**
 * Legacy single-string extractor — kept for callers that don't care
 * about HTML vs text (e.g. the email-search RAG indexer). Prefers
 * plain text for indexing purposes since HTML strips would otherwise
 * leak through to the embedding pipeline.
 */
function extractBody(payload: any): string {
  const { html, text } = extractBodies(payload);
  return text || html || '';
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

function tempPath(name: string): string {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  return path.join(TEMP_DIR, `${Date.now()}_${safeFilename(name)}`);
}

// ── RFC 2047 subject encoder ──────────────────────────────────────────────────
// Encodes a subject line using UTF-8 base64 encoded-word syntax so that
// special characters (em dash, curly quotes, accented chars, etc.) survive
// SMTP transport without corruption.

function encodeSubject(subject: string): string {
  // If it's pure ASCII with no special chars, skip encoding
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  const b64 = Buffer.from(subject, 'utf-8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

// ── Simple (text-only) email encoder ─────────────────────────────────────────

function encodeSimpleEmail(to: string, subject: string, body: string, from?: string): string {
  // Body must be base64-encoded for UTF-8 safety (CTE: base64)
  const bodyB64 = Buffer.from(body, 'utf-8').toString('base64');
  const wrappedBody = bodyB64.match(/.{1,76}/g)?.join('\r\n') ?? bodyB64;

  const lines = [
    from ? `From: ${from}` : '',
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrappedBody,
  ]
    .filter((l, i) => i !== 0 || l !== '')
    .join('\r\n');

  return Buffer.from(lines, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

// ── Multipart MIME email encoder (with attachments) ───────────────────────────

function encodeMultipartEmail(
  to: string,
  subject: string,
  body: string,
  attachments: LocalAttachment[],
  from?: string
): string {
  const boundary = `aria_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Body part: base64-encoded UTF-8 text
  const bodyB64 = Buffer.from(body, 'utf-8').toString('base64');
  const wrappedBody = bodyB64.match(/.{1,76}/g)?.join('\r\n') ?? bodyB64;

  const lines: string[] = [
    ...(from ? [`From: ${from}`] : []),
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrappedBody,
  ];

  for (const att of attachments) {
    const data = fs.readFileSync(att.filePath);
    const b64 = data.toString('base64');
    // Wrap at 76 chars per RFC 2045
    const wrapped = b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;

    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapped
    );
  }

  lines.push(`--${boundary}--`);

  const raw = lines.join('\r\n');
  return Buffer.from(raw, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

// ── Gmail API wrappers ────────────────────────────────────────────────────────

export async function listEmails(
  accountLabel: string,
  query?: string,
  maxResults = 20
) {
  return withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query ?? 'in:inbox',
      maxResults,
    });

    const messages = res.data.messages ?? [];

    return Promise.all(
      messages.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers = detail.data.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h) => h.name === name)?.value ?? '';

        return {
          id: msg.id!,
          threadId: msg.threadId!,
          from: get('From'),
          subject: get('Subject'),
          date: get('Date'),
          snippet: detail.data.snippet ?? '',
        };
      })
    );
  });
}

export async function getEmail(accountLabel: string, emailId: string) {
  return withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full',
    });

    const headers = res.data.payload?.headers ?? [];
    const get = (name: string) =>
      headers.find((h) => h.name === name)?.value ?? '';

    const { html, text } = extractBodies(res.data.payload);

    return {
      id: res.data.id!,
      threadId: res.data.threadId!,
      from: get('From'),
      to: get('To'),
      subject: get('Subject'),
      date: get('Date'),
      // `body` stays as plain-text for any caller (search/RAG) that
      // expects a single string; the renderer prefers `html` and
      // falls back to `text` via the explicit fields.
      body: text || html || '',
      html,
      text,
      snippet: res.data.snippet ?? '',
    };
  });
}

// Returns attachment metadata (no download)
export async function getAttachments(
  accountLabel: string,
  emailId: string
): Promise<AttachmentMeta[]> {
  return withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });

    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full',
    });

    const result: AttachmentMeta[] = [];

    function walk(payload: any) {
      if (!payload) return;

      if (
        payload.filename &&
        payload.body?.attachmentId &&
        payload.filename.length > 0
      ) {
        result.push({
          attachmentId: payload.body.attachmentId,
          name: payload.filename,
          mimeType: payload.mimeType ?? 'application/octet-stream',
          size: payload.body.size ?? 0,
        });
      }

      for (const part of payload.parts ?? []) {
        walk(part);
      }
    }

    walk(msg.data.payload);
    return result;
  });
}

// Downloads a single attachment to /tmp/aria-attachments/ and returns the local path
export async function downloadAttachment(
  accountLabel: string,
  emailId: string,
  attachmentId: string,
  filename: string
): Promise<string> {
  return withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: emailId,
      id: attachmentId,
    });

    if (!res.data.data) throw new Error('Attachment data missing from API response');

    const buffer = decodeBase64Buffer(res.data.data);
    const filePath = tempPath(filename);
    fs.writeFileSync(filePath, buffer);

    return filePath;
  });
}

export async function sendEmail(
  accountLabel: string,
  to: string,
  subject: string,
  body: string,
  attachments?: LocalAttachment[]
) {
  return withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });

    const raw =
      attachments && attachments.length > 0
        ? encodeMultipartEmail(to, subject, body, attachments)
        : encodeSimpleEmail(to, subject, body);

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return res.data;
  });
}

// Verifies that a sent message actually contains the expected attachment filenames.
// Returns a list of filenames found in the message payload.
export async function verifySentAttachments(
  accountLabel: string,
  messageId: string
): Promise<string[]> {
  return withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const found: string[] = [];

    function walk(payload: any) {
      if (!payload) return;
      if (payload.filename && payload.filename.length > 0 && payload.body?.attachmentId) {
        found.push(payload.filename);
      }
      for (const part of payload.parts ?? []) walk(part);
    }

    walk(res.data.payload);
    return found;
  });
}

export async function draftEmail(
  accountLabel: string,
  to: string,
  subject: string,
  body: string,
  attachments?: LocalAttachment[]
) {
  return withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });

    const raw =
      attachments && attachments.length > 0
        ? encodeMultipartEmail(to, subject, body, attachments)
        : encodeSimpleEmail(to, subject, body);

    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } },
    });

    return res.data;
  });
}

// Downloads all attachments from an email, returns LocalAttachment list
export async function downloadAllAttachments(
  accountLabel: string,
  emailId: string
): Promise<LocalAttachment[]> {
  const metas = await getAttachments(accountLabel, emailId);

  const downloaded: LocalAttachment[] = [];
  for (const meta of metas) {
    const filePath = await downloadAttachment(
      accountLabel,
      emailId,
      meta.attachmentId,
      meta.name
    );
    downloaded.push({ filename: meta.name, mimeType: meta.mimeType, filePath });
  }

  return downloaded;
}

// Fetches an email and all its attachments, builds a forwarded email, returns
// the draft payload (caller decides whether to show draft or send immediately)
export async function buildForwardPayload(
  accountLabel: string,
  emailId: string,
  to: string,
  additionalMessage?: string
): Promise<{
  to: string;
  subject: string;
  body: string;
  attachments: LocalAttachment[];
}> {
  const [email, attachments] = await Promise.all([
    getEmail(accountLabel, emailId),
    downloadAllAttachments(accountLabel, emailId),
  ]);

  const quotedBody = [
    additionalMessage ?? '',
    '',
    '---------- Forwarded message ----------',
    `From: ${email.from}`,
    `Date: ${email.date}`,
    `Subject: ${email.subject}`,
    `To: ${email.to}`,
    '',
    email.body,
  ]
    .join('\n')
    .trimStart();

  return {
    to,
    subject: `Fwd: ${email.subject}`,
    body: quotedBody,
    attachments,
  };
}
