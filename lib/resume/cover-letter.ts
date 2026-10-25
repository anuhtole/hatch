/**
 * lib/resume/cover-letter.ts
 *
 * Grounded cover-letter generation with PER-SENTENCE provenance. Each factual
 * sentence cites the tailored résumé bullet(s) it derives from (mirroring the
 * résumé's per-bullet provenance); connective sentences carry no sourceIds and
 * must contain no specifics. The letter introduces NO named tool, technique,
 * metric, qualifier, or accomplishment that isn't in its cited bullets — guarded
 * downstream by lib/resume/check-cover-letter.ts (drift) + the numeric guard here.
 *
 * Format: no canonical cover-letter template exists in the vault (checked
 * 03-professional/resume/), so this uses a clean business-letter layout reusing
 * the résumé's Garamond + canonical centered contact header (letterhead/identity,
 * excluded from the body guards).
 *
 * Additive only — does not touch the retired career-ops module.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageOrientation,
} from 'docx';
import { ROUTES } from '@/lib/models';
import { structuredCreate } from '@/lib/resume/structured';
import type { TailoredResume, TailoredBullet } from '@/lib/resume/tailor';
import { loadContact, contactSegments } from '@/lib/resume/contact';

// ── Canonical letterhead (identity, mirrors the résumé header) ──────────────────
// Grounded from the vault contact section; falls back to RESUME_NAME /
// RESUME_CONTACT ("City, ST | phone | email | linkedin") env vars. Never model-written.
const GROUNDED_CONTACT = loadContact();
const NAME = GROUNDED_CONTACT?.name ?? process.env.RESUME_NAME ?? 'Your Name';
const CONTACT = GROUNDED_CONTACT
  ? contactSegments(GROUNDED_CONTACT)
  : (process.env.RESUME_CONTACT ?? 'City, ST | (000) 000-0000 | you@example.com | linkedin.com/in/you')
      .split('|').map((s) => s.trim()).filter(Boolean);

// docx half-points / twips.
const FONT = 'Garamond';
const SIZE_NAME = 32;     // 16 pt
const SIZE_CONTACT = 22;  // 11 pt
const SIZE_BODY = 23;     // 11.5 pt
const PAGE = { width: 12240, height: 15840 }; // Letter
const MARGIN = { top: 1440, bottom: 1440, left: 1440, right: 1440 }; // 1" business-letter margins

// ── Types ────────────────────────────────────────────────────────────────────

export interface CoverSentence {
  text: string;
  sourceIds: string[]; // tailored bullet ids this sentence derives from ([] = connective)
}

export interface CoverLetter {
  docxPath: string;
  greeting: string;
  sentences: CoverSentence[];    // flat, per-sentence provenance (the body)
  text: string;                  // full assembled letter text
  provenance: TailoredBullet[];  // résumé bullets the letter is grounded in
}

// ── Numeric guard (kept) ────────────────────────────────────────────────────────

function numericCores(s: string): string[] {
  return [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));
}

export interface CoverLetterNumberCheck {
  bodyNumbers: string[];
  violations: string[];
}

/** Every numeric token in the letter body must appear in the résumé bullets. */
export function checkCoverLetterNumbers(bodyText: string, provenance: TailoredBullet[]): CoverLetterNumberCheck {
  const allowed = new Set(numericCores(provenance.map((p) => p.text).join(' ')));
  const bodyNumbers = numericCores(bodyText);
  return { bodyNumbers, violations: bodyNumbers.filter((n) => !allowed.has(n)) };
}

// ── Model: write the body with per-sentence provenance ─────────────────────────

const LETTER_TOOL: Anthropic.Tool = {
  name: 'submit_cover_letter',
  description: 'Return the greeting and body paragraphs as per-sentence units with cited bullet ids.',
  input_schema: {
    type: 'object',
    properties: {
      greeting: { type: 'string', description: 'e.g. "Dear Anthropic Hiring Team,"' },
      paragraphs: {
        type: 'array',
        description: '3 paragraphs; each is an ordered list of sentences with their cited bullet ids.',
        items: {
          type: 'object',
          properties: {
            sentences: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  sourceIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'tailored bullet ids this sentence derives from; [] for connective sentences',
                  },
                },
                required: ['text', 'sourceIds'],
              },
            },
          },
          required: ['sentences'],
        },
      },
    },
    required: ['greeting', 'paragraphs'],
  },
};

interface RawPara { sentences?: Array<{ text?: string; sourceIds?: string[] }> }

async function writeBody(
  tailored: TailoredResume,
  jdText: string,
): Promise<{ greeting: string; paragraphs: CoverSentence[][] }> {
  const bullets = tailored.provenance.map((p) => `[${p.sourceId}] ${p.text}`).join('\n');
  const validIds = new Set(tailored.provenance.map((p) => p.sourceId));

  const prompt =
    `Write a cover letter for the job below, as structured sentences with per-sentence provenance. ` +
    `The candidate's RÉSUMÉ BULLETS (each with an id) are the ONLY source of facts.\n\n` +
    `HARD RULES (this is an anti-fabrication task — violations are rejected):\n` +
    `1. Every FACTUAL sentence (one that states an accomplishment, skill, metric, tool, or experience) ` +
    `must set sourceIds to the bullet id(s) it derives from, and EVERY specific in it — named tool, ` +
    `technique, qualifier, number, proper noun — must appear in those exact cited bullets.\n` +
    `2. Use the bullets' OWN wording for technical terms. Do NOT add descriptors not in the cited bullet ` +
    `(e.g. don't write "fine-tuned"/"prompt-tuned"/"agentic" unless that word is in the cited bullet). Do ` +
    `NOT reframe a metric as an eval/measurement method unless the bullet says so. Do NOT mirror the job ` +
    `description's phrasing as a past accomplishment.\n` +
    `3. Do NOT combine specifics from different bullets into one claim that implies a relationship none of ` +
    `them states (no cross-bullet conflation). If a sentence cites two bullets, each specific must come ` +
    `from one of them and the sentence must not invent a link between them.\n` +
    `4. CONNECTIVE sentences (transitions, motivation, interest in the role) must have sourceIds: [] and ` +
    `contain NO specific tool, metric, number, OR domain/technical term — e.g. NEVER use words like ` +
    `"agentic", "eval", "evals", "LLM", "multi-agent", "fine-tuned", "pipeline", "orchestration" in a ` +
    `connective sentence. Keep them plain and about motivation/fit ("hands-on building experience", ` +
    `"product thinking"). If you want to assert a capability, make it a FACTUAL sentence with sourceIds ` +
    `instead. They MAY name the target company/role (Anthropic, Claude Code).\n` +
    `5. Numbers: only those already in the cited bullets; prefer to omit. Never invent a number or date.\n` +
    `6. Do NOT coin a compound company+domain name (e.g. "Anthropic's API team", "Anthropic's eval ` +
    `suite"). Refer to the company plainly ("Anthropic", "the team", "your team") unless that exact ` +
    `phrase appears in the job description.\n\n` +
    `Structure: greeting + 3 paragraphs. Confident, specific, concise. Each paragraph is an ordered list ` +
    `of sentences.\n\n` +
    `=== JOB DESCRIPTION ===\n${jdText}\n\n` +
    `=== RÉSUMÉ BULLETS ([id] text — the only facts you may use) ===\n${bullets}\n`;

  const out = await structuredCreate<{ greeting?: string; paragraphs?: RawPara[] }>({
    stage: 'cover-letter',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8192,
    prompt,
    schema: LETTER_TOOL.input_schema as Record<string, unknown>,
  });
  // An empty letter would trivially pass the per-sentence guards — fail instead.
  if (!out) throw new Error('cover-letter: structured output failed (see WARN above)');

  const paragraphs: CoverSentence[][] = (out.paragraphs ?? []).map((p) =>
    (p.sentences ?? [])
      .filter((s) => s?.text && s.text.trim())
      .map((s) => ({
        text: s.text!.trim(),
        // keep only ids that are real tailored bullets
        sourceIds: (s.sourceIds ?? []).filter((id) => validIds.has(id)),
      })),
  ).filter((p) => p.length > 0);

  return { greeting: (out.greeting ?? 'Dear Hiring Team,').trim(), paragraphs };
}

// ── docx rendering (business-letter layout, Garamond) ──────────────────────────

function run(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({ text, font: FONT, size: opts.size ?? SIZE_BODY, bold: opts.bold });
}

async function renderLetterDocx(greeting: string, paragraphs: CoverSentence[][]): Promise<Buffer> {
  const children: Paragraph[] = [];
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(NAME, { bold: true, size: SIZE_NAME })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(CONTACT.join(' | '), { size: SIZE_CONTACT })] }));
  children.push(new Paragraph({}));
  children.push(new Paragraph({ children: [run(greeting)] }));
  children.push(new Paragraph({}));
  for (const para of paragraphs) {
    children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [run(para.map((s) => s.text).join(' '))] }));
    children.push(new Paragraph({}));
  }
  children.push(new Paragraph({ children: [run('Sincerely,')] }));
  children.push(new Paragraph({}));
  children.push(new Paragraph({ children: [run(NAME)] }));

  const doc = new Document({
    creator: 'Hatch Resume Builder',
    sections: [{
      properties: {
        page: { size: { width: PAGE.width, height: PAGE.height, orientation: PageOrientation.PORTRAIT }, margin: MARGIN },
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

// ── Public API ──────────────────────────────────────────────────────────────────

export async function generateCoverLetter(
  tailored: TailoredResume,
  jdText: string,
  opts: { outPath?: string } = {},
): Promise<CoverLetter> {
  const { greeting, paragraphs } = await writeBody(tailored, jdText);
  const sentences = paragraphs.flat();

  const bodyText = paragraphs.map((p) => p.map((s) => s.text).join(' ')).join('\n\n');
  const text = [greeting, bodyText, 'Sincerely,', NAME].join('\n\n');

  const buf = await renderLetterDocx(greeting, paragraphs);
  const docxPath = opts.outPath ?? join(homedir(), 'hatch', 'out', 'cover-letter.docx');
  mkdirSync(dirname(docxPath), { recursive: true });
  writeFileSync(docxPath, buf);

  return { docxPath, greeting, sentences, text, provenance: tailored.provenance };
}
