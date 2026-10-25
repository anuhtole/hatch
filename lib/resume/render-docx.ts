/**
 * lib/resume/render-docx.ts
 *
 * Phase 2 of the vault-grounded resume builder: a pure renderer that turns a
 * structured ResumeDoc into a .docx reproducing the canonical format EXACTLY
 * (see ~/hatch/resume-format-spec.md, extracted in Phase 1).
 *
 * This phase is render-only — NO generation/tailoring logic, and it is NOT
 * wired into the retired career-ops flows / the live
 * pipeline. It only maps data → document.
 *
 * Canonical facts reproduced (from the spec):
 *   - US Letter (12240 x 15840 twips), single column, no tables.
 *   - Margins: top 0.5" (720), bottom 0.4" (576), left 0.5" (720), right 0.5" (720).
 *   - Garamond throughout. Sizes (docx half-points): name 28pt→56, contact 11pt→22,
 *     section headings ~12pt→24, body 10.5pt→21.
 *   - Name + contact: centered, stacked; contact joined with " | " on one line.
 *   - Section headings: bold Title-Case runs (plain bold, NOT Word Heading styles).
 *   - Entry line 1: company + RIGHT-tabbed location (uniformly BOLD).
 *     Entry line 2: role + RIGHT-tabbed dates (uniformly ITALIC).
 *   - Education line 1: school BOLD + RIGHT-tabbed right-part REGULAR (mixed, per canonical).
 *   - Right-alignment via a RIGHT tab stop at 7.5" (10800 twips) + a literal Tab — no tables.
 *   - Bullets: literal "● " (U+25CF + space) text runs, no numbering, no indent.
 *   - Vertical rhythm via blank spacer paragraphs; no space-before/after on content paras.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Tab,
  TabStopType,
  AlignmentType,
  PageOrientation,
  ExternalHyperlink,
  BorderStyle,
} from 'docx';

// ── Canonical measurements ────────────────────────────────────────────────────

const FONT = 'Garamond';

// docx font sizes are half-points.
const SIZE_NAME = 56;    // 28 pt
const SIZE_CONTACT = 22; // 11 pt
const SIZE_HEADING = 24; // ~12 pt
const SIZE_BODY = 21;    // 10.5 pt
const SIZE_SPACER = 6;   // 3 pt — canonical vertical-rhythm spacer mark height (B-22)

// Twips (1" = 1440).
const PAGE = { width: 12240, height: 15840 }; // 8.5" x 11"
const MARGIN = { top: 720, bottom: 576, left: 720, right: 720 }; // 0.5 / 0.4 / 0.5 / 0.5 in
const RIGHT_TAB = 10800; // 7.5"

const BULLET = '● '; // U+25CF BLACK CIRCLE + space, emitted as literal text

// ── Data model ────────────────────────────────────────────────────────────────

export interface EducationEntry {
  school: string;       // bold, left
  right?: string;       // right-tabbed (e.g. "Expected Graduation: May 2027") — regular
  degrees?: string;     // regular line under the school
  coursework?: string;  // value after a bold "Relevant Coursework:" label
}

export interface Entry {
  company: string;      // bold, left
  location: string;     // right-tabbed (bold, same run formatting as company)
  role: string;         // italic, left
  dates: string;        // right-tabbed (italic, same run formatting as role)
  bullets: string[];    // each rendered as "● <text>"
}

export interface ResumeDoc {
  header: { name: string; contact: string[] }; // contact joined with " | "
  education: EducationEntry[];
  experience: Entry[];
  projects: Entry[];
  additional: { skillsAndLanguages?: string; interests?: string };
}

// ── Run / paragraph helpers ───────────────────────────────────────────────────

function run(
  text: string,
  opts: { bold?: boolean; italics?: boolean; size?: number; smallCaps?: boolean } = {},
): TextRun {
  return new TextRun({
    text,
    font: FONT,
    size: opts.size ?? SIZE_BODY,
    bold: opts.bold,
    italics: opts.italics,
    smallCaps: opts.smallCaps,
  });
}

/**
 * Blank vertical-rhythm spacer — the canonical's mechanism. B-22: the canonical CV's
 * spacer paragraphs carry a 3pt mark (w:sz=6), NOT a full-height empty line. An empty
 * `new Paragraph({})` renders at Word's default mark height (~10pt), which is the ONLY
 * setting where the render was looser than the parity reference. Match the canonical's
 * 3pt spacer (tighter) so the render reaches canonical vertical density. Content text is
 * unchanged (the run is empty), so extraction/parity/provenance are unaffected. */
function spacer(): Paragraph {
  // A 3pt mark with NO font — matching the canonical CV's spacer runs. The parity
  // guard / docx-inspect filter out fontless empty runs, so this still reads back as
  // a true blank spacer (runs.length 0), while Word renders it at the canonical 3pt.
  return new Paragraph({ children: [new TextRun({ size: SIZE_SPACER })] });
}

/** Centered single-run paragraph (name / contact). */
function centered(textRun: TextRun): Paragraph {
  return new Paragraph({ alignment: AlignmentType.CENTER, children: [textRun] });
}

/**
 * Section heading — canonical treatment: bold + SMALL-CAPS at the doc-default size
 * (12 pt → 24 half-pts) with a thin bottom rule (single, sz=4 → 0.5 pt), matching
 * the canonical CV's EDUCATION / PROFESSIONAL EXPERIENCE … look.
 */
function heading(text: string): Paragraph {
  return new Paragraph({
    children: [run(text, { bold: true, smallCaps: true, size: SIZE_HEADING })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 1, color: 'auto' } },
  });
}

/**
 * A line with left content and right content separated by a RIGHT tab stop at
 * 7.5" plus a literal Tab — the canonical right-alignment mechanism (no tables,
 * no paragraph right-align).
 */
function tabbedLine(leftRuns: TextRun[], rightRuns: TextRun[]): Paragraph {
  // Omit the tab entirely when there is no right-side content — a dangling tab
  // renders invisibly but pollutes text extraction (ATS) and the parity manifest.
  const children = rightRuns.length
    ? [...leftRuns, new TextRun({ children: [new Tab()] }), ...rightRuns]
    : [...leftRuns];
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
    children,
  });
}

/** Bullet paragraph: literal "● <text>", no numbering, no indent, single spacing.
 *  B-22: widow/orphan control on so a wrapped bullet never strands a single line. */
function bullet(text: string): Paragraph {
  return new Paragraph({ widowControl: true, children: [run(`${BULLET}${text}`)] });
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderEducation(ed: EducationEntry): Paragraph[] {
  const out: Paragraph[] = [];
  // Line 1: school BOLD + right-tabbed right-part REGULAR (mixed, per canonical).
  out.push(
    tabbedLine(
      [run(ed.school, { bold: true })],
      ed.right ? [run(ed.right)] : [],
    ),
  );
  if (ed.degrees) out.push(new Paragraph({ widowControl: true, children: [run(ed.degrees)] }));
  if (ed.coursework) {
    out.push(
      new Paragraph({
        widowControl: true,
        children: [run('Relevant Coursework: ', { bold: true }), run(ed.coursework)],
      }),
    );
  }
  return out;
}

function renderEntry(e: Entry): Paragraph[] {
  const out: Paragraph[] = [];
  // B-35: a dated entry with NO role (a project, e.g. Spine/Hatch) renders its date
  // right-tabbed on the NAME line — zero extra vertical lines. This fixes the B-34
  // overflow where a role-less project emitted a near-empty second line solely to
  // carry the right-tabbed date. Entries WITH a role (experience) are unchanged:
  // name+location on line 1, role+date on line 2. We never invent a date; a dateless
  // project still renders the name line only.
  const dateOnNameLine = !e.role && !!e.dates;
  // Line 1: company (bold, left) + right-tabbed right-part. Right side is the italic
  // date for a role-less dated project, otherwise the bold location, as before.
  out.push(
    tabbedLine(
      [run(e.company, { bold: true })],
      dateOnNameLine
        ? [run(e.dates, { italics: true })]
        : e.location ? [run(e.location, { bold: true })] : [],
    ),
  );
  // Line 2: role + dates, uniformly ITALIC — emitted only when a role exists (a
  // role-less project's date already rode the name line above). Skipped for a bare
  // project; an empty styled line is a format-parity defect, and we never invent dates.
  if (e.role) {
    out.push(
      tabbedLine(
        [run(e.role, { italics: true })],
        e.dates ? [run(e.dates, { italics: true })] : [],
      ),
    );
  }
  for (const b of e.bullets) out.push(bullet(b));
  return out;
}

/** Interleave entries with a single spacer paragraph between them. */
function joinWithSpacers(blocks: Paragraph[][]): Paragraph[] {
  const out: Paragraph[] = [];
  blocks.forEach((block, i) => {
    if (i > 0) out.push(spacer());
    out.push(...block);
  });
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Layout-only tweaks for the visual-QA remediation loop (B-7). They add/remove ONLY
 *  blank spacer paragraphs — never text content — so extracted content text is
 *  byte-identical across remediation iterations (asserted by the loop). */
export interface LayoutTweaks {
  /** Extra blank spacers inserted before each section heading after Education
   *  (distributes dead bottom whitespace across the section gaps). 0–2. */
  sectionSpacerExtra?: number;
}

/**
 * Render a ResumeDoc to a .docx Buffer in the exact canonical format.
 * Pure — no I/O, no tailoring. Section order:
 *   Name → Contact → Education → Professional Experience →
 *   Research & Project Experience → Additional Information.
 */
export async function renderResumeDocx(doc: ResumeDoc, tweaks: LayoutTweaks = {}): Promise<Buffer> {
  const children: Paragraph[] = [];
  const extra = Math.max(0, Math.min(2, tweaks.sectionSpacerExtra ?? 0));
  const sectionGap = (): void => {
    children.push(spacer());
    for (let i = 0; i < extra; i++) children.push(spacer());
  };

  // Header: name + contact, centered & stacked. Name is 28 pt bold; the contact line
  // is pipe-joined Garamond 11 pt with the email rendered as a mailto hyperlink (per
  // the canonical). Grounded content only — the model never touches the header.
  children.push(centered(run(doc.header.name, { bold: true, size: SIZE_NAME })));
  const contactChildren: (TextRun | ExternalHyperlink)[] = [];
  doc.header.contact.forEach((seg, i) => {
    if (i > 0) contactChildren.push(run(' | ', { size: SIZE_CONTACT }));
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(seg)) {
      contactChildren.push(
        new ExternalHyperlink({ link: `mailto:${seg}`, children: [run(seg, { size: SIZE_CONTACT })] }),
      );
    } else {
      contactChildren.push(run(seg, { size: SIZE_CONTACT }));
    }
  });
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: contactChildren }));

  // Education
  children.push(spacer());
  children.push(heading('Education'));
  children.push(spacer());
  children.push(...joinWithSpacers(doc.education.map(renderEducation)));

  // Professional Experience
  sectionGap();
  children.push(heading('Professional Experience'));
  children.push(spacer());
  children.push(...joinWithSpacers(doc.experience.map(renderEntry)));

  // Research & Project Experience
  sectionGap();
  children.push(heading('Research & Project Experience'));
  children.push(spacer());
  children.push(...joinWithSpacers(doc.projects.map(renderEntry)));

  // Additional Information (heading directly followed by the lines, per canonical)
  sectionGap();
  children.push(heading('Additional Information'));
  if (doc.additional.skillsAndLanguages) {
    children.push(
      new Paragraph({
        widowControl: true,
        children: [run('Skills & Languages: ', { bold: true }), run(doc.additional.skillsAndLanguages)],
      }),
    );
  }
  if (doc.additional.interests) {
    children.push(
      new Paragraph({
        widowControl: true,
        children: [run('Interests: ', { bold: true }), run(doc.additional.interests)],
      }),
    );
  }

  const document = new Document({
    creator: 'Hatch Resume Builder',
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height, orientation: PageOrientation.PORTRAIT },
            margin: MARGIN,
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
