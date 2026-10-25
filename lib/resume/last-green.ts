/**
 * lib/resume/last-green.ts — the green-run artifact record (B-10/B-11).
 *
 * run-pipeline writes this ONLY after every stage and guard passed; everything
 * that hands artifacts onward (outreach attachments, the resume_artifact chat
 * tool, Resume Studio) reads it through loadLastGreen(), which re-verifies the
 * on-disk hashes — a stale or tampered artifact loud-fails here.
 *
 * Deliberately light (fs + crypto only): importable from the chat route without
 * pulling any content-producing resume module (containment assert E).
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { outDirFor } from '@/lib/resume/out-dir';

export interface LastGreen {
  docxPath: string;
  sha256: string;
  pdfPath?: string;     // B-11: text PDF rendered from the same green docx
  pdfSha256?: string;
  coverLetterPath: string;
  completedAt: string;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function lastGreenPath(target: string): string {
  return join(outDirFor(target), 'last-green.json');
}

export function writeLastGreen(target: string, lg: LastGreen): void {
  writeFileSync(lastGreenPath(target), JSON.stringify(lg, null, 2));
}

/** Typed artifact card payload (B-13). Built ONLY from a re-verified last-green
 *  record; every URL points at /api/resume/artifact (which re-verifies again on
 *  fetch). Display-only — carries no resume content. */
export interface ArtifactPayload {
  target: string;
  completedAt: string;
  sha256: string;        // green docx hash (re-verified at build time)
  pdfSha256?: string;
  previewPngUrl?: string; // first-page PNG from the visual gate, when present
  pdfUrl?: string;
  docxUrl: string;
  coverLetterUrl: string;
  gapReportUrl: string;
  studioUrl: string;     // deep link to the full Resume Studio
}

/** Build the artifact card payload for a target. Calls loadLastGreen (hash
 *  re-verification) — throws loudly rather than describing a stale artifact. */
export function buildArtifactPayload(target: string): ArtifactPayload {
  const lg = loadLastGreen(target);
  const base = `/api/resume/artifact/${target}`;
  const visualPng = join(outDirFor(target), 'visual', 'tailored-resume.docx.png');
  return {
    target,
    completedAt: lg.completedAt,
    sha256: lg.sha256,
    pdfSha256: lg.pdfSha256,
    previewPngUrl: existsSync(visualPng) ? `${base}/visual/tailored-resume.docx.png` : undefined,
    pdfUrl: lg.pdfPath ? `${base}/resume.pdf` : undefined,
    docxUrl: `${base}/tailored-resume.docx`,
    coverLetterUrl: `${base}/cover-letter.docx`,
    gapReportUrl: `${base}/gap-report.json`,
    studioUrl: `/resume?target=${encodeURIComponent(target)}`,
  };
}

/** Load + RE-VERIFY the last green run for a target. Throws loudly on any
 *  missing file or hash mismatch — never hands out an unverified artifact. */
export function loadLastGreen(target: string): LastGreen {
  const p = lastGreenPath(target);
  if (!existsSync(p)) {
    throw new Error(`no last-green.json for target "${target}" — run the pipeline to a green finish first (npm run resume:e2e -- --target=${target})`);
  }
  const lg = JSON.parse(readFileSync(p, 'utf-8')) as LastGreen;
  if (!existsSync(lg.docxPath)) throw new Error(`last-green docx missing on disk: ${lg.docxPath}`);
  const actual = sha256File(lg.docxPath);
  if (actual !== lg.sha256) {
    throw new Error(`last-green docx hash mismatch for "${target}": file=${actual.slice(0, 12)}… recorded=${lg.sha256.slice(0, 12)}… — re-run the pipeline`);
  }
  if (lg.pdfPath) {
    if (!existsSync(lg.pdfPath)) throw new Error(`last-green pdf missing on disk: ${lg.pdfPath}`);
    const pdfActual = sha256File(lg.pdfPath);
    if (pdfActual !== lg.pdfSha256) {
      throw new Error(`last-green pdf hash mismatch for "${target}": file=${pdfActual.slice(0, 12)}… recorded=${(lg.pdfSha256 ?? '').slice(0, 12)}… — re-run the pipeline`);
    }
  }
  return lg;
}
