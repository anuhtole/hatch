/**
 * lib/resume/check-visual.ts
 *
 * Visual QA gate (B-7). Converts the rendered .docx to a page PNG (+ raster PDF),
 * sends the PNG to the model (vision) with a strict findings-only rubric, and runs
 * a deterministic LAYOUT-ONLY remediation loop (≤3 iterations).
 *
 * Conversion (B-14 part 3): the gate judges a FAITHFUL render of the SHIPPED PDF
 * — docx → PDF via Microsoft WORD (the rendering authority that authored the
 * canonical one-page CV; LibreOffice paginates ~half a page looser and renders
 * even the canonical CV as two pages), then raster the Word PDF page via Quick
 * Look (`qlmanage -t` on the PDF rasterizes the already-laid-out page — no font
 * re-substitution). The genuine Monotype Garamond is installed as the "Garamond"
 * family (scripts/install-garamond.sh), so the page the vision model sees is
 * byte-for-byte what a recruiter opens. A one-page assert still fails loudly if
 * the Word PDF is not a single page.
 *
 * TRUST: the vision call returns ONLY structured findings {issue, location,
 * severity} — no rewrite suggestions; no text content flows from the model into
 * any render input. Remediation maps finding types to LayoutTweaks (blank-spacer
 * placement ONLY); extracted content text is asserted byte-identical across
 * iterations, else the gate FAILS.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
import { inspectDocxBuffer } from '@/lib/resume/docx-inspect';
import { structuredCreate } from '@/lib/resume/structured';
import type { LayoutTweaks } from '@/lib/resume/render-docx';
import { resolveOutDir } from '@/lib/resume/out-dir';
import { convertDocxToPdfViaWord } from '@/lib/resume/word-pdf';
import { MAX_PAGES } from '@/lib/resume/one-page';



// ── Conversion ──────────────────────────────────────────────────────────────────

export interface VisualArtifacts { pngPath: string; pdfPath: string }

/**
 * docx → FAITHFUL page PNG (B-14 part 3). Word lays out the docx into the real
 * shipped PDF (the rendering authority; genuine Monotype Garamond, exact tab
 * columns), then Quick Look rasterizes that PDF page (fixed layout → no font
 * re-substitution). The PNG keeps the legacy `<docx>.png` name so the
 * artifact-card preview path is unchanged. Asserts the Word PDF is one page.
 */
export function convertDocx(docxPath: string, outBase?: string): VisualArtifacts {
  const visualDir = join(outBase ?? resolveOutDir(), 'visual');
  mkdirSync(visualDir, { recursive: true });

  // 1. docx → PDF via WORD (the shipped-artifact engine), into the visual dir.
  const { pdfPath, pages } = convertDocxToPdfViaWord(docxPath, `${basename(docxPath, '.docx')}.pdf`);
  // The Word PDF lands next to the docx; move it into the visual dir.
  const visualPdf = join(visualDir, `${basename(docxPath, '.docx')}.pdf`);
  if (pdfPath !== visualPdf) renameSync(pdfPath, visualPdf);
  if (pages !== MAX_PAGES) {
    throw new Error(
      `[visual-fidelity] Word PDF has ${pages} page(s), expected ${MAX_PAGES} — the roster fit ` +
      `should have reduced it to one page; investigate before shipping.`,
    );
  }

  // 2. Word PDF page → PNG (Quick Look rasterizes the baked layout; no substitution).
  execFileSync('qlmanage', ['-t', '-s', '1700', '-o', visualDir, visualPdf], { stdio: 'pipe' });
  const qlPng = join(visualDir, `${basename(visualPdf)}.png`); // <docx>.pdf.png
  if (!existsSync(qlPng)) throw new Error(`qlmanage produced no thumbnail at ${qlPng}`);
  const pngPath = join(visualDir, `${basename(docxPath)}.png`); // legacy <docx>.docx.png
  if (qlPng !== pngPath) renameSync(qlPng, pngPath);

  return { pngPath, pdfPath: visualPdf };
}

// ── Vision findings ─────────────────────────────────────────────────────────────

export type Severity = 'high' | 'medium' | 'low';
export interface VisualFinding { issue: string; location: string; severity: Severity }

const FINDINGS_TOOL: Anthropic.Tool = {
  name: 'submit_findings',
  description: 'Report visual layout findings. Findings ONLY — never rewrite or suggest text.',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            issue: { type: 'string', description: 'what is visually wrong (layout terms only)' },
            location: { type: 'string', description: 'where on the page' },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['issue', 'location', 'severity'],
        },
      },
    },
    required: ['findings'],
  },
};

export async function checkVisual(pngPath: string): Promise<VisualFinding[]> {
  const png = readFileSync(pngPath).toString('base64');
  const prompt =
    `You are a layout QA reviewer for a one-page résumé image. Report ONLY visual/layout findings — ` +
    `never comment on, quote, or suggest text content.\n\n` +
    `Rubric (look for): widows/orphans (a lone short line dangling); uneven inter-entry spacing; ` +
    `crowding (text touching margins, inconsistent line spacing); dead whitespace blocks (a large empty ` +
    `region, especially mid-page); heading/rule irregularities (missing or doubled rules, inconsistent ` +
    `heading style); CONTENT CUT OFF at a page edge; overlapping text; anything a recruiter would notice ` +
    `in 5 seconds.\n\n` +
    `Severity calibration:\n` +
    `- high   = unambiguous defect: text actually TRUNCATED/CLIPPED (cut glyphs or a sentence that ends ` +
    `mid-word at an edge), overlapping text, a glaring dead block (> ~15% of the page mid-content), ` +
    `wildly uneven section spacing. NOTE: this résumé style intentionally fills the page with a small ` +
    `(0.4") bottom margin — content EXTENDING NEAR the bottom is the authored design, NOT high; only ` +
    `actual truncation is high.\n` +
    `- medium = noticeable but not disqualifying.\n` +
    `- low    = minor/cosmetic.\n\n` +
    `THIS IMAGE IS A FAITHFUL RASTER OF THE EXPORTED PDF — the exact page a recruiter opens (real ` +
    `fonts, exact right-tab columns). Judge it as final: column alignment and line breaks are accurate, ` +
    `not approximations. Empty space at the very bottom below the last section is NORMAL for a one-page ` +
    `résumé — only flag bottom whitespace if it exceeds roughly a third of the page.\n\n` +
    `If the page is clean, return an empty findings array.`;

  const out = await structuredCreate<{ findings?: VisualFinding[] }>({
    stage: 'visual-findings',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 4096,
    prompt: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
      { type: 'text', text: prompt },
    ],
    schema: FINDINGS_TOOL.input_schema as Record<string, unknown>,
  });
  // A null here would FALSE-PASS the visual gate (zero findings) — fail instead.
  if (!out) throw new Error('visual-findings: structured output failed (see WARN above)');
  return (out.findings ?? []).filter(
    (f) => f && f.issue && (f.severity === 'high' || f.severity === 'medium' || f.severity === 'low'),
  );
}

// ── Deterministic remediation map (layout-only) ─────────────────────────────────

/**
 * Map findings to LayoutTweaks adjustments. ONLY blank-spacer placement changes —
 * content order/text never changes. Returns null when no mapped fix exists for the
 * remaining high findings (the loop then stops and the gate decides).
 */
export function remediate(findings: VisualFinding[], current: LayoutTweaks): LayoutTweaks | null {
  const high = findings.filter((f) => f.severity === 'high');
  const cur = current.sectionSpacerExtra ?? 0;
  const mentions = (re: RegExp) => high.some((f) => re.test(`${f.issue} ${f.location}`.toLowerCase()));

  // Dead whitespace mid/bottom → distribute it across section gaps (add spacers).
  if (mentions(/dead\s*whitespace|empty (region|block|space)/) && cur < 2) {
    return { ...current, sectionSpacerExtra: cur + 1 };
  }
  // Crowding / cut-off after we ADDED spacers → back them out.
  if (mentions(/cut\s*off|crowd|overlap|margin/) && cur > 0) {
    return { ...current, sectionSpacerExtra: cur - 1 };
  }
  return null; // no layout-only lever for these findings
}

/** Content text of a docx (non-empty trimmed paragraph texts, in order) — the
 *  text-immutability invariant for the remediation loop. */
export async function contentText(buf: Buffer): Promise<string> {
  const d = await inspectDocxBuffer(buf);
  return d.paragraphs.map((p) => p.text.replace(/\t/g, ' ').trim()).filter(Boolean).join('\n');
}

// ── Standalone runner (single-shot findings on the current tailored docx) ───────

async function main() {
  const docx = join(resolveOutDir(), 'tailored-resume.docx');
  const { pngPath, pdfPath } = convertDocx(docx);
  const findings = await checkVisual(pngPath);
  console.log('=== VISUAL QA GUARD ===');
  console.log(`  png: ${pngPath}`);
  console.log(`  pdf: ${pdfPath} (raster)`);
  console.log(`  findings: ${findings.length}`);
  for (const f of findings) console.log(`    ${f.severity === 'high' ? '✗' : '⚠'} [${f.severity}] ${f.issue} @ ${f.location}`);
  const high = findings.filter((f) => f.severity === 'high').length;
  if (high > 0) { console.log(`[check-visual] RESULT: ${high} HIGH finding(s)`); process.exit(2); }
  console.log('[check-visual] RESULT: VISUAL-CLEAN ✓ (0 high)');
}

if (process.argv[1] && process.argv[1].includes('check-visual')) main().catch((e) => { console.error(e); process.exit(1); });
