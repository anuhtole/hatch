/**
 * lib/resume/check-format-parity.ts
 *
 * Format parity guard (joins the gate). Re-extracts the structural manifest from the
 * RENDERED .docx and asserts it conforms to the canonical CV's treatment:
 *   - page size + margins match the canonical;
 *   - header present (name line + contact line with a hyperlink);
 *   - all 4 section headings carry the canonical signature (bold + small-caps +
 *     bottom rule), derived from the canonical .docx itself (not hardcoded);
 *   - ≥1 company line (bold + right tab) and role line (italic + right tab);
 *   - bullets use the literal "● " glyph, Garamond, not a Word list;
 *   - every text run is Garamond;
 *   - estimated page count == MAX_PAGES.
 * Non-zero exit on any mismatch, with a field-level diff.
 *
 * Run: npx tsx lib/resume/check-format-parity.ts  (npm run guard:parity) — inspects
 * out/tailored-resume.docx vs the canonical vault .docx.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { join } from 'path';
import { homedir } from 'os';
import { readFileSync } from 'fs';
import { inspectDocxFile, type IDoc, type IPara } from '@/lib/resume/docx-inspect';
import { wrapLines, USABLE_TWIPS } from '@/lib/resume/line-width';
import { MAX_PAGES, PAGE_BUDGET } from '@/lib/resume/one-page';
import { resolveOutDir } from '@/lib/resume/out-dir';

const CANONICAL = join(homedir(), 'vault', 'Anatole Palmer Seychal CV.docx');
const HEADINGS = ['Education', 'Professional Experience', 'Research & Project Experience', 'Additional Information'];

export interface ParityViolation { field: string; expected: string; actual: string; }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const findHeading = (d: IDoc, name: string): IPara | undefined =>
  d.paragraphs.find((p) => norm(p.text) === norm(name));

/** Page estimate from inspected paragraphs — leading 1.0, calibrated against the
 *  canonical CV (it sums to ≈14700tw at 1.0 and is exactly one full page). */
function estimatePages(d: IDoc): { height: number; pages: number } {
  const lh = (pt: number) => Math.round(pt * 20 * 1.0);
  let h = 0;
  for (const p of d.paragraphs) {
    const size = p.runs.find((r) => r.sizePt)?.sizePt ?? 10.5;
    const lines = p.text.trim() ? wrapLines(p.text, USABLE_TWIPS).length : 1;
    h += lines * lh(size);
  }
  return { height: h, pages: Math.max(1, Math.ceil(h / (PAGE_BUDGET / MAX_PAGES))) };
}

/** B-14: what each rendered entry's header should carry (from resumeDoc, whose
 *  fields come straight from vault frontmatter — empty string = absent in vault). */
export interface EntryHeaderExpectation {
  company: string;
  location: string;
  role: string;
  dates: string;
}

export function checkFormatParity(
  rendered: IDoc,
  canonical: IDoc,
  // B-14 per-entry header-completeness: entries to assert, and a sink for
  // truthful vault-metadata gaps (action list — loud, but not a violation;
  // we never fail a run for refusing to invent a date).
  entries?: EntryHeaderExpectation[],
  actionList?: string[],
): ParityViolation[] {
  const v: ParityViolation[] = [];
  const push = (field: string, expected: unknown, actual: unknown) =>
    v.push({ field, expected: String(expected), actual: String(actual) });

  // 1. Page size + margins.
  for (const k of ['w', 'h', 'top', 'bottom', 'left', 'right'] as const) {
    if (rendered.page[k] !== canonical.page[k]) push(`page.${k}`, canonical.page[k], rendered.page[k]);
  }

  // 2. Header — name line + contact line (with a hyperlink).
  const p0 = rendered.paragraphs[0];
  const p1 = rendered.paragraphs[1];
  if (!p0 || p0.align !== 'center' || !p0.runs.some((r) => r.bold && (r.sizePt ?? 0) >= 20))
    push('header.name', 'centered bold ≥20pt run', p0 ? `align=${p0.align} runs=${p0.runs.map((r) => r.sizePt).join(',')}` : 'missing');
  if (!p1 || p1.align !== 'center' || !p1.hasHyperlink)
    push('header.contact', 'centered line with a hyperlink', p1 ? `align=${p1.align} hyperlink=${p1.hasHyperlink}` : 'missing');

  // 3. Section headings — derive the canonical signature, assert rendered matches.
  for (const name of HEADINGS) {
    const cH = findHeading(canonical, name);
    const rH = findHeading(rendered, name);
    if (!rH) { push(`heading[${name}]`, 'present', 'missing'); continue; }
    const sig = (p: IPara | undefined) => ({
      bold: !!p?.runs.some((r) => r.bold),
      smallCaps: !!p?.runs.some((r) => r.smallCaps),
      border: !!p?.borderBottom,
    });
    const c = sig(cH), r = sig(rH);
    if (r.bold !== c.bold || r.smallCaps !== c.smallCaps || r.border !== c.border)
      push(`heading[${name}].style`, `bold=${c.bold} smallCaps=${c.smallCaps} border=${c.border}`, `bold=${r.bold} smallCaps=${r.smallCaps} border=${r.border}`);
  }

  // 4. Entry layout — at least one bold company line w/ right tab, one italic role line w/ right tab.
  const rightTab = (p: IPara) => p.tabs.some((t) => t.val.toLowerCase() === 'right');
  const companyLine = rendered.paragraphs.some((p) => !p.text.startsWith('●') && p.runs.some((r) => r.bold && r.text.trim()) && rightTab(p));
  const roleLine = rendered.paragraphs.some((p) => !p.text.startsWith('●') && p.runs.some((r) => r.italic && r.text.trim()) && rightTab(p));
  if (!companyLine) push('entry.companyLine', 'bold left + right-tab location', 'none found');
  if (!roleLine) push('entry.roleLine', 'italic left + right-tab dates', 'none found');

  // 4b. B-14 per-entry HEADER COMPLETENESS — for every entry the doc claims to
  //     render: entry name bold-left (+ location bold-right when the vault has
  //     one); role italic-left + date italic-right when the vault has them.
  //     Metadata present but not rendered (or styled wrong) = VIOLATION.
  //     Metadata absent in the vault = ACTION-LIST item (truthful, not a defect).
  if (entries) {
    for (const e of entries) {
      const idx = rendered.paragraphs.findIndex(
        (p) => !p.text.startsWith('●') && p.runs.some((r) => r.bold && r.text.trim() === e.company.trim()),
      );
      if (idx === -1) {
        push(`entry[${e.company}].nameLine`, 'bold entry-name line present', 'missing');
        continue;
      }
      const nameLine = rendered.paragraphs[idx];
      // B-35: a role-less dated entry (project, e.g. Spine/Hatch) renders its date
      // italic right-tab on the NAME line (zero extra lines); a roled entry keeps the
      // location (bold) on the name line and role+date (italic) on line 2. This mirrors
      // renderEntry's `dateOnNameLine` branch — a layout-truth update, not a loosening.
      const dateOnNameLine = !e.role.trim() && !!e.dates.trim();
      if (dateOnNameLine) {
        const dateOk =
          rightTab(nameLine) &&
          nameLine.runs.some((r) => r.italic && r.text.trim() === e.dates.trim());
        if (!dateOk) push(`entry[${e.company}].dates`, `italic right-tab "${e.dates}" on name line`, nameLine.text);
        if (e.location.trim()) {
          actionList?.push(`ACTION(vault): entry "${e.company}" has a date but no role — date renders on name line; location not shown`);
        }
      } else if (e.location.trim()) {
        const locOk =
          rightTab(nameLine) &&
          nameLine.runs.some((r) => r.bold && r.text.trim() === e.location.trim());
        if (!locOk) push(`entry[${e.company}].location`, `bold right-tab "${e.location}"`, nameLine.text);
      } else {
        actionList?.push(`ACTION(vault): entry "${e.company}" has no location — name line renders left-only`);
      }
      if (e.role.trim()) {
        const roleLine = rendered.paragraphs[idx + 1];
        const roleOk = roleLine?.runs.some((r) => r.italic && r.text.trim() === e.role.trim());
        const dateOk = !e.dates.trim() || (roleLine && rightTab(roleLine) && roleLine.runs.some((r) => r.italic && r.text.trim() === e.dates.trim()));
        if (!roleOk) push(`entry[${e.company}].role`, `italic "${e.role}"`, roleLine?.text ?? 'missing line');
        if (!dateOk) push(`entry[${e.company}].dates`, `italic right-tab "${e.dates}"`, roleLine?.text ?? 'missing line');
      } else if (!dateOnNameLine) {
        actionList?.push(`ACTION(vault): entry "${e.company}" has no role/period — role line omitted`);
      }
    }
  }

  // 5. Bullets — literal "● ", Garamond, not a Word list.
  const bullets = rendered.paragraphs.filter((p) => p.text.startsWith('●'));
  if (bullets.length === 0) push('bullets', '≥1 "● " bullet', '0');
  for (const b of bullets) {
    if (b.isList) { push('bullet.isList', 'literal char (no numPr)', 'numPr present'); break; }
    if (b.runs.some((r) => r.text.trim() && r.font && r.font !== 'Garamond')) { push('bullet.font', 'Garamond', b.runs.find((r) => r.font && r.font !== 'Garamond')!.font!); break; }
  }

  // 6. Fonts — every text run Garamond.
  const badFont = rendered.paragraphs.flatMap((p) => p.runs).find((r) => r.text.trim() && r.font && r.font !== 'Garamond');
  if (badFont) push('font', 'Garamond throughout', `${badFont.font} on "${badFont.text.slice(0, 24)}"`);

  // 7. Page count.
  const { pages, height } = estimatePages(rendered);
  if (pages > MAX_PAGES) push('pageCount', `<= ${MAX_PAGES}`, `${pages} (~${height}tw vs budget ${PAGE_BUDGET})`);

  // 8. No empty styled lines — a bold/italic line with no visible text is a layout
  //    defect (e.g. an entry rendered with no role/dates). Spacers are unstyled.
  const emptyStyled = rendered.paragraphs.find(
    (p) => !p.text.replace(/\t/g, '').trim() && p.runs.some((r) => r.bold || r.italic),
  );
  if (emptyStyled) push('emptyStyledLine', 'none', `styled paragraph with no text`);

  // 9. Vertical rhythm — blank spacer paragraphs must exist between sections/entries
  //    (canonical uses ~12; require at least one per section as a floor).
  const spacers = rendered.paragraphs.filter((p) => !p.text.trim() && p.runs.length === 0).length;
  if (spacers < 4) push('spacers', '>= 4 blank spacer paragraphs', String(spacers));

  // (Tabbed role↔dates separation is asserted in the ATS guard, check-ats.ts.)

  return v;
}

// ── Runnable ────────────────────────────────────────────────────────────────────

async function main() {
  const renderedPath = join(resolveOutDir(), 'tailored-resume.docx');
  const [rendered, canonical] = await Promise.all([inspectDocxFile(renderedPath), inspectDocxFile(CANONICAL)]);
  // B-14: per-entry header expectations come from the run's tailored.json
  // (header fields there are verbatim vault frontmatter).
  let entries: EntryHeaderExpectation[] | undefined;
  try {
    const t = JSON.parse(readFileSync(join(resolveOutDir(), 'tailored.json'), 'utf-8'));
    const doc = t.resumeDoc as { experience: EntryHeaderExpectation[]; projects: EntryHeaderExpectation[] };
    entries = [...doc.experience, ...doc.projects];
  } catch { /* legacy out dir without tailored.json — skeleton asserts skipped */ }
  const actionList: string[] = [];
  const violations = checkFormatParity(rendered, canonical, entries, actionList);
  console.log('=== FORMAT PARITY GUARD ===');
  console.log(`  rendered: ${renderedPath}`);
  console.log(`  canonical: ${CANONICAL}`);
  console.log(`  violations: ${violations.length}`);
  for (const x of violations) console.log(`    ✗ [${x.field}] expected ${x.expected} · got ${x.actual}`);
  for (const a of actionList) console.log(`    ⚠ ${a}`);
  if (violations.length) { console.log('[check-format-parity] RESULT: MISMATCH'); process.exit(2); }
  console.log('[check-format-parity] RESULT: PARITY ✓');
}

if (process.argv[1] && process.argv[1].includes('check-format-parity')) main().catch((e) => { console.error(e); process.exit(1); });
