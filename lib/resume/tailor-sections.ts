/**
 * lib/resume/tailor-sections.ts
 *
 * Part-B education/additional tailoring step. Routes the grounded Education +
 * Additional claims (kind education|additional) into render data, JD-relevant but
 * STRICTLY truthful:
 *   - DEGREES (3), SCHOOL+GRADYEAR (1), LANGUAGES (2) → always rendered in full,
 *     no model.
 *   - COURSEWORK → model returns a JD-relevance RANKING of grounded course *ids*;
 *     a deterministic packer (line-width.ts) greedily fills exactly
 *     COURSEWORK_LINE_BUDGET wrapped lines (verbatim names, one-lookahead swap,
 *     no orphan). Universe = canonical relevant-coursework ∪ Canvas-verified.
 *   - SKILLS → model returns a token subset; we intersect to EXACT grounded
 *     members, cap, and order. Languages tail-appended → one "Skills & Languages:"
 *     line.
 *   - INTERESTS → passthrough (capped).
 *
 * The model returns grounded ids / exact tokens ONLY. The renderer dereferences
 * every id/token to its VERBATIM grounded string — never the model's echoed text.
 * A separate skills-GAP list (JD skills the candidate lacks) is emitted for study
 * only and has NO path into the document (membership guard enforces this).
 *
 * Structural noise filter (Phase-0d): education/additional members are markdown
 * list items; the 4 prose lead-ins / HTML comments are NON-list claims and are
 * dropped via `claim.listItem`.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
import type { CandidatePool, Claim } from '@/lib/resume/candidate-pool';
import type { EducationEntry } from '@/lib/resume/render-docx';
import { packCourses } from '@/lib/resume/line-width';
import { structuredCreate } from '@/lib/resume/structured';

// ── Tunables ─── EDIT TO RETAILOR ───────────────────────────────────────────────
const COURSEWORK_LINE_BUDGET = 2;        // fill exactly the existing 2 wrapped lines
const SKILLS_CAP = 23;                   // B-14: passthrough-all default — render below the grounded set ONLY by editing this
const INTERESTS_CAP = 11;                // universe is 11
const SKILLS_ORDER: 'canonical' | 'jd-first' = 'jd-first'; // B-14: order-only knob — membership is always the full grounded set
// Canvas-verified courses are general/intro and stay OUT of the canonical block;
// they remain a grounded, off-by-default fallback pool (not ranked/packed/rendered).
const INCLUDE_CANVAS_FALLBACK = false; // B-30: Canvas fallback disabled — it carried registrar DEPT/term suffixes and non-relevant (COMLIT) courses. Coursework sources from the curated relevant-block only. Re-enable ONLY with a deterministic suffix-strip + relevance filter (B-29 R7 Option B).
// ────────────────────────────────────────────────────────────────────────────────

// ── Grounded sets (shared with the membership guard — single source of truth) ────

export interface GroundedSections {
  degrees: string[];          // 3, verbatim
  schoolName: string;         // "University of California, Berkeley"
  gradYear: string;           // "2027"
  schoolClaim: string;        // full grounded school claim (for substring asserts)
  coursework: string[];       // canonical universe = relevant DISPLAY names (canvas excluded)
  courseIds: Array<{ id: string; name: string }>; // for the model ranking (display names)
  courseAliases: Array<{ original: string; display: string }>; // for alias-tracing guard
  canvasFallback: string[];   // off-by-default fallback pool (not rendered)
  skills: string[];           // 23 tokens, canonical order
  languages: string[];        // 2 tokens
  interests: string[];        // 11 tokens
}

/** Parse a "<Original> | <Display>" coursework line; display defaults to original. */
export function parseCourseLine(text: string): { original: string; display: string } {
  const i = text.indexOf(' | ');
  if (i < 0) return { original: text.trim(), display: text.trim() };
  return { original: text.slice(0, i).trim(), display: text.slice(i + 3).trim() };
}

/** Members only (list items); the 4 prose/comment noise claims are excluded. */
function members(pool: CandidatePool): Claim[] {
  return pool.claims.filter(
    (c) => (c.kind === 'education' || c.kind === 'additional') && c.listItem,
  );
}

const inFile = (c: Claim, file: string) => c.sourcePath.endsWith(file);
/** Strip a "Label: " prefix and split a grounded list line into trimmed tokens. */
function splitTokens(text: string, label?: string): string[] {
  let s = text;
  if (label && s.startsWith(label)) s = s.slice(label.length);
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

/**
 * Derive the grounded selection universe from the pool — recomputed identically by
 * the membership guard so the two can never diverge.
 */
export function groundedSections(pool: CandidatePool): GroundedSections {
  const m = members(pool);

  const degrees = m
    .filter((c) => inFile(c, 'education.md') && c.section === 'Degrees')
    .map((c) => c.text);

  const schoolClaim =
    m.find((c) => inFile(c, 'education.md') && c.section === 'School')?.text ?? '';
  const [schoolName, gradPart] = schoolClaim.split(/\s+—\s+Expected Graduation\s+/);
  const gradYear = (gradPart ?? '').trim();

  // Relevant coursework — parse the "<Original> | <Display>" alias form. The canonical
  // block ranks/packs/renders DISPLAY names; the membership universe is the display set.
  const relevantClaims = m.filter(
    (c) => inFile(c, 'coursework.md') && c.section === 'Relevant Coursework',
  );
  const courseAliases = relevantClaims.map((c) => parseCourseLine(c.text));
  const relevant = relevantClaims.map((c) => ({ id: c.id, name: parseCourseLine(c.text).display }));
  // Canvas-verified — grounded but OFF-BY-DEFAULT (general/intro; not in the canonical block).
  const canvas = m
    .filter((c) => inFile(c, 'coursework.md') && c.section === 'Canvas-Verified Completed Courses')
    .map((c) => ({ id: c.id, name: c.text }));
  const courseIds = INCLUDE_CANVAS_FALLBACK ? [...relevant, ...canvas] : relevant;
  const coursework = courseIds.map((c) => c.name);
  const canvasFallback = canvas.map((c) => c.name);

  const skillsClaim =
    m.find((c) => inFile(c, 'additional.md') && /^Skills:/.test(c.text))?.text ?? '';
  const skills = splitTokens(skillsClaim, 'Skills:');

  const langClaim =
    m.find((c) => inFile(c, 'additional.md') && /^Languages:/.test(c.text))?.text ?? '';
  const languages = splitTokens(langClaim, 'Languages:');

  const interestsClaim =
    m.find((c) => inFile(c, 'additional.md') && c.section === 'Interests')?.text ?? '';
  const interests = splitTokens(interestsClaim);

  return {
    degrees,
    schoolName: (schoolName ?? '').trim(),
    gradYear,
    schoolClaim,
    coursework,
    courseIds,
    courseAliases,
    canvasFallback,
    skills,
    languages,
    interests,
  };
}

/**
 * Mechanical alias-tracing check: every content word in a display alias must trace to
 * a word in its original CV name (a prefix either way → covers abbreviations), else be
 * a function word. Catches any new tech/domain token or level/scope change.
 */
const ALIAS_STOPWORDS = new Set(['and', 'of', 'for', 'the', 'in', 'to', 'with', 'a', 'an', '&']);
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
export function aliasTraces(original: string, display: string): boolean {
  const orig = tokenize(original);
  for (const w of tokenize(display)) {
    if (ALIAS_STOPWORDS.has(w)) continue;
    const ok = orig.some((o) => o === w || o.startsWith(w) || w.startsWith(o));
    if (!ok) return false;
  }
  return true;
}

// ── Model plumbing ──────────────────────────────────────────────────────────────

const SELECT_TOOL: Anthropic.Tool = {
  name: 'select_sections',
  description:
    'Rank grounded coursework by JD relevance and select grounded skill tokens; ' +
    'also list JD-required skills the candidate does NOT have (study list).',
  input_schema: {
    type: 'object',
    properties: {
      coursework_ranked_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'ALL provided course ids, reordered most-JD-relevant first. Ids only — never names.',
      },
      skills_selected: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Subset of the provided skill tokens that are relevant to the JD. Copy tokens VERBATIM.',
      },
      skills_missing_from_candidate: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Skills the JD explicitly asks for that are NOT in the provided skill list (study list).',
      },
    },
    required: ['coursework_ranked_ids', 'skills_selected', 'skills_missing_from_candidate'],
  },
};

interface SelectOut {
  coursework_ranked_ids?: string[];
  skills_selected?: string[];
  skills_missing_from_candidate?: string[];
}

async function selectSections(g: GroundedSections, jdText: string): Promise<SelectOut> {
  const courseCatalog = g.courseIds.map((c) => `${c.id} :: ${c.name}`).join('\n');
  const skillCatalog = g.skills.join(', ');

  const prompt =
    `You are tailoring the Education and Additional sections of a résumé to a target job. ` +
    `You may ONLY reorder/select from the grounded material below — never invent a course or skill, ` +
    `never rename or abbreviate one.\n\n` +
    `TASKS:\n` +
    `1. coursework_ranked_ids: return EVERY course id below, reordered most-relevant-to-the-JD first. ` +
    `Return ids only (a downstream packer picks how many fit; you only decide the order).\n` +
    `2. skills_selected: from the SKILL TOKENS list, return the subset most relevant to the JD, copied ` +
    `EXACTLY (same spelling/case). Do not add any token that is not in the list.\n` +
    `3. skills_missing_from_candidate: skills the JD explicitly requires that do NOT appear in the SKILL ` +
    `TOKENS list. These are for a study list — NOT résumé content.\n\n` +
    `=== JOB DESCRIPTION ===\n${jdText}\n\n` +
    `=== COURSE IDS (id :: name) ===\n${courseCatalog}\n\n` +
    `=== SKILL TOKENS (comma-separated) ===\n${skillCatalog}\n`;

  const out = await structuredCreate<SelectOut>({
    stage: 'sections-select',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 4096,
    prompt,
    schema: SELECT_TOOL.input_schema as Record<string, unknown>,
  });
  // Empty skills/coursework would silently pass the membership guard (empty set
  // is a subset) — fail the stage instead.
  if (!out) throw new Error('sections-select: structured output failed (see WARN above)');
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────────

export interface SectionSelection {
  degrees: string[];
  schoolName: string;
  gradYear: string;
  coursework: string[];   // packed, render order, verbatim
  skills: string[];       // selected grounded tokens, ordered
  languages: string[];
  interests: string[];
}

export interface TailoredSections {
  education: EducationEntry[];
  additional: { skillsAndLanguages?: string; interests?: string };
  selection: SectionSelection;
  skillsToLearn: string[]; // study list — NEVER rendered
  coursePack: { lineCount: number; lastLineFill: number };
}

export async function tailorSections(pool: CandidatePool, jdText: string): Promise<TailoredSections> {
  const g = groundedSections(pool);
  const sel = await selectSections(g, jdText);

  // COURSEWORK — dereference ranked ids → verbatim names, then deterministically pack.
  const byId = new Map(g.courseIds.map((c) => [c.id, c.name]));
  const ranked = (sel.coursework_ranked_ids ?? [])
    .map((id) => byId.get(id))
    .filter((n): n is string => typeof n === 'string');
  // Append any course the model omitted (keep universe complete) in canonical order.
  for (const c of g.courseIds) if (!ranked.includes(c.name)) ranked.push(c.name);
  const pack = packCourses(ranked, COURSEWORK_LINE_BUDGET);
  const coursework = pack.selected;

  // SKILLS — PASSTHROUGH-ALL (B-14 restoration): every grounded skill renders,
  // exactly like coursework's keep-universe-complete append. The model's
  // `skills_selected` subset influences ORDER only (jd-first), never membership —
  // rendering fewer than the grounded set requires an explicit SKILLS_CAP edit.
  const groundedSkillSet = new Set(g.skills);
  const picked = (sel.skills_selected ?? []).filter((t) => groundedSkillSet.has(t));
  const uniquePicked = [...new Set(picked)];
  let skills: string[];
  if (SKILLS_ORDER === 'canonical') {
    skills = [...g.skills];
  } else {
    // jd-first: model-picked (JD-relevant) tokens lead, the rest follow in canonical order.
    skills = [...uniquePicked, ...g.skills.filter((t) => !uniquePicked.includes(t))];
  }
  skills = skills.slice(0, SKILLS_CAP);

  // SKILLS GAP — JD skills not in the grounded 23 (study list only). Defensive: drop
  // anything that actually IS a grounded skill (case-insensitive) so it can't leak.
  const groundedLower = new Set(g.skills.map((s) => s.toLowerCase()));
  const skillsToLearn = [...new Set(sel.skills_missing_from_candidate ?? [])].filter(
    (s) => s.trim() && !groundedLower.has(s.toLowerCase()),
  );

  // LANGUAGES / INTERESTS / DEGREES / SCHOOL — full, no model.
  const languages = g.languages;
  const interests = g.interests.slice(0, INTERESTS_CAP);

  const education: EducationEntry[] = [
    {
      school: g.schoolName,
      right: g.gradYear ? `Expected Graduation: ${g.gradYear}` : undefined,
      degrees: g.degrees.join(', '),
      coursework: coursework.join(', '),
    },
  ];

  const additional = {
    skillsAndLanguages: [...skills, ...languages].join(', '),
    interests: interests.join(', '),
  };

  const selection: SectionSelection = {
    degrees: g.degrees,
    schoolName: g.schoolName,
    gradYear: g.gradYear,
    coursework,
    skills,
    languages,
    interests,
  };

  return {
    education,
    additional,
    selection,
    skillsToLearn,
    coursePack: { lineCount: pack.lineCount, lastLineFill: pack.lastLineFill },
  };
}
