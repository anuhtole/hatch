/**
 * lib/resume/docx-pdf.ts — real text-layer docx→PDF export (B-11).
 *
 * LibreOffice headless conversion (the B-7-era qlmanage/sips path in
 * check-visual.ts produces a RASTER pdf — fine for the vision gate, unusable as
 * an attachment: no text layer, no ATS parse). This module is the single shared
 * converter; run-pipeline calls it on every green run.
 *
 * FIDELITY GATE (B-7 font-fidelity rule applied to PDF): a font substitution
 * that shifts line breaks shows up as content overflowing the page budget — so
 * the converted PDF MUST have exactly the expected page count, else we fail
 * loudly and name substitution as the likely cause. Intra-page layout issues
 * remain covered by the visual (vision) gate on the rendered PNG.
 */

import { execFileSync } from 'child_process';
import { existsSync, renameSync } from 'fs';
import { readFileSync } from 'fs';
import { basename, dirname, join } from 'path';

const SOFFICE_CANDIDATES = [
  'soffice', // PATH
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
];

export function findSoffice(): string {
  for (const c of SOFFICE_CANDIDATES) {
    try {
      execFileSync(c === 'soffice' ? 'which' : 'test', c === 'soffice' ? [c] : ['-x', c], { stdio: 'pipe' });
      return c;
    } catch { /* next candidate */ }
  }
  throw new Error('LibreOffice (soffice) not found — install it (brew install --cask libreoffice) to produce PDF exports.');
}

/** Count pages in a PDF: prefer the page-tree /Count, fall back to /Type /Page objects. */
export function pdfPageCount(pdfPath: string): number {
  const raw = readFileSync(pdfPath).toString('latin1');
  const counts = [...raw.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length) return Math.max(...counts);
  const pageObjs = raw.match(/\/Type\s*\/Page(?![s\w])/g);
  return pageObjs ? pageObjs.length : 0;
}

export interface PdfExport { pdfPath: string; pages: number }

/**
 * Convert docx → PDF next to `outName` in the docx's directory. Throws loudly
 * on conversion failure or a page-count mismatch (font-substitution symptom).
 */
export function convertDocxToPdf(docxPath: string, outName: string, expectedPages: number): PdfExport {
  const dir = dirname(docxPath);
  const soffice = findSoffice();
  execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, docxPath], {
    stdio: 'pipe',
    timeout: 120_000,
  });
  const produced = join(dir, `${basename(docxPath, '.docx')}.pdf`);
  if (!existsSync(produced)) throw new Error(`soffice produced no PDF for ${docxPath}`);
  const pdfPath = join(dir, outName);
  if (produced !== pdfPath) renameSync(produced, pdfPath);

  const pages = pdfPageCount(pdfPath);
  if (pages !== expectedPages) {
    throw new Error(
      `[pdf-fidelity] converted PDF has ${pages} page(s), expected ${expectedPages}. ` +
      `Likely a font substitution shifted line breaks past the page budget (B-7 fidelity rule) — ` +
      `check installed fonts vs the canonical Garamond and re-run.`,
    );
  }
  return { pdfPath, pages };
}
