/**
 * lib/resume/check-ats.ts
 *
 * ATS structural-parseability guard (B-6, joins the gate). Asserts on the RENDERED
 * .docx, via the same docx-inspect parser as the parity guard:
 *   1. the 4 standard section headings are present and in visual order;
 *   2. no content lives in tables / text boxes / drawings (single-column flow);
 *   3. the contact line parses: email, phone, and a linkedin path;
 *   4. tabbed separation — every role line extracts as "role\tdates" (never fused
 *      "InternSummer 2025"), and every experience role line has a non-empty date;
 *   5. text-extraction order is sane: contact precedes Education, sections ascend.
 * Non-zero exit on any violation. Run: npm run guard:ats
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import JSZip from 'jszip';
import { inspectDocxBuffer, type IDoc } from '@/lib/resume/docx-inspect';
import { resolveOutDir } from '@/lib/resume/out-dir';

const HEADINGS = ['Education', 'Professional Experience', 'Research & Project Experience', 'Additional Information'];

export interface AtsViolation { check: string; detail: string; }

export async function checkAts(buf: Buffer): Promise<AtsViolation[]> {
  const v: AtsViolation[] = [];
  const doc: IDoc = await inspectDocxBuffer(buf);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const idx = HEADINGS.map((h) => doc.paragraphs.findIndex((p) => norm(p.text) === norm(h)));

  // 1+5. headings present, monotonic, contact precedes the first section.
  HEADINGS.forEach((h, i) => {
    if (idx[i] === -1) v.push({ check: 'heading-present', detail: `"${h}" missing` });
  });
  if (idx.every((i) => i >= 0) && !idx.every((x, i) => i === 0 || x > idx[i - 1])) {
    v.push({ check: 'heading-order', detail: `non-monotonic: ${idx.join(', ')}` });
  }
  const contactIdx = doc.paragraphs.findIndex((p) => /@/.test(p.text));
  if (contactIdx === -1 || (idx[0] >= 0 && contactIdx > idx[0])) {
    v.push({ check: 'extraction-order', detail: `contact line at ${contactIdx}, Education at ${idx[0]}` });
  }

  // 2. no tables / text boxes / images.
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  if (/<w:tbl>/.test(xml)) v.push({ check: 'no-tables', detail: 'w:tbl found' });
  if (/txbxContent/.test(xml)) v.push({ check: 'no-textboxes', detail: 'txbxContent found' });
  if (/<w:drawing>/.test(xml)) v.push({ check: 'no-drawings', detail: 'w:drawing found' });

  // 3. contact parses.
  const text = doc.paragraphs.map((p) => p.text).join('\n');
  if (!/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) v.push({ check: 'contact-email', detail: 'no email found' });
  if (!/\(\d{3}\)\s*\d{3}-\d{4}/.test(text)) v.push({ check: 'contact-phone', detail: 'no (XXX) XXX-XXXX phone found' });
  if (!/linkedin\.com\/in\//.test(text)) v.push({ check: 'contact-linkedin', detail: 'no linkedin.com/in/ found' });

  // 4. role lines: italic left + tab + non-empty right (dates) — never fused.
  const expStart = idx[1]; // Professional Experience
  const expEnd = idx[2] >= 0 ? idx[2] : doc.paragraphs.length; // until Research & Project
  doc.paragraphs.forEach((p, i) => {
    const isRoleLine = p.runs.some((r) => r.italic && r.text.trim()) && !p.text.startsWith('●');
    if (!isRoleLine) return;
    if (!p.text.includes('\t')) {
      v.push({ check: 'role-date-separation', detail: `no tab separator: "${p.text.slice(0, 50)}"` });
    } else if (i > expStart && i < expEnd) {
      const right = p.text.split('\t').pop()?.trim();
      if (!right) v.push({ check: 'experience-date', detail: `empty date on "${p.text.slice(0, 50)}"` });
    }
  });

  return v;
}

// ── Runnable ────────────────────────────────────────────────────────────────────

async function main() {
  const path = join(resolveOutDir(), 'tailored-resume.docx');
  const violations = await checkAts(readFileSync(path));
  console.log('=== ATS GUARD ===');
  console.log(`  docx: ${path}`);
  console.log(`  violations: ${violations.length}`);
  for (const x of violations) console.log(`    ✗ [${x.check}] ${x.detail}`);
  if (violations.length) { console.log('[check-ats] RESULT: FAIL'); process.exit(2); }
  console.log('[check-ats] RESULT: ATS-CLEAN ✓');
}

if (process.argv[1] && process.argv[1].includes('check-ats')) main().catch((e) => { console.error(e); process.exit(1); });
