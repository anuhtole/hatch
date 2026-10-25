import { prisma } from './prisma';
import { anthropic } from './claude';
import { MODELS } from './models';
import { getTodayBriefing } from './google-calendar';
import { listEmails } from './gmail';
import { getUpcomingAssignments } from './canvas';
import { getRecentNotes, readNote } from './vault';
import { loadConfirmedCareerFacts } from './memory-scheduler';
import { getDailyCareerBrief } from './career-ops';
import { ROUTES } from '@/lib/models';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarSection {
  events: Array<{
    title: string;
    start: string;
    end: string;
    location?: string;
    allDay: boolean;
  }>;
  conflicts: Array<{ a: string; b: string }>;
  longestFreeBlock?: { start: string; end: string; durationMinutes: number };
}

export interface EmailItem {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  priority: 'HIGH' | 'MEDIUM';
  action: string;
}

export interface AssignmentItem {
  title: string;
  courseName: string;
  dueAt: string;
  urgency: 'URGENT' | 'UPCOMING';
  submissionStatus?: string;
}

export interface TrackerChange {
  title: string;
  from: string | null;
  to: string;
  changedAt: string;
}

export interface StockData {
  symbol: string;
  name: string;
  price?: string;
  change?: string;
  changePct?: string;
  direction?: 'up' | 'down' | 'flat';
  news?: string;
}

export interface NewsStory {
  headline: string;
  summary: string;
  source?: string;
  url?: string;
}

export interface CareerOpportunity {
  title: string;
  company: string;
  relevance: string;
  url?: string;
  deadline?: string;
}

export interface GoodMorningSection {
  greeting: string;
  dayLine: string;
  toneNote: string;
}

export interface TodaySection {
  events: CalendarSection['events'];
  conflicts: CalendarSection['conflicts'];
  longestFreeBlock?: CalendarSection['longestFreeBlock'];
  emails: EmailItem[];
  assignments: AssignmentItem[];
  trackers: TrackerChange[];
}

export interface TechAISection {
  aiStories: NewsStory[];
  techPolicy: NewsStory[];
}

export interface WorldNewsSection {
  stories: NewsStory[];
}

export interface DidYouKnowSection {
  fact: string;
  category: string;
}

export interface MorningPoemSection {
  title?: string;
  lines: string[];
}

export interface VaultEchoesSection {
  recentNotes: Array<{ path: string; title: string; modifiedAt: string }>;
  reflection: string;
  focusSuggestion: string;
}

export interface Highlight {
  section: string;
  type: 'calendar' | 'email' | 'assignment' | 'tracker' | 'market' | 'news' | 'career' | 'vault';
  text: string;
}

export interface BriefingContent {
  dailyRecap: GoodMorningSection | { error: string };
  today: TodaySection | { error: string };
  markets: { stocks: StockData[]; summary: string } | { error: string };
  techAI: TechAISection | { error: string };
  worldNews: WorldNewsSection | { error: string };
  career: { opportunities: CareerOpportunity[] } | { error: string };
  didYouKnow: DidYouKnowSection | { error: string };
  vaultEchoes: VaultEchoesSection | { error: string };
  highlights: Highlight[];
  generatedAt: string;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getBriefing(date: string): Promise<BriefingContent | null> {
  const row = await prisma.dailyBriefing.findUnique({ where: { date } });
  if (!row) return null;
  return JSON.parse(row.content) as BriefingContent;
}

export async function markBriefingRead(date: string): Promise<void> {
  await prisma.dailyBriefing.updateMany({
    where: { date, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function isBriefingRead(date: string): Promise<boolean> {
  const row = await prisma.dailyBriefing.findUnique({ where: { date } });
  return !!(row?.readAt);
}

// ── JSON extraction helper ────────────────────────────────────────────────────

function extractJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

// ── Private section builders ──────────────────────────────────────────────────

async function buildCalendarSection(): Promise<CalendarSection | { error: string }> {
  try {
    const briefing = await getTodayBriefing('berkeley');
    const longestFree = briefing.freeBlocks.sort((a, b) => b.durationMinutes - a.durationMinutes)[0];
    return {
      events: briefing.events.map((e) => ({
        title: e.title,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        location: e.location,
        allDay: e.allDay,
      })),
      conflicts: briefing.conflicts.map(({ a, b }) => ({ a: a.title, b: b.title })),
      longestFreeBlock: longestFree
        ? { start: longestFree.start.toISOString(), end: longestFree.end.toISOString(), durationMinutes: longestFree.durationMinutes }
        : undefined,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

async function buildEmailSection(): Promise<{ items: EmailItem[] } | { error: string }> {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sinceStr = `after:${Math.floor(since24h.getTime() / 1000)}`;
    const emails = await listEmails('berkeley', `is:unread in:inbox ${sinceStr}`, 20);
    if (emails.length === 0) return { items: [] };

    const emailList = emails.map((e, i) =>
      `${i + 1}. From: ${e.from} | Subject: ${e.subject} | Preview: ${e.snippet}`
    ).join('\n');

    const msg = await anthropic.messages.create({
      model: ROUTES.APP_DEFAULT,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are helping Anatole Seychal (UC Berkeley junior, PM background, job seeker) triage his inbox.
Rate each email HIGH or MEDIUM priority. SKIP newsletters/promotions/receipts.
HIGH: from professors/advisors/recruiters, requires response, time-sensitive.
MEDIUM: informational from known senders, FYI updates.

Emails:
${emailList}

Return JSON array (max 5 items):
[{"index": 1, "priority": "HIGH", "action": "Reply today - professor asking about office hours"}]
Only include HIGH and MEDIUM. Return [] if nothing important.`,
      }],
    });

    let rankings: Array<{ index: number; priority: 'HIGH' | 'MEDIUM'; action: string }> = [];
    const textBlock = msg.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const match = textBlock.text.match(/\[[\s\S]*\]/);
      if (match) {
        try { rankings = JSON.parse(match[0]); } catch { /* ignore */ }
      }
    }

    const items: EmailItem[] = rankings
      .filter((r) => r.index >= 1 && r.index <= emails.length)
      .map((r) => {
        const e = emails[r.index - 1];
        return { id: e.id, from: e.from, subject: e.subject, snippet: e.snippet, priority: r.priority, action: r.action };
      });

    return { items };
  } catch (err) {
    return { error: String(err) };
  }
}

async function buildAssignmentsSection(): Promise<{ items: AssignmentItem[]; totalDue: number } | { error: string }> {
  try {
    const assignments = await getUpcomingAssignments(7);
    const now = Date.now();
    const tomorrow = now + 48 * 60 * 60 * 1000;

    const items: AssignmentItem[] = assignments.map((a) => {
      const dueAt = a.due_at ? new Date(a.due_at) : null;
      const urgency: 'URGENT' | 'UPCOMING' = dueAt && dueAt.getTime() <= tomorrow ? 'URGENT' : 'UPCOMING';
      return {
        title: a.name,
        courseName: a.courseName,
        dueAt: dueAt ? dueAt.toISOString() : '',
        urgency,
        submissionStatus: a.submission?.workflow_state,
      };
    });

    return { items, totalDue: items.length };
  } catch (err) {
    return { error: String(err) };
  }
}

async function buildTrackersSection(): Promise<{ changes: TrackerChange[]; steady: boolean } | { error: string }> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const trackers = await prisma.tracker.findMany({
      where: { isActive: true, lastChanged: { gte: since } },
      include: { history: { orderBy: { checkedAt: 'desc' }, take: 2 } },
    });

    const changes: TrackerChange[] = trackers.map((t) => ({
      title: t.title,
      from: t.previousStatus,
      to: t.currentStatus ?? 'unknown',
      changedAt: (t.lastChanged ?? t.updatedAt).toISOString(),
    }));

    return { changes, steady: changes.length === 0 };
  } catch (err) {
    return { error: String(err) };
  }
}

// ── New section builders ──────────────────────────────────────────────────────

async function buildDailyRecapSection(): Promise<GoodMorningSection | { error: string }> {
  try {
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const fullDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    let vaultContext = 'UC Berkeley junior, triple major (Applied Math, Data Science, Political Economy). Studying abroad in Madrid. PM background. Interested in AI, tech policy.';
    const goalsNote = readNote('01-me/goals-2026.md');
    if (goalsNote) vaultContext = goalsNote.content.slice(0, 600);

    const msg = await anthropic.messages.create({
      model: ROUTES.APP_DEFAULT,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Write a warm, personal good morning greeting for Anatole Seychal, a UC Berkeley junior studying abroad in Madrid, Spain. Today is ${dayOfWeek}, ${fullDate}.

His context:
${vaultContext}

Keep it warm but not saccharine. Acknowledge the day specifically. The tone note should be a short (under 15 words) memorable idea — not a generic quote.

Return JSON only:
{
  "greeting": "Good morning, Anatole. [1-2 warm sentences, personal to the day/moment]",
  "dayLine": "[One sentence about today — what makes it worth showing up for]",
  "toneNote": "[A short original thought or reframe, under 15 words]"
}`,
      }],
    });

    const textBlock = msg.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const result = extractJson<GoodMorningSection>(textBlock.text);
      if (result) return result;
    }

    return {
      greeting: `Good morning, Anatole. It's ${dayOfWeek} in Madrid.`,
      dayLine: "Here's what's ahead.",
      toneNote: 'Show up — the rest follows.',
    };
  } catch (err) {
    return { error: String(err) };
  }
}

async function buildTodaySection(): Promise<TodaySection | { error: string }> {
  try {
    const [calResult, emailResult, assignmentResult, trackerResult] = await Promise.all([
      buildCalendarSection(),
      buildEmailSection(),
      buildAssignmentsSection(),
      buildTrackersSection(),
    ]);

    const he = (s: unknown): s is { error: string } => !!s && typeof (s as { error?: string }).error === 'string';

    return {
      events: !he(calResult) ? (calResult as CalendarSection).events : [],
      conflicts: !he(calResult) ? (calResult as CalendarSection).conflicts : [],
      longestFreeBlock: !he(calResult) ? (calResult as CalendarSection).longestFreeBlock : undefined,
      emails: !he(emailResult) ? (emailResult as { items: EmailItem[] }).items : [],
      assignments: !he(assignmentResult) ? (assignmentResult as { items: AssignmentItem[]; totalDue: number }).items : [],
      trackers: !he(trackerResult) ? (trackerResult as { changes: TrackerChange[]; steady: boolean }).changes : [],
    };
  } catch (err) {
    return { error: String(err) };
  }
}

async function buildMarketsSection(): Promise<{ stocks: StockData[]; summary: string } | { error: string }> {
  try {
    const msg = await anthropic.messages.create({
      model: ROUTES.APP_DEFAULT,
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: `Search for current stock prices and today's performance for: XLK (Technology Select Sector SPDR), SCHG (Schwab Large-Cap Growth ETF), MSFT (Microsoft), and SPY (S&P 500 ETF). Get today's price, change amount, and percentage change for each. Also get any major news headline for MSFT.

Return JSON only:
{
  "stocks": [
    {"symbol": "XLK", "name": "Technology Select Sector SPDR", "price": "$XXX.XX", "change": "+$X.XX", "changePct": "+X.XX%", "direction": "up", "news": null},
    {"symbol": "SCHG", "name": "Schwab Large-Cap Growth ETF", "price": "$XXX.XX", "change": "-$X.XX", "changePct": "-X.XX%", "direction": "down", "news": null},
    {"symbol": "MSFT", "name": "Microsoft", "price": "$XXX.XX", "change": "+$X.XX", "changePct": "+X.XX%", "direction": "up", "news": "Brief note on any major news"},
    {"symbol": "SPY", "name": "S&P 500 ETF", "price": "$XXX.XX", "change": "+$X.XX", "changePct": "+X.XX%", "direction": "up", "news": null}
  ],
  "summary": "One sentence market summary"
}`,
      }],
    });

    const textBlock = msg.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const result = extractJson<{ stocks: StockData[]; summary: string }>(textBlock.text);
      if (result) return result;
    }

    return { stocks: [], summary: 'Market data unavailable' };
  } catch (err) {
    return { error: String(err) };
  }
}

async function buildTechAISection(): Promise<TechAISection | { error: string }> {
  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const msg = await anthropic.messages.create({
      model: ROUTES.APP_DEFAULT,
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: `Search for the latest tech and AI news from the last 24-48 hours. Today: ${today}.

Find:
1. 2-3 significant AI/ML stories (model releases, research breakthroughs, AI company news, LLM developments, AI safety)
2. 1-2 tech policy items (regulation, legislation, government AI action, antitrust, EU AI Act, US AI policy)

Filter out minor news and clickbait. Prioritize stories that matter for the AI/tech industry.

Return JSON only:
{
  "aiStories": [
    {"headline": "Story headline", "summary": "Two-sentence summary of what happened and why it matters.", "source": "Publication name", "url": "https://..."}
  ],
  "techPolicy": [
    {"headline": "Story headline", "summary": "Two-sentence summary.", "source": "Publication name", "url": "https://..."}
  ]
}`,
      }],
    });

    const textBlock = msg.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const result = extractJson<TechAISection>(textBlock.text);
      if (result) return result;
    }

    return { aiStories: [], techPolicy: [] };
  } catch (err) {
    return { error: String(err) };
  }
}

async function buildWorldNewsSection(): Promise<WorldNewsSection | { error: string }> {
  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const msg = await anthropic.messages.create({
      model: ROUTES.APP_DEFAULT,
      max_tokens: 1536,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: `Search for the 3-4 most significant US and world news stories from the last 24 hours. Today: ${today}.

Focus on: major political events, economic news, geopolitical developments, significant domestic US news. Exclude tech news (covered separately). Exclude minor or local news.

Return JSON only:
{
  "stories": [
    {"headline": "Story headline", "summary": "Two-sentence summary of what happened and why it matters.", "source": "Publication name", "url": "https://..."}
  ]
}`,
      }],
    });

    const textBlock = msg.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const result = extractJson<WorldNewsSection>(textBlock.text);
      if (result) return result;
    }

    return { stories: [] };
  } catch (err) {
    return { error: String(err) };
  }
}

const MICROSOFT_GUARDRAIL = `CRITICAL RULES (violating these is a bug):
1. Anatole has ALREADY SIGNED the Microsoft Summer 2026 PM return offer. NEVER suggest pursuing a Microsoft internship role. That advice is wrong, outdated, and unhelpful.
2. Full-time Microsoft roles for post-graduation (2027+) are a separate question — those are fair to mention in a clearly labelled future-planning context only.
3. If any draft content suggests a Microsoft internship (e.g. "apply to Microsoft", "try for Microsoft return", "reach out to Microsoft recruiting"), treat it as a hallucination and do not include it.`;

const CAREER_BEAT_GUARDRAIL = `CRITICAL: Anatole's career is a DUAL track at a 2:1 ratio.
- 60-70% weight → Track A "Cracked Tech Builder": AI labs (Anthropic, OpenAI, DeepMind, Mistral), hot AI startups (Cursor, Perplexity, Sierra, Harvey, Cognition, Factory), AI infra (Vercel, LangChain, Pinecone, Modal), voice AI (ElevenLabs, Deepgram), quant (Jane Street, Two Sigma, HRT, Citadel), Big Tech AI orgs.
- 30-40% weight → Track B "AI Policy Heavyweight": policy teams at AI labs (Anthropic Policy, OpenAI Policy), think tanks (RAND, CSET, CNAS, GovAI, Brookings), US AISI, CHAI.

Do NOT over-emphasize policy. The 3-5 opportunities returned should reflect this 2:1 ratio — at most 1-2 should be policy-adjacent. Default gravity is toward tech builder opportunities. If there are 3 opportunities, at most 1 should be policy. If 4-5, at most 2 should be policy.`;

async function buildCareerSection(): Promise<{ opportunities: CareerOpportunity[] } | { error: string }> {
  try {
    let careerContext = `Anatole Seychal — UC Berkeley junior, triple major (Applied Math, Data Science, Political Economy).
Past internships: Microsoft PM (AI Reviewer Agent, Power Apps — Summer 2026 return offer ALREADY SIGNED AND CONFIRMED), PitchBook PM, Nielsen PM, Dialpad PM, Warner Bros consultant.
Interests: AI labs, big tech, tech policy, PM/strategy/research roles.
Target companies for NEW opportunities: OpenAI, Anthropic, DeepMind, Google DeepMind, xAI, Cohere, AI policy orgs, think tanks. NOT Microsoft (already secured).`;

    const profileNote = readNote('01-me/anatole-seychal.md');
    if (profileNote) careerContext = profileNote.content.slice(0, 2000);

    const goalsNote = readNote('01-me/goals-2026.md');
    if (goalsNote) careerContext += '\n\nGoals:\n' + goalsNote.content.slice(0, 800);

    // career-ops pipeline brief (application tracker + followups due)
    const pipelineBrief = await getDailyCareerBrief();

    // Phase 9b: Load confirmed career status from memory so Claude doesn't suggest
    // already-accomplished things (e.g. "try to get return offer" when it's confirmed).
    const confirmedFacts = await loadConfirmedCareerFacts();
    const confirmedBlock = confirmedFacts.length > 0
      ? confirmedFacts
          .map((f) => {
            const freshness = f.lastVerified
              ? ` (verified: ${f.lastVerified}${f.confidence > 0 ? `, confidence: ${f.confidence.toFixed(2)}` : ''})`
              : '';
            return `### ${f.slug}${freshness}\n${f.summary}`;
          })
          .join('\n\n')
      : '(none yet)';

    const msg = await anthropic.messages.create({
      model: ROUTES.APP_DEFAULT,
      max_tokens: 1536,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: `${MICROSOFT_GUARDRAIL}

${CAREER_BEAT_GUARDRAIL}

You are helping Anatole Seychal find relevant career opportunities. Profile:

${careerContext}

CONFIRMED CAREER STATUS (verified facts from persistent memory — authoritative):
${confirmedBlock}

CRITICAL INSTRUCTION: Never suggest applying for, following up on, or "trying to get" anything that is already confirmed in the status above. Those actions are done. Do not suggest actions that contradict confirmed facts. If something is listed as "confirmed", "accepted", "secured", or "signed", treat it as final — do not frame it as pending or aspirational.

${pipelineBrief ? `\nAPPLICATION PIPELINE (from career-ops tracker):\n${pipelineBrief}\n\nDo NOT re-suggest companies already in his pipeline above. If follow-ups are listed as due, include them as high-priority "opportunities" with a note to follow up.\n` : ''}
Search for ONLY NEW opportunities not already covered above. NEVER include Microsoft internship roles (already secured). Valid searches:
1. New internship/job postings at AI labs (OpenAI, Anthropic, DeepMind, Google DeepMind, xAI, Cohere) for PM, research, or strategy roles for undergrads
2. New programs or roles at companies NOT already confirmed in his status
3. Fellowships, research programs, or policy roles at the intersection of tech + AI + policy (RAND, Brookings, Congressional tech fellowships, AI safety orgs)
4. Relevant conferences, hackathons, or networking events in Berkeley/SF area in the next 2 months

Return 3-5 most relevant as JSON:
{
  "opportunities": [
    {
      "title": "Role or program title",
      "company": "Company or organization",
      "relevance": "1-2 sentences on why this is specifically relevant to Anatole",
      "url": "https://...",
      "deadline": "Deadline if known, or null"
    }
  ]
}`,
      }],
    });

    const textBlock = msg.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const result = extractJson<{ opportunities: CareerOpportunity[] }>(textBlock.text);
      if (result) return result;
    }

    return { opportunities: [] };
  } catch (err) {
    return { error: String(err) };
  }
}

async function buildDidYouKnowSection(): Promise<DidYouKnowSection | { error: string }> {
  try {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const categories = ['mathematics', 'etymology', 'history', 'physics', 'philosophy', 'economics', 'linguistics', 'biology'];
    const category = categories[dayOfYear % categories.length];

    const msg = await anthropic.messages.create({
      model: ROUTES.APP_DEFAULT,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Share one genuinely surprising and intellectually stimulating fact about ${category}.

Requirements:
- Not a common trivia fact — something specific and lesser-known
- Verifiable and accurate
- Thought-provoking — ideally reveals something counterintuitive
- 1-2 sentences max

Return JSON only: {"fact": "The fact.", "category": "${category}"}`,
      }],
    });

    const textBlock = msg.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const result = extractJson<DidYouKnowSection>(textBlock.text);
      if (result) return result;
    }

    return { fact: 'Knowledge compounds in unexpected ways.', category };
  } catch (err) {
    return { error: String(err) };
  }
}


async function buildVaultEchoesSection(): Promise<VaultEchoesSection | { error: string }> {
  try {
    const recentNotes = getRecentNotes(3); // last 3 days
    const todayStr = todayDate();
    const dailyNote = readNote(`08-daily/${todayStr}.md`);

    let reflection = 'What thread from your recent thinking deserves more attention?';
    let focusSuggestion = recentNotes[0] ? `Recently updated: ${recentNotes[0].title}` : 'No recent vault activity.';

    const notesSummary = [
      ...recentNotes.slice(0, 5).map((n) => `- ${n.title}`),
      dailyNote ? `\nToday's note:\n${dailyNote.content.slice(0, 400)}` : '',
    ].filter(Boolean).join('\n');

    if (notesSummary.trim()) {
      const msg = await anthropic.messages.create({
        model: ROUTES.APP_DEFAULT,
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `Based on these recent vault notes from Anatole's knowledge base:
${notesSummary}

Generate a brief reflection and focus suggestion. Keep both concrete and specific to the notes.

Return JSON only: {"reflection": "A thought-provoking question about his recent thinking (1 sentence)", "focusSuggestion": "A specific, actionable focus for today based on the notes (1 sentence)"}`,
        }],
      });

      const textBlock = msg.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        const result = extractJson<{ reflection: string; focusSuggestion: string }>(textBlock.text);
        if (result) {
          reflection = result.reflection ?? reflection;
          focusSuggestion = result.focusSuggestion ?? focusSuggestion;
        }
      }
    }

    return {
      recentNotes: recentNotes.slice(0, 5).map((n) => ({
        path: n.path,
        title: n.title,
        modifiedAt: n.modifiedAt.toISOString(),
      })),
      reflection,
      focusSuggestion,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

// ── Highlights extractor ──────────────────────────────────────────────────────

function buildHighlights(content: Omit<BriefingContent, 'highlights'>): Highlight[] {
  const highlights: Highlight[] = [];
  const he = (s: unknown): s is { error: string } => !!s && typeof (s as { error?: string }).error === 'string';

  // Daily recap tone note
  if (!he(content.dailyRecap) && highlights.length < 5) {
    const recap = content.dailyRecap as GoodMorningSection;
    if (recap.toneNote) {
      highlights.push({ section: 'dailyRecap', type: 'vault', text: recap.toneNote });
    }
  }

  // Calendar: first event
  if (!he(content.today)) {
    const today = content.today as TodaySection;
    const nextEvent = today.events?.[0];
    if (nextEvent) {
      const time = nextEvent.allDay
        ? 'All day'
        : new Date(nextEvent.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      highlights.push({ section: 'today', type: 'calendar', text: `${nextEvent.title} · ${time}` });
    }

    // Urgent email
    if (highlights.length < 5) {
      const urgentEmail = today.emails?.find((e) => e.priority === 'HIGH');
      if (urgentEmail) {
        highlights.push({ section: 'today', type: 'email', text: urgentEmail.subject });
      }
    }

    // Urgent assignment
    if (highlights.length < 5) {
      const urgentAsg = today.assignments?.find((a) => a.urgency === 'URGENT');
      if (urgentAsg) {
        highlights.push({ section: 'today', type: 'assignment', text: `Due: ${urgentAsg.title}` });
      }
    }

    // Tracker change
    if (highlights.length < 5) {
      const change = today.trackers?.[0];
      if (change) {
        highlights.push({ section: 'today', type: 'tracker', text: `${change.title}: ${change.from ? `${change.from} → ` : ''}${change.to}` });
      }
    }
  }

  // Markets summary
  if (!he(content.markets) && highlights.length < 5) {
    const markets = content.markets as { stocks: StockData[]; summary: string };
    if (markets.summary) {
      highlights.push({ section: 'markets', type: 'market', text: markets.summary });
    }
  }

  // Top tech/AI story
  if (!he(content.techAI) && highlights.length < 5) {
    const techAI = content.techAI as TechAISection;
    const topStory = techAI.aiStories?.[0] ?? techAI.techPolicy?.[0];
    if (topStory) {
      highlights.push({ section: 'techAI', type: 'news', text: topStory.headline });
    }
  }

  // Career opportunity
  if (!he(content.career) && highlights.length < 5) {
    const career = content.career as { opportunities: CareerOpportunity[] };
    const topOpp = career.opportunities?.[0];
    if (topOpp) {
      highlights.push({ section: 'career', type: 'career', text: `${topOpp.title} @ ${topOpp.company}` });
    }
  }

  // World news as fallback
  if (!he(content.worldNews) && highlights.length < 5) {
    const worldNews = content.worldNews as WorldNewsSection;
    const topStory = worldNews.stories?.[0];
    if (topStory) {
      highlights.push({ section: 'worldNews', type: 'news', text: topStory.headline });
    }
  }

  return highlights.slice(0, 5);
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateBriefing(forDate?: string): Promise<BriefingContent> {
  const date = forDate ?? todayDate();

  // Run all sections in parallel
  const [dailyRecap, today, markets, techAI, worldNews, career, didYouKnow, vaultEchoes] = await Promise.all([
    buildDailyRecapSection(),
    buildTodaySection(),
    buildMarketsSection(),
    buildTechAISection(),
    buildWorldNewsSection(),
    buildCareerSection(),
    buildDidYouKnowSection(),
    buildVaultEchoesSection(),
  ]);

  const partial = { dailyRecap, today, markets, techAI, worldNews, career, didYouKnow, vaultEchoes, generatedAt: new Date().toISOString() };
  const highlights = buildHighlights(partial);

  const content: BriefingContent = { ...partial, highlights };

  await prisma.dailyBriefing.upsert({
    where: { date },
    update: { content: JSON.stringify(content), generatedAt: new Date() },
    create: { date, content: JSON.stringify(content) },
  });

  return content;
}

export async function getOrGenerateBriefing(date: string): Promise<BriefingContent> {
  const existing = await getBriefing(date);
  // Regenerate if missing or using old format (no goodMorning field)
  if (existing && 'dailyRecap' in existing) return existing;
  return generateBriefing(date);
}
