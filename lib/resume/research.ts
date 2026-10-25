/**
 * lib/resume/research.ts
 *
 * Company/role research layer. Runs web_search (Anthropic server tool) for the
 * target company's priorities, team context, and recent launches relevant to the
 * role, and emits a research brief.
 *
 * ── STRUCTURAL CONTAINMENT CONTRACT (the whole point of B-4) ────────────────────
 * Research is ADVISORY and MUST influence ONLY:
 *   (i)  the tailor SELECT step's *ranking* guidance (emphasis among grounded claims), and
 *   (ii) gap-report's open *questions*.
 * Research text is NEVER passed to REPHRASE, cover-letter generation, or any renderer.
 * Enforced by module boundary: this file is imported ONLY by e2e-fixture.ts. The
 * rephrase / cover-letter / render entrypoints neither import research.ts nor accept
 * its output type. The drift guards receive only a plain string[] of research FLAG
 * terms (never an allow-list) — research vocabulary that reaches output FAILS.
 *
 * Fail-soft: research is advisory. On any web_search/parse error, callers print WARN
 * and proceed WITHOUT research (the pipeline must not depend on it).
 */

import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
import { withRetry } from '@/lib/resume/structured';

// ── Types ───────────────────────────────────────────────────────────────────────

export interface ResearchSource { url: string; title?: string }
export interface ResearchTheme { theme: string; sourceUrl: string }
export interface ResearchEmphasis { emphasis: string; sourceUrl: string }
export interface ResearchQuestion { question: string; sourceUrl: string }

export interface ResearchBrief {
  company: string;
  role: string;
  sources: ResearchSource[];
  themes: ResearchTheme[];               // short labels → SELECT ranking guidance
  suggestedEmphasis: ResearchEmphasis[]; // brief rationale, each with a source URL
  openQuestions: ResearchQuestion[];     // merged into gap-report questions
  generatedAt: string;
}

// ── Company/role derivation (from the JD URL + text) ────────────────────────────

const titleCase = (s: string) =>
  s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export function deriveCompanyRole(url: string, jdText: string): { company: string; role: string } {
  const firstLine = (jdText.split('\n').find((l) => l.trim()) ?? '').replace(/^#\s*/, '').trim();
  const role = firstLine || 'the role';

  let company = '';
  const gh = url.match(/greenhouse\.io\/([^/]+)\/jobs/i);
  const ashby = url.match(/ashbyhq\.com\/([^/]+)\//i);
  const lever = url.match(/lever\.co\/([^/]+)\//i);
  if (gh) company = titleCase(gh[1]);
  else if (ashby) company = titleCase(ashby[1]);
  else if (lever) company = titleCase(lever[1]);
  if (!company) {
    const about = jdText.match(/\bAbout\s+([A-Z][A-Za-z0-9.&-]+)/);
    company = about ? about[1] : '';
  }
  return { company, role };
}

// ── web_search + structured brief ───────────────────────────────────────────────

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Server web_search tool (mirrors lib/claude.ts; capped uses).
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
} as unknown as Anthropic.Tool;

const BRIEF_TOOL: Anthropic.Tool = {
  name: 'submit_brief',
  description: 'Emit the structured research brief. Every theme/emphasis/question carries a source URL.',
  input_schema: {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        description: 'Short theme labels (a few words) for what the company/role prioritizes.',
        items: {
          type: 'object',
          properties: { theme: { type: 'string' }, sourceUrl: { type: 'string' } },
          required: ['theme', 'sourceUrl'],
        },
      },
      suggestedEmphasis: {
        type: 'array',
        description: 'Which KINDS of the candidate\'s existing experience to foreground (no new facts).',
        items: {
          type: 'object',
          properties: { emphasis: { type: 'string' }, sourceUrl: { type: 'string' } },
          required: ['emphasis', 'sourceUrl'],
        },
      },
      openQuestions: {
        type: 'array',
        description: 'Open questions the candidate should be ready for — never propose a number/claim.',
        items: {
          type: 'object',
          properties: { question: { type: 'string' }, sourceUrl: { type: 'string' } },
          required: ['question', 'sourceUrl'],
        },
      },
    },
    required: ['themes', 'suggestedEmphasis', 'openQuestions'],
  },
};

/** Collect {url,title} from any web_search_tool_result blocks in a message. */
function collectSources(msg: Anthropic.Message): ResearchSource[] {
  const out: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const block of msg.content as unknown as Array<Record<string, unknown>>) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content as Array<Record<string, unknown>>) {
        if (r.type === 'web_search_result' && typeof r.url === 'string' && !seen.has(r.url)) {
          seen.add(r.url);
          out.push({ url: r.url, title: typeof r.title === 'string' ? r.title : undefined });
        }
      }
    }
  }
  return out;
}

function toolInput<T>(msg: Anthropic.Message, name: string): T | null {
  const block = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === name,
  );
  return block ? (block.input as T) : null;
}

/**
 * Run company/role research. Returns a brief, or null on any failure (fail-soft —
 * the caller continues without research). `now` is injected for deterministic stamping.
 */
export async function runResearch(
  company: string,
  role: string,
  now: string,
): Promise<ResearchBrief | null> {
  if (!company) return null;
  try {
    const prompt =
      `Research the company "${company}" for a candidate applying to the role "${role}". ` +
      `Use web_search to find: the company's current product priorities and strategy, the team/org ` +
      `context for this role, and recent launches or announcements relevant to it. Run a few targeted ` +
      `searches, then ALWAYS finish by calling submit_brief.\n\n` +
      `In submit_brief:\n` +
      `- themes: short labels (e.g. "developer platform growth", "usage-based monetization") for what ` +
      `THIS role/company prioritizes — these will guide which of the candidate's real experiences to ` +
      `foreground. Each needs the source URL you learned it from.\n` +
      `- suggestedEmphasis: which KINDS of experience to foreground. Describe emphasis only — never ` +
      `invent an accomplishment or number; the candidate's actual résumé content is grounded elsewhere.\n` +
      `- openQuestions: things the candidate should be ready to speak to. Open-ended; never propose a ` +
      `number or a specific accomplishment to confirm.\n`;

    const msg = await withRetry(() => client().messages.create({
      model: ROUTES.RESUME_PIPELINE,
      max_tokens: 4096,
      tools: [WEB_SEARCH_TOOL, BRIEF_TOOL],
      messages: [{ role: 'user', content: prompt }],
    }), 'research');

    const brief = toolInput<{
      themes?: ResearchTheme[];
      suggestedEmphasis?: ResearchEmphasis[];
      openQuestions?: ResearchQuestion[];
    }>(msg, 'submit_brief');
    if (!brief) return null;

    const sources = collectSources(msg);
    const clean = <T extends { sourceUrl: string }>(arr: T[] | undefined) =>
      (arr ?? []).filter((x) => x && x.sourceUrl);

    return {
      company,
      role,
      sources,
      themes: clean(brief.themes).map((t) => ({ theme: t.theme.trim(), sourceUrl: t.sourceUrl })),
      suggestedEmphasis: clean(brief.suggestedEmphasis).map((e) => ({ emphasis: e.emphasis.trim(), sourceUrl: e.sourceUrl })),
      openQuestions: clean(brief.openQuestions)
        .map((q) => ({ question: q.question.trim(), sourceUrl: q.sourceUrl }))
        .filter((q) => !/\d/.test(q.question)), // never anchor with a number
      generatedAt: now,
    };
  } catch {
    return null; // fail-soft
  }
}

// ── Research FLAG terms (for the drift guards — NEVER an allow-list) ─────────────

/**
 * Multi-word terms surfaced by research. Passed to the drift guards as a FLAG set:
 * any of these that appears in rendered output but is NOT in (source claims ∪ JD)
 * is a containment breach → the guard FAILS. Single words are excluded (too noisy);
 * only multi-word phrases (a real grafted specific) qualify.
 */
export function researchFlagTerms(brief: ResearchBrief): string[] {
  const terms = new Set<string>();
  const add = (s: string) => {
    const t = s.toLowerCase().trim();
    if (/\s/.test(t) && t.length >= 5) terms.add(t);
  };
  for (const t of brief.themes) add(t.theme);
  for (const e of brief.suggestedEmphasis) {
    // capitalized multi-word entities within the emphasis rationale
    for (const m of e.emphasis.matchAll(/\b[A-Z][A-Za-z0-9.+/&'-]*(?:\s+[A-Z][A-Za-z0-9.+/&'-]*)+\b/g)) {
      add(m[0]);
    }
  }
  return [...terms];
}
