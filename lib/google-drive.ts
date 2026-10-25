import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { withGoogleRetry } from './google-auth';

const TEMP_DIR = '/tmp/aria-attachments';

// Google Workspace MIME → { exportMime, extension } for download-as-file
const WORKSPACE_DOWNLOAD: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document':     { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.spreadsheet':  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: string | null;
  webViewLink: string | null;
};

// Google Workspace types and their plain-text export formats
const WORKSPACE_EXPORT: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

export async function listDriveFiles(
  driveQuery?: string,
  maxResults = 20
): Promise<DriveFile[]> {
  return withGoogleRetry('berkeley', async (auth) => {
    const drive = google.drive({ version: 'v3', auth });

    const q = driveQuery
      ? `(${driveQuery}) and trashed=false`
      : 'trashed=false';

    const res = await drive.files.list({
      q,
      pageSize: maxResults,
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
      orderBy: 'modifiedTime desc',
    });

    return (res.data.files ?? []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      modifiedTime: f.modifiedTime ?? null,
      size: f.size ?? null,
      webViewLink: f.webViewLink ?? null,
    }));
  });
}

// Translate a natural-language query into a Drive name search
export async function searchDriveFiles(query: string): Promise<DriveFile[]> {
  const stopWords = new Set(['the', 'and', 'for', 'my', 'in', 'a', 'an', 'of', 'to']);
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);

  if (!words.length) {
    return listDriveFiles(undefined, 20);
  }

  const conditions = words
    .map((w) => `name contains '${w.replace(/'/g, "\\'")}'`)
    .join(' or ');

  return listDriveFiles(conditions, 15);
}

export async function getDriveFileContent(
  fileId: string,
  hintName?: string
): Promise<string> {
  return withGoogleRetry('berkeley', async (auth) => {
    const drive = google.drive({ version: 'v3', auth });

    // Fetch metadata
    const meta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size',
    });

    const mimeType = meta.data.mimeType ?? '';
    const name = meta.data.name ?? hintName ?? 'Unknown file';
    const sizeBytes = parseInt(meta.data.size ?? '0', 10);

    // Google Workspace docs — export as text
    const exportMime = WORKSPACE_EXPORT[mimeType];
    if (exportMime) {
      const res = await drive.files.export(
        { fileId, mimeType: exportMime },
        { responseType: 'text' }
      );

      let text = res.data as string;
      const truncated = text.length > 50000;
      text = text.slice(0, 50000);

      if (exportMime === 'text/csv') {
        text = formatCsv(text);
      }

      return `[${name}]${truncated ? ' (truncated at 50 000 chars)' : ''}\n\n${text}`;
    }

    // Binary PDF
    if (mimeType === 'application/pdf') {
      if (sizeBytes > 10 * 1024 * 1024) {
        return `[${name} — PDF, ${Math.round(sizeBytes / 1024 / 1024)} MB]\n(File too large to extract text from)`;
      }

      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      return extractPdfText(Buffer.from(res.data as ArrayBuffer), name);
    }

    // Plain text / markdown
    if (mimeType.startsWith('text/') || mimeType.includes('markdown')) {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'text' }
      );

      const text = (res.data as string).slice(0, 50000);
      return `[${name}]\n\n${text}`;
    }

    return `[${name}]\nType: ${mimeType}, Size: ${Math.round(sizeBytes / 1024)} KB\n(Cannot extract text from this file type)`;
  });
}

// --- Helpers ---

function formatCsv(csv: string): string {
  return csv.trim().split('\n').slice(0, 100).join('\n');
}

function extractPdfText(buffer: Buffer, name: string): string {
  const raw = buffer.toString('latin1');
  const chunks: string[] = [];

  const parenRe = /\(([^)]{2,300})\)/g;
  let m;
  while ((m = parenRe.exec(raw)) !== null && chunks.length < 1000) {
    const s = m[1]
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\/g, '');

    if (/^[\x20-\x7E\s]+$/.test(s) && s.trim().length > 3) {
      chunks.push(s.trim());
    }
  }

  if (chunks.length === 0) {
    return `[${name} — PDF]\n(Could not extract text — the PDF may be image-based or encrypted)`;
  }

  const text = chunks.join(' ').replace(/\s+/g, ' ').slice(0, 15000);
  return `[${name} — PDF]\n\n${text}`;
}

// ── Drive-to-temp download (for email attachments) ────────────────────────────

/**
 * Downloads a Drive file to /tmp/aria-attachments/ and returns:
 *   { filePath, filename, mimeType }
 *
 * Google Workspace files (Docs, Sheets, Slides) are exported as PDF/XLSX
 * so they arrive as real binary files the Gmail API can attach.
 */
export async function downloadDriveFileToTemp(
  fileId: string,
  hintName: string
): Promise<{ filePath: string; filename: string; mimeType: string }> {
  return withGoogleRetry('berkeley', async (auth) => {
    const drive = google.drive({ version: 'v3', auth });

    const meta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size',
    });

    const mimeType = meta.data.mimeType ?? 'application/octet-stream';
    const name = meta.data.name ?? hintName;

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const base = path.join(TEMP_DIR, `${Date.now()}_${safe}`);

    const exportInfo = WORKSPACE_DOWNLOAD[mimeType];
    if (exportInfo) {
      const res = await drive.files.export(
        { fileId, mimeType: exportInfo.mime },
        { responseType: 'arraybuffer' }
      );
      const filePath = base + exportInfo.ext;
      fs.writeFileSync(filePath, Buffer.from(res.data as ArrayBuffer));
      const filename = path.basename(filePath).replace(/^\d+_/, ''); // strip timestamp prefix
      return { filePath, filename, mimeType: exportInfo.mime };
    }

    // Binary file — download directly
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    fs.writeFileSync(base, Buffer.from(res.data as ArrayBuffer));
    return { filePath: base, filename: name, mimeType };
  });
}
