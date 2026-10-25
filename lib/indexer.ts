/**
 * Unified knowledge indexer for Hatch.
 *
 * Sources: vault (.md), downloads, Gmail attachments, Google Drive, uploaded files.
 * Each item is extracted to text, hashed for dedup, embedded via OpenAI, and stored
 * in KnowledgeItem. Semantic search uses in-process cosine similarity over stored
 * float32 embeddings (SQLite bytes column).
 */

import os from 'os';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { readFile, writeFile, unlink, stat, readdir } from 'fs/promises';
import { prisma } from './prisma';
import { isRestrictedFile, EXCLUDED_SENDER_DOMAINS, EXCLUDED_SENDER_KEYWORDS, EXCLUDED_SUBJECT_KEYWORDS } from './sync-config';

type KnowledgeItem = Awaited<ReturnType<typeof prisma.knowledgeItem.findFirst>> & object;

// ── Text extraction ───────────────────────────────────────────────────────────

export async function extractText(filePath: string, mimeType: string): Promise<string> {
  const buffer = await readFile(filePath);

  if (mimeType === 'application/pdf' || filePath.endsWith('.pdf')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const PDFParser = require('pdf2json') as any;
      const text = await new Promise<string>((resolve, reject) => {
        const parser = new PDFParser(null, true);
        parser.on('pdfParser_dataError', (e: { parserError: unknown }) => reject(e.parserError));
        parser.on('pdfParser_dataReady', () => resolve((parser.getRawTextContent() as string).trim()));
        parser.parseBuffer(buffer);
      });
      return text;
    } catch {
      return '';
    }
  }

  if (
    mimeType.includes('wordprocessingml') ||
    filePath.endsWith('.docx')
  ) {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch {
      return '';
    }
  }

  if (
    mimeType.startsWith('text/') ||
    /\.(md|txt|json|csv|ts|tsx|js|jsx|py|yaml|yml)$/.test(filePath)
  ) {
    return buffer.toString('utf-8');
  }

  return '';
}

// ── SHA-256 dedup hash ────────────────────────────────────────────────────────

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

// ── Embedding helpers ─────────────────────────────────────────────────────────

export function embeddingToBytes(emb: Float32Array): Buffer {
  return Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength);
}

export function bytesToEmbedding(b: Buffer): Float32Array {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Float32Array(ab);
}

export async function embedText(text: string): Promise<Float32Array | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[indexer] OPENAI_API_KEY not set — skipping embedding');
    return null;
  }

  const truncated = text.slice(0, 32000);

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: truncated,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[indexer] Embedding API error:', err);
      return null;
    }

    const data = await res.json();
    return new Float32Array(data.data[0].embedding);
  } catch (err) {
    console.error('[indexer] embedText failed:', err);
    return null;
  }
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Semantic search ───────────────────────────────────────────────────────────

export async function semanticSearch(
  query: string,
  { limit = 10, sources, minSimilarity = 0.25 }: {
    limit?: number;
    sources?: string[];
    minSimilarity?: number;
  } = {}
): Promise<Array<{ item: KnowledgeItem; similarity: number }>> {
  const queryEmbedding = await embedText(query);

  // Fallback: keyword search when embeddings unavailable
  if (!queryEmbedding) {
    return keywordSearch(query, { limit, sources });
  }

  const where = sources ? { source: { in: sources } } : {};
  const items = await prisma.knowledgeItem.findMany({
    where,
    select: {
      id: true, source: true, sourceId: true, type: true,
      title: true, content: true, metadata: true, embedding: true,
      indexedAt: true, updatedAt: true, createdAt: true, contentHash: true,
    },
  });

  return items
    .filter((i) => i.embedding)
    .map((item) => {
      const emb = bytesToEmbedding(item.embedding as Buffer);
      const similarity = cosineSimilarity(queryEmbedding, emb);
      return { item: item as KnowledgeItem, similarity };
    })
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

async function keywordSearch(
  query: string,
  { limit = 10, sources }: { limit?: number; sources?: string[] } = {}
): Promise<Array<{ item: KnowledgeItem; similarity: number }>> {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (!terms.length) return [];

  const where = sources ? { source: { in: sources } } : {};
  const items = await prisma.knowledgeItem.findMany({ where, take: 500 });

  return items
    .map((item) => {
      const text = `${item.title} ${item.content}`.toLowerCase();
      const hits = terms.reduce((n, t) => n + (text.match(new RegExp(t, 'g'))?.length ?? 0), 0);
      return { item, similarity: hits / 10 };
    })
    .filter((r) => r.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// ── Directory walker ──────────────────────────────────────────────────────────

async function walkDir(dir: string, pattern: RegExp): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await walkDir(full, pattern);
        results.push(...sub);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(full);
      }
    }
  } catch { /* skip inaccessible dirs */ }
  return results;
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

async function upsertItem(args: {
  source: string;
  sourceId: string;
  type: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<'added' | 'updated' | 'skipped'> {
  const content = args.content.slice(0, 100_000);
  const hash = sha256(content);

  const existing = await prisma.knowledgeItem.findUnique({
    where: { source_sourceId: { source: args.source, sourceId: args.sourceId } },
    select: { contentHash: true },
  });

  if (existing?.contentHash === hash) return 'skipped';

  const embedding = await embedText(content);
  const embeddingBytes = embedding ? embeddingToBytes(embedding) : null;

  const data = {
    type: args.type,
    title: args.title,
    content,
    contentHash: hash,
    metadata: args.metadata ? JSON.stringify(args.metadata) : null,
    embedding: embeddingBytes as unknown as Uint8Array<ArrayBuffer> | null,
    indexedAt: new Date(),
    updatedAt: new Date(),
  };

  await prisma.knowledgeItem.upsert({
    where: { source_sourceId: { source: args.source, sourceId: args.sourceId } },
    create: { source: args.source, sourceId: args.sourceId, ...data },
    update: data,
  });

  return existing ? 'updated' : 'added';
}

// ── Source indexers ───────────────────────────────────────────────────────────

/**
 * Index (or re-index) ONE vault markdown file into KnowledgeItem. This is the
 * single-file path shared by the batch indexVault() loop AND the index-on-write
 * hook in the vault_write executor (B-41), so the two can never drift — both go
 * through the same upsertItem (same dedup-hash + embedText null-fallback +
 * source:'vault' shape). `preReadContent` lets the batch loop avoid a second read.
 * Returns 'skipped' for restricted/empty files (and unchanged content, via upsert).
 * Throws on I/O or DB error — the write executor wraps this call in a swallow so an
 * index failure can never block or roll back an already-committed write.
 */
export async function indexVaultFile(
  absPath: string,
  preReadContent?: string,
): Promise<'added' | 'updated' | 'skipped'> {
  const vaultPath = process.env.VAULT_PATH ?? path.join(os.homedir(), 'vault');
  const relPath = path.relative(vaultPath, absPath);
  if (isRestrictedFile(relPath)) return 'skipped';
  const content = preReadContent ?? (await readFile(absPath, 'utf-8'));
  if (!content.trim()) return 'skipped';
  const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  const title = titleMatch ? titleMatch[1] : path.basename(absPath, '.md');
  return upsertItem({
    source: 'vault',
    sourceId: relPath,
    type: 'note',
    title,
    content,
    metadata: { path: relPath },
  });
}

export async function indexVault(): Promise<{ processed: number; added: number; updated: number; errors: number }> {
  const vaultPath = process.env.VAULT_PATH ?? path.join(os.homedir(), 'vault');
  const files = await walkDir(vaultPath, /\.md$/);

  const stats = { processed: 0, added: 0, updated: 0, errors: 0 };

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf-8');
      if (!content.trim()) continue;

      const relPath = path.relative(vaultPath, filePath);

      // Skip restricted files
      if (isRestrictedFile(relPath)) continue;

      // Reuse the single-file indexer (same upsert path as the index-on-write hook).
      const result = await indexVaultFile(filePath, content);

      stats.processed++;
      if (result === 'added') stats.added++;
      else if (result === 'updated') stats.updated++;
    } catch {
      stats.errors++;
    }
  }

  return stats;
}

export async function indexDownloads(): Promise<{ processed: number; added: number; updated: number; errors: number }> {
  const downloadsPath = path.join(os.homedir(), 'Downloads');
  const files = await walkDir(downloadsPath, /\.(pdf|docx|txt|md|csv|pptx)$/i);
  const stats = { processed: 0, added: 0, updated: 0, errors: 0 };

  for (const filePath of files) {
    try {
      if (isRestrictedFile(path.basename(filePath))) continue;

      const fileStat = await stat(filePath);
      if (fileStat.size > 20 * 1024 * 1024) continue; // skip > 20MB

      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.csv': 'text/csv',
      };
      const mimeType = mimeMap[ext] ?? 'text/plain';

      const content = await extractText(filePath, mimeType);
      if (!content || content.length < 20) continue;

      const result = await upsertItem({
        source: 'downloads',
        sourceId: filePath,
        type: 'document',
        title: path.basename(filePath),
        content,
        metadata: { path: filePath, size: fileStat.size, mimeType, modifiedTime: fileStat.mtime },
      });

      stats.processed++;
      if (result === 'added') stats.added++;
      else if (result === 'updated') stats.updated++;
    } catch {
      stats.errors++;
    }
  }

  return stats;
}

export async function indexUploads(): Promise<{ processed: number; added: number; updated: number; errors: number }> {
  const uploadDirs = [
    path.join(process.cwd(), '.tmp', 'email-attachments'),
    path.join(process.cwd(), 'public', 'uploads'),
  ];
  const stats = { processed: 0, added: 0, updated: 0, errors: 0 };

  for (const dir of uploadDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await walkDir(dir, /\.(pdf|docx|txt|md|csv|png|jpg|jpeg)$/i);

    for (const filePath of files) {
      try {
        if (isRestrictedFile(path.basename(filePath))) continue;

        const ext = path.extname(filePath).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.pdf': 'application/pdf',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.txt': 'text/plain',
          '.md': 'text/markdown',
          '.csv': 'text/csv',
        };
        const mimeType = mimeMap[ext] ?? 'application/octet-stream';

        const content = await extractText(filePath, mimeType);
        if (!content || content.length < 20) continue;

        const result = await upsertItem({
          source: 'upload',
          sourceId: filePath,
          type: 'document',
          title: path.basename(filePath).replace(/^\d+_/, ''),
          content,
          metadata: { path: filePath, mimeType },
        });

        stats.processed++;
        if (result === 'added') stats.added++;
        else if (result === 'updated') stats.updated++;
      } catch {
        stats.errors++;
      }
    }
  }

  return stats;
}

// Checks whether a Gmail sender should be excluded from indexing
function isExcludedSender(from: string): boolean {
  const lower = from.toLowerCase();
  if (EXCLUDED_SENDER_DOMAINS.some((d) => lower.includes(d))) return true;
  if (EXCLUDED_SENDER_KEYWORDS.some((k) => lower.includes(k))) return true;
  return false;
}

function isExcludedSubject(subject: string): boolean {
  const lower = subject.toLowerCase();
  return EXCLUDED_SUBJECT_KEYWORDS.some((k) => lower.includes(k));
}

type GmailPart = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

function flattenParts(payload: GmailPart | undefined): GmailPart[] {
  if (!payload) return [];
  const results: GmailPart[] = [payload];
  for (const part of payload.parts ?? []) {
    results.push(...flattenParts(part));
  }
  return results;
}

function getHeader(msg: { payload?: { headers?: Array<{ name: string; value: string }> } }, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export async function indexGmailAttachments(
  { sinceDays = 365 }: { sinceDays?: number } = {}
): Promise<{ processed: number; added: number; updated: number; errors: number }> {
  const stats = { processed: 0, added: 0, updated: 0, errors: 0 };

  try {
    const { withGoogleRetry } = await import('./google-auth');
    const { google } = await import('googleapis');

    await withGoogleRetry('berkeley', async (auth) => {
      const gmail = google.gmail({ version: 'v1', auth });
      const afterTs = Math.floor((Date.now() - sinceDays * 86_400_000) / 1000);

      let pageToken: string | undefined;
      do {
        const listRes = await gmail.users.messages.list({
          userId: 'me',
          q: `has:attachment after:${afterTs}`,
          maxResults: 50,
          pageToken,
        });

        for (const m of listRes.data.messages ?? []) {
          const msg = await gmail.users.messages.get({ userId: 'me', id: m.id! });
          const from = getHeader(msg.data as any, 'From');
          const subject = getHeader(msg.data as any, 'Subject');

          if (isExcludedSender(from) || isExcludedSubject(subject)) continue;

          const parts = flattenParts(msg.data.payload as GmailPart);
          for (const part of parts) {
            if (!part.filename || !part.body?.attachmentId) continue;
            if (isRestrictedFile(part.filename)) continue;
            if (!part.mimeType?.match(/pdf|word|text|csv/i)) continue;

            try {
              const attData = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: m.id!,
                id: part.body.attachmentId,
              });

              const b64 = (attData.data.data ?? '').replace(/-/g, '+').replace(/_/g, '/');
              const buf = Buffer.from(b64, 'base64');

              const tmpPath = path.join(os.tmpdir(), `gmail_${m.id}_${part.filename.replace(/[^a-z0-9._-]/gi, '_')}`);
              await writeFile(tmpPath, buf);

              let text = '';
              try {
                text = await extractText(tmpPath, part.mimeType ?? '');
              } finally {
                await unlink(tmpPath).catch(() => {});
              }

              if (!text || text.length < 20) continue;

              const sourceId = `${m.id}_${part.body.attachmentId}`;
              const result = await upsertItem({
                source: 'gmail',
                sourceId,
                type: 'document',
                title: part.filename,
                content: text,
                metadata: {
                  messageId: m.id,
                  attachmentId: part.body.attachmentId,
                  filename: part.filename,
                  mimeType: part.mimeType,
                  from,
                  subject,
                  date: getHeader(msg.data as any, 'Date'),
                },
              });

              stats.processed++;
              if (result === 'added') stats.added++;
              else if (result === 'updated') stats.updated++;
            } catch {
              stats.errors++;
            }
          }
        }

        pageToken = listRes.data.nextPageToken ?? undefined;
      } while (pageToken);
    });
  } catch (err) {
    console.error('[indexGmailAttachments] failed:', err);
    stats.errors++;
  }

  return stats;
}

export async function indexDrive(
  { sinceDays = 365 }: { sinceDays?: number } = {}
): Promise<{ processed: number; added: number; updated: number; errors: number }> {
  const stats = { processed: 0, added: 0, updated: 0, errors: 0 };

  try {
    const { withGoogleRetry } = await import('./google-auth');
    const { google } = await import('googleapis');

    await withGoogleRetry('berkeley', async (auth) => {
      const drive = google.drive({ version: 'v3', auth });
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `modifiedTime > '${since}' and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
          pageSize: 100,
          pageToken,
        });

        for (const file of res.data.files ?? []) {
          if (!file.id || !file.name) continue;
          if (isRestrictedFile(file.name)) continue;

          let text = '';
          try {
            if (file.mimeType === 'application/vnd.google-apps.document') {
              const exp = await drive.files.export(
                { fileId: file.id, mimeType: 'text/plain' },
                { responseType: 'text' }
              );
              text = exp.data as string;
            } else if (file.mimeType?.match(/pdf|wordprocessingml|spreadsheetml|text\//)) {
              const exp = await drive.files.get(
                { fileId: file.id, alt: 'media' },
                { responseType: 'arraybuffer' }
              );
              const buf = Buffer.from(exp.data as ArrayBuffer);
              const tmpPath = path.join(os.tmpdir(), `drive_${file.id}`);
              await writeFile(tmpPath, buf);
              try {
                text = await extractText(tmpPath, file.mimeType ?? '');
              } finally {
                await unlink(tmpPath).catch(() => {});
              }
            } else {
              continue;
            }
          } catch {
            stats.errors++;
            continue;
          }

          if (!text || text.length < 20) continue;

          const result = await upsertItem({
            source: 'drive',
            sourceId: file.id,
            type: 'document',
            title: file.name,
            content: text,
            metadata: {
              fileId: file.id,
              mimeType: file.mimeType,
              webViewLink: file.webViewLink,
              modifiedTime: file.modifiedTime,
            },
          });

          stats.processed++;
          if (result === 'added') stats.added++;
          else if (result === 'updated') stats.updated++;
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    });
  } catch (err) {
    console.error('[indexDrive] failed:', err);
    stats.errors++;
  }

  return stats;
}

// ── Run a full or partial index job ──────────────────────────────────────────

export type IndexSource = 'vault' | 'downloads' | 'upload' | 'gmail' | 'drive' | 'all';

export async function runIndexJob(sources: IndexSource[] = ['all']): Promise<Record<string, { processed: number; added: number; updated: number; errors: number }>> {
  const doAll = sources.includes('all');
  const results: Record<string, { processed: number; added: number; updated: number; errors: number }> = {};

  const job = await prisma.indexingJob.create({
    data: { source: sources.join(','), status: 'running' },
  });

  try {
    if (doAll || sources.includes('vault')) {
      console.log('[indexer] indexing vault...');
      results.vault = await indexVault();
    }
    if (doAll || sources.includes('downloads')) {
      console.log('[indexer] indexing downloads...');
      results.downloads = await indexDownloads();
    }
    if (doAll || sources.includes('upload')) {
      console.log('[indexer] indexing uploads...');
      results.upload = await indexUploads();
    }
    if (doAll || sources.includes('gmail')) {
      console.log('[indexer] indexing gmail attachments...');
      results.gmail = await indexGmailAttachments();
    }
    if (doAll || sources.includes('drive')) {
      console.log('[indexer] indexing drive...');
      results.drive = await indexDrive();
    }

    await prisma.indexingJob.update({
      where: { id: job.id },
      data: { status: 'completed', stats: JSON.stringify(results), finishedAt: new Date() },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.indexingJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: msg, finishedAt: new Date() },
    });
    throw err;
  }

  return results;
}

// ── Knowledge stats ───────────────────────────────────────────────────────────

export async function getKnowledgeStats(): Promise<Record<string, number>> {
  const groups = await prisma.knowledgeItem.groupBy({
    by: ['source'],
    _count: { id: true },
  });

  const stats: Record<string, number> = {};
  for (const g of groups) {
    stats[g.source] = g._count.id;
  }
  return stats;
}
