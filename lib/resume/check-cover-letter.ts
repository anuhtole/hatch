/**
 * lib/resume/check-cover-letter.ts
 *
 * Prose drift guard for the cover letter. Numbers-only guarding misses grafted
 * specifics ("designed the evals", "fine-tuned LLM", cross-bullet conflation),
 * so this checks per-sentence provenance:
 *
 *   For each sentence:
 *     - every cited sourceId must exist in the tailored résumé;
 *     - every NAMED SPECIFIC in the sentence — a number, a named tool / proper
 *       noun, or a domain technique term — must appear in the CITED bullets'
 *       text (a named specific absent from its sources = drift).
 *
 * Allowances (kept precise so the flags mean something):
 *   - proper nouns / named tools may also come from the job description (naming
 *     the target company/role/priorities is legitimate) or be the cited bullets'
 *     entity name (e.g. "Microsoft", which lives in frontmatter, not bullet text);
 *   - numbers and technique terms must come from the CITED bullets — never the JD
 *     (this is what catches JD-phrasing-as-accomplishment);
 *   - connective sentences (no sourceIds) may only carry JD/target proper nouns —
 *     any number, technique, or other specific in them is drift.
 */

import type { CandidatePool } from '@/lib/resume/candidate-pool';
import type { TailoredResume } from '@/lib/resume/tailor';
import type { CoverSentence } from '@/lib/resume/cover-letter';

export interface DriftFlag {
  sentence: string;
  sourceIds: string[];
  term: string;
  category: 'unknown-source' | 'number' | 'proper-noun' | 'technique' | 'research-term';
}

export interface DriftReport {
  sentenceCount: number;
  flags: DriftFlag[];
  warnings: DriftFlag[]; // exempted-but-surfaced (e.g. target-naming) — never silent
}

// Domain technique / measurement terms that constitute fabrication unless they
// appear in the cited bullet. Matched as lowercased substrings. Exported so the
// résumé-bullet drift guard reuses the exact same lexicon (no divergence).
export const TECH_LEXICON = [
  'fine-tuned', 'prompt-tuned', 'pre-trained', 'pretrained', 'rlhf', 'reinforcement learning',
  'random forest', 'swe-bench', 'agentic', 'multi-agent', 'orchestration', 'eval', 'benchmark',
  'readiness criteria', 'real-world usage', 'red-team', 'observability', 'guardrail',
  'policy enforcement', 'audit trail', 'recommendation engine', 'data pipeline', 'validation workflow',
  'distillation', 'quantization', 'embedding', 'transformer',
];

// Generic / function words that aren't entities (trimmed from capitalized runs
// and skipped, so "At Microsoft" → "Microsoft", "I" → ∅, avoiding false positives).
const COMMON = new Set([
  'i', 'a', 'an', 'the', 'my', 'this', 'that', 'these', 'those', 'it', 'we', 'and', 'but', 'or',
  'to', 'for', 'of', 'in', 'on', 'with', 'as', 'at', 'from', 'by', 'first', 'second', 'third',
  'finally', 'separately', 'also', 'dear', 'sincerely', 'hiring', 'team', 'ai', 'role',
  // sentence-initial prepositions/connectives — trimmed so "Within Spine" reduces
  // to "Spine" (the entity still has to match the cited bullets/JD to pass)
  'within', 'across', 'through', 'during', 'after', 'before', 'under', 'over', 'into',
  'between', 'beyond', 'alongside', 'since', 'while', 'when', 'where', 'there', 'here',
  'because', 'beside', 'besides', 'throughout', 'toward', 'towards', 'via', 'using',
]);

function numericCores(s: string): string[] {
  return [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));
}

/** A capitalized run is a "named specific" if it's multi-word, has ≥2 capitals
 *  (CamelCase/acronym), or contains a symbol/digit — i.e. a real entity/tool,
 *  not just a sentence-initial or single plain capitalized word. */
function isNamedSpecific(tok: string): boolean {
  if (/\s/.test(tok)) return true;
  if (/[A-Z].*[A-Z]/.test(tok)) return true;
  // A single capitalized ORDINARY hyphenated word ("Co-founding", "Cross-functional")
  // is just the hyphenated form of a plain capitalized word, which is allowed by
  // design — a hyphen alone doesn't make it an entity/tool. Real hyphenated
  // specifics still match via ≥2 capitals (SWE-bench) or the digit/symbol rule
  // below (GPT-4, A/B).
  if (/^[A-Z][a-z]+(?:-[a-z]+)+$/.test(tok)) return false;
  if (/[.+/&\d-]/.test(tok)) return true;
  return false;
}

export function namedSpecifics(sentence: string): string[] {
  const out: string[] = [];
  const re = /\b[A-Z][A-Za-z0-9.+/&'-]*(?:\s+[A-Z][A-Za-z0-9.+/&'-]*)*\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    // Trim leading/trailing function words (sentence-initial "At", "I", trailing
    // "AI", etc.) so "At Microsoft" reduces to "Microsoft" (a single plain entity,
    // which is allowed) and only genuine multi-word/CamelCase/acronym/symbol
    // entities remain.
    const words = m[0].split(/\s+/);
    while (words.length && COMMON.has(words[0].toLowerCase())) words.shift();
    while (words.length && COMMON.has(words[words.length - 1].toLowerCase())) words.pop();
    if (!words.length) continue;
    const tok = words.join(' ');
    if (isNamedSpecific(tok)) out.push(tok);
  }
  return out;
}

/** Extract the addressed company from a greeting, e.g. "Dear Anthropic Hiring Team," →
 *  "Anthropic". Returns '' when no company is named. */
export function companyFromGreeting(greeting: string): string {
  const m = greeting.match(/dear\s+(.+?)\s+(?:hiring|recruit\w*|talent|people|team|search)\b/i);
  if (m) return m[1].replace(/['’]s$/i, '').trim();
  const m2 = greeting.match(/dear\s+([A-Z][A-Za-z0-9.&'’-]*)/);
  return m2 ? m2[1].replace(/['’]s$/i, '').trim() : '';
}

/**
 * TARGET-NAMING exemption (narrow): a multi-word proper-noun token is exempt ONLY when
 *   (i)   the target company is named in the JD (anchors it to the real target),
 *   (ii)  the token's FIRST word IS that company, possessive or attributive
 *         ("Anthropic's" / "Anthropic"), and
 *   (iii) EVERY remaining capitalized word in the token appears individually in the JD.
 * Everything else keeps the strict contiguous-substring rule. So "Anthropic's API" (API
 * is in the JD) is exempt, but "Anthropic's SWE-bench evals" (SWE-bench not in the JD) and
 * "Stanford AI Lab" (head ≠ company) are NOT.
 */
function isTargetNaming(token: string, company: string, jdLower: string): boolean {
  if (!company || !jdLower.includes(company.toLowerCase())) return false;
  const words = token.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const head = words[0].replace(/['’]s$/i, '').toLowerCase();
  if (head !== company.toLowerCase()) return false;
  return words.slice(1).every((w) => {
    const bare = w.replace(/['’]s$/i, '').toLowerCase();
    return jdLower.includes(bare);
  });
}

export function checkCoverLetterDrift(
  sentences: CoverSentence[],
  tailored: TailoredResume,
  pool: CandidatePool,
  jdText: string,
  targetCompany = '',
  researchTerms: string[] = [],
): DriftReport {
  // A claim can render as TWO bullets (B-15 one-idea split); both share its sourceId.
  // Aggregate all of a claim's rendered text so a sentence citing it is checked
  // against EVERY child — a plain Map would keep only the last and false-flag the rest.
  const bulletText = new Map<string, string>();
  for (const p of tailored.provenance) {
    bulletText.set(p.sourceId, bulletText.has(p.sourceId) ? `${bulletText.get(p.sourceId)} ${p.text}` : p.text);
  }
  const entityById = new Map(pool.claims.map((c) => [c.id, c.entity]));
  const jdLower = jdText.toLowerCase();
  const research = researchTerms.map((t) => t.toLowerCase()).filter(Boolean);
  const flags: DriftFlag[] = [];
  const warnings: DriftFlag[] = [];

  for (const s of sentences) {
    const add = (term: string, category: DriftFlag['category']) =>
      flags.push({ sentence: s.text, sourceIds: s.sourceIds, term, category });

    // (1) cited ids must exist.
    const knownIds = s.sourceIds.filter((id) => {
      if (bulletText.has(id)) return true;
      add(id, 'unknown-source');
      return false;
    });

    const citedBulletText = knownIds.map((id) => bulletText.get(id)!).join(' ');
    const citedEntities = knownIds.map((id) => entityById.get(id) ?? '').join(' ');
    const C = `${citedBulletText} ${citedEntities}`.toLowerCase();
    const citedNums = new Set(numericCores(citedBulletText));

    // (2) numbers — must be in the cited bullets.
    for (const n of numericCores(s.text)) {
      if (!citedNums.has(n)) add(n, 'number');
    }

    // (3) proper nouns / named tools — in cited bullets/entities, or JD (contiguous).
    //     Matching normalizes the possessive: "CHAI's" is the same entity as "CHAI"
    //     (morphology, like the lowercasing above — not an exemption). Narrow
    //     exemption beyond that: target-company attributive naming ("Anthropic's API").
    for (const pn of namedSpecifics(s.text)) {
      const low = pn.toLowerCase();
      const base = low.replace(/[’']s$/, '');
      if (C.includes(low) || jdLower.includes(low)) continue;
      if (base !== low && (C.includes(base) || jdLower.includes(base))) continue;
      if (isTargetNaming(pn, targetCompany, jdLower)) {
        warnings.push({ sentence: s.text, sourceIds: s.sourceIds, term: pn, category: 'proper-noun' });
        continue;
      }
      add(pn, 'proper-noun');
    }

    // (4) technique terms — must be in the cited bullets (NOT the JD).
    const low = s.text.toLowerCase();
    for (const term of TECH_LEXICON) {
      if (low.includes(term) && !C.includes(term)) add(term, 'technique');
    }

    // (5) research terms — FLAG set, never an allow-list: a research-brief term in the
    //     sentence but in NEITHER the cited bullets NOR the JD = research leaked in.
    for (const term of research) {
      if (low.includes(term) && !C.includes(term) && !jdLower.includes(term)) add(term, 'research-term');
    }
  }

  return { sentenceCount: sentences.length, flags, warnings };
}

// ── Self-test (regression fixtures) ─────────────────────────────────────────────
// Proves the target-naming exemption is narrow: it exempts legitimate company
// attributive naming but NOT a coined specific absent from the JD, nor a non-company
// head. Run: npx tsx lib/resume/check-cover-letter.ts  (npm run guard:cl-selftest).

function runSelfTest(): void {
  const T = { provenance: [] } as unknown as TailoredResume;
  const P = { claims: [] } as unknown as CandidatePool;
  const sent = (text: string): CoverSentence[] => [{ text, sourceIds: [] }];

  interface Case { name: string; sentence: string; jd: string; company: string; expect: 'exempt' | 'flag' | 'clean'; }
  const cases: Case[] = [
    {
      name: 'EXEMPT: "Anthropic\'s API team" (Anthropic + API in JD)',
      sentence: "I would love to join Anthropic's API team and contribute.",
      jd: 'About Anthropic. This is an API growth product role on the platform.',
      company: 'Anthropic',
      expect: 'exempt',
    },
    {
      name: 'FLAG: "Anthropic\'s SWE-bench evals" (SWE-bench NOT in JD)',
      sentence: "I built Anthropic's SWE-bench evals last year.",
      jd: 'About Anthropic. We build safe AI for developers.',
      company: 'Anthropic',
      expect: 'flag',
    },
    {
      name: 'FLAG: "Stanford AI Lab" (head ≠ company)',
      sentence: 'I worked at Stanford AI Lab on research.',
      jd: 'About Anthropic. We value AI research.',
      company: 'Anthropic',
      expect: 'flag',
    },
    {
      name: 'CLEAN: sentence-initial ordinary hyphenated word ("Co-founding")',
      sentence: 'Co-founding a startup taught me about growth firsthand.',
      jd: 'About Anthropic. Founder experience is a plus.',
      company: 'Anthropic',
      expect: 'clean',
    },
    {
      name: 'FLAG: hyphen+digit token "GPT-4" (not in JD, not cited)',
      sentence: 'I shipped GPT-4 integrations last year.',
      jd: 'About Anthropic. We build AI.',
      company: 'Anthropic',
      expect: 'flag',
    },
    {
      name: 'CLEAN: possessive of a JD-known name ("CHAI\'s" with CHAI in JD)',
      sentence: "CHAI's mission resonates with how I already work.",
      jd: 'About CHAI. The Center for Human-Compatible AI studies AI safety.',
      company: 'CHAI',
      expect: 'clean',
    },
    {
      name: 'FLAG: possessive of an UNKNOWN name ("DeepMind\'s" not in JD, not cited)',
      sentence: "I admired DeepMind's safety agenda and applied it.",
      jd: 'About CHAI. The Center for Human-Compatible AI studies AI safety.',
      company: 'CHAI',
      expect: 'flag',
    },
    {
      name: 'CLEAN: sentence-initial preposition trims to a known entity ("Within Spine")',
      sentence: 'Within Spine, I designed a checkpoint mode for human approval.',
      jd: 'About CHAI. The candidate project Spine concerns agent oversight.',
      company: 'CHAI',
      expect: 'clean',
    },
    {
      name: 'FLAG: sentence-initial preposition + UNKNOWN acronym ("Within HYDRA")',
      // After trimming "Within", the acronym HYDRA (≥2 caps → in guard scope, unlike
      // a single plain capitalized word) must still flag when unknown.
      sentence: 'Within HYDRA, I shipped the safety layer.',
      jd: 'About CHAI. The Center for Human-Compatible AI studies AI safety.',
      company: 'CHAI',
      expect: 'flag',
    },
  ];

  let bad = 0;
  for (const c of cases) {
    const r = checkCoverLetterDrift(sent(c.sentence), T, P, c.jd, c.company);
    const exempted = r.warnings.length > 0;
    const flagged = r.flags.length > 0;
    const ok =
      c.expect === 'exempt' ? exempted && !flagged
      : c.expect === 'flag' ? flagged && !exempted
      : !flagged && !exempted; // clean: neither flagged nor warned
    console.log(`  ${ok ? '✓' : '✗'} ${c.name}`);
    console.log(`      flags=${r.flags.map((f) => `"${f.term}"`).join(',') || '∅'} ` +
      `warnings=${r.warnings.map((f) => `"${f.term}"`).join(',') || '∅'}`);
    if (!ok) bad++;
  }
  console.log(`\n[cl-selftest] ${bad === 0 ? `CLEAN ✓ (${cases.length}/${cases.length} fixtures behaved correctly)` : `FAILED — ${bad} fixture(s) wrong`}`);
  if (bad > 0) process.exit(2);
}

if (process.argv[1] && process.argv[1].includes('check-cover-letter')) runSelfTest();
