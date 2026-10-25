/**
 * lib/file-extractor.ts
 *
 * Universal file content extractor. Dispatches by MIME type / extension.
 * Supported: plain text, code, PDF, DOCX, PPTX, Excel, EPUB, images (Claude vision), ZIP.
 *
 * Max file size: 50 MB (enforced upstream in the route).
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from './models';
import { ROUTES } from '@/lib/models';

export interface ExtractionResult {
  extractedText: string;
  extractedPreview: string; // first ~500 chars of clean text
  pageCount?: number;
  wordCount: number;
  mimeType: string;
  method: string; // for debugging
}

// ── Text / code ───────────────────────────────────────────────────────────────

const TEXT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-sh',
  'application/x-python',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.xml',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go',
  '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.yaml', '.yml', '.toml',
  '.html', '.htm', '.css', '.scss', '.sql', '.r', '.swift',
]);

function isTextual(mimeType: string, ext: string): boolean {
  return TEXT_TYPES.has(mimeType) || mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(ext);
}

async function extractText(buffer: Buffer): Promise<ExtractionResult> {
  const text = buffer.toString('utf-8');
  return {
    extractedText: text,
    extractedPreview: text.slice(0, 500),
    wordCount: countWords(text),
    mimeType: 'text/plain',
    method: 'utf8',
  };
}

// ── PDF ───────────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  // pdf2json: pure Node.js, no browser API dependencies (no DOMMatrix)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require('pdf2json');
  return new Promise((resolve, reject) => {
    // second arg true = rawText mode
    const parser = new PDFParser(null, true);

    parser.on('pdfParser_dataError', (errData: { parserError: unknown }) => {
      reject(new Error(`PDF parse error: ${String(errData.parserError)}`));
    });

    parser.on('pdfParser_dataReady', (pdfData: { Pages?: unknown[] }) => {
      const text: string = parser.getRawTextContent().trim();
      const pageCount = pdfData.Pages?.length ?? 0;
      resolve({
        extractedText: text,
        extractedPreview: text.slice(0, 500),
        pageCount,
        wordCount: countWords(text),
        mimeType: 'application/pdf',
        method: 'pdf2json',
      });
    });

    parser.parseBuffer(buffer);
  });
}

// ── DOCX ──────────────────────────────────────────────────────────────────────

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  const text = (value as string).trim();
  return {
    extractedText: text,
    extractedPreview: text.slice(0, 500),
    wordCount: countWords(text),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    method: 'mammoth',
  };
}

// ── Excel ─────────────────────────────────────────────────────────────────────

async function extractExcel(buffer: Buffer): Promise<ExtractionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const lines: string[] = [];
  for (const sheetName of wb.SheetNames as string[]) {
    lines.push(`## Sheet: ${sheetName}`);
    const csv: string = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
    lines.push(csv.trim());
  }
  const text = lines.join('\n\n');
  return {
    extractedText: text,
    extractedPreview: text.slice(0, 500),
    wordCount: countWords(text),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    method: 'xlsx',
  };
}

// ── PPTX ──────────────────────────────────────────────────────────────────────

async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require('jszip');
  const zip = await (JSZip as { loadAsync: (b: Buffer) => Promise<{ files: Record<string, { name: string; async: (t: string) => Promise<string> }> }> }).loadAsync(buffer);
  const slides: string[] = [];

  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort();

  for (const slideFile of slideFiles) {
    const xml = await zip.files[slideFile].async('string');
    // Strip XML tags, decode entities
    const text = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (text) slides.push(text);
  }

  const text = slides.map((s, i) => `[Slide ${i + 1}] ${s}`).join('\n\n');
  return {
    extractedText: text,
    extractedPreview: text.slice(0, 500),
    pageCount: slides.length,
    wordCount: countWords(text),
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    method: 'jszip-pptx',
  };
}

// ── EPUB ──────────────────────────────────────────────────────────────────────

async function extractEpub(buffer: Buffer): Promise<ExtractionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require('jszip');
  const zip = await (JSZip as { loadAsync: (b: Buffer) => Promise<{ files: Record<string, { name: string; async: (t: string) => Promise<string> }> }> }).loadAsync(buffer);

  const htmlFiles = Object.keys(zip.files).filter(
    (f) => f.endsWith('.html') || f.endsWith('.xhtml') || f.endsWith('.htm'),
  );

  const parts: string[] = [];
  for (const f of htmlFiles) {
    const html = await zip.files[f].async('string');
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) parts.push(text);
  }

  const text = parts.join('\n\n');
  return {
    extractedText: text,
    extractedPreview: text.slice(0, 500),
    wordCount: countWords(text),
    mimeType: 'application/epub+zip',
    method: 'jszip-epub',
  };
}

// ── ZIP ───────────────────────────────────────────────────────────────────────

async function extractZip(buffer: Buffer): Promise<ExtractionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require('jszip');
  const zip = await (JSZip as { loadAsync: (b: Buffer) => Promise<{ files: Record<string, { name: string; dir: boolean; async: (t: string) => Promise<string> }> }> }).loadAsync(buffer);

  const fileList = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
  const lines: string[] = [`ZIP archive — ${fileList.length} file(s):`];
  const textParts: string[] = [];

  for (const f of fileList) {
    lines.push(`  • ${f}`);
    const ext = f.slice(f.lastIndexOf('.')).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext) && !f.includes('__MACOSX')) {
      try {
        const content = await zip.files[f].async('string');
        if (content.length < 50_000) {
          textParts.push(`### ${f}\n${content}`);
        }
      } catch {
        // Binary file, skip
      }
    }
  }

  const listing = lines.join('\n');
  const text = textParts.length > 0 ? `${listing}\n\n${textParts.join('\n\n')}` : listing;

  return {
    extractedText: text,
    extractedPreview: listing.slice(0, 500),
    wordCount: countWords(text),
    mimeType: 'application/zip',
    method: 'jszip-listing',
  };
}

// ── Image — Claude vision ─────────────────────────────────────────────────────

const IMAGE_TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

async function extractImage(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractionResult> {
  const client = new Anthropic();
  const mediaType = IMAGE_TYPES[mimeType] ?? 'image/jpeg';
  const base64 = buffer.toString('base64');

  const message = await client.messages.create({
    model: ROUTES.APP_DEFAULT,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `Describe this image comprehensively for use as a knowledge base entry. File name: "${filename}". Include: what is shown, any text visible, context, and key details worth remembering. Be thorough but concise.`,
          },
        ],
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : `[Image: ${filename}]`;

  return {
    extractedText: text,
    extractedPreview: text.slice(0, 500),
    wordCount: countWords(text),
    mimeType,
    method: 'claude-vision',
  };
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function extractFileContent(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractionResult> {
  const ext = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
    : '';

  // Text / code
  if (isTextual(mimeType, ext)) {
    return extractText(buffer);
  }

  // PDF
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    return extractPdf(buffer);
  }

  // DOCX
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) {
    return extractDocx(buffer);
  }

  // Excel
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    ext === '.xlsx' ||
    ext === '.xls'
  ) {
    return extractExcel(buffer);
  }

  // PPTX
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === '.pptx'
  ) {
    return extractPptx(buffer);
  }

  // EPUB
  if (mimeType === 'application/epub+zip' || ext === '.epub') {
    return extractEpub(buffer);
  }

  // Images
  if (IMAGE_TYPES[mimeType] || ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    return extractImage(buffer, mimeType, filename);
  }

  // ZIP / generic archive
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed' ||
    ext === '.zip'
  ) {
    return extractZip(buffer);
  }

  // Fallback — try UTF-8 decode, surface as text
  try {
    return extractText(buffer);
  } catch {
    return {
      extractedText: `[Binary file: ${filename} — ${buffer.length} bytes — type: ${mimeType}]`,
      extractedPreview: `Binary file (${mimeType})`,
      wordCount: 0,
      mimeType,
      method: 'fallback-binary',
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
