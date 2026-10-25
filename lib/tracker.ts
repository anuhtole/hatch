import Anthropic from '@anthropic-ai/sdk';
import { prisma } from './prisma';
import { anthropic } from './claude';
import { ROUTES } from '@/lib/models';

export type MonitorType = 'url' | 'search' | 'status' | 'custom';

export interface TrackerConfig {
  url?: string;
  selector?: string;
  query?: string;
  description?: string;
  expectedPattern?: string;
}

export interface CheckResult {
  status: string;
  details?: string;
  confidence?: number;
  currentStepId?: string;   // multi_step: which step is now active
  tailoredMessage?: string; // human-readable one-liner for display
}

// ── Engine ────────────────────────────────────────────────────────────────────

export async function createTracker(data: {
  title: string;
  description?: string;
  category?: string;
  monitorType: MonitorType;
  monitorConfig: TrackerConfig;
  checkFrequency?: string;
  notifyOnChange?: boolean;
  color?: string;
  notes?: string;
  trackerType?: string;
  stepsConfig?: Array<{ id: string; title: string; description?: string }>;
  tailoredMessage?: string;
}) {
  return prisma.tracker.create({
    data: {
      title: data.title,
      description: data.description,
      category: data.category,
      monitorType: data.monitorType,
      monitorConfig: JSON.stringify(data.monitorConfig),
      checkFrequency: data.checkFrequency ?? 'daily',
      notifyOnChange: data.notifyOnChange ?? true,
      color: data.color ?? 'yellow',
      notes: data.notes,
      trackerType: data.trackerType ?? 'binary',
      stepsConfig: data.stepsConfig ? JSON.stringify(data.stepsConfig) : null,
      tailoredMessage: data.tailoredMessage ?? null,
    },
  });
}

export function generateSummaryLine(tracker: {
  checkFrequency: string;
  lastChecked: string | Date | null;
  lastChanged: string | Date | null;
  trackerType: string;
  stepsConfig: string | null;
  currentStepId: string | null;
}): string {
  const parts: string[] = [];

  const freqLabel = tracker.checkFrequency === 'hourly' ? 'hourly'
    : tracker.checkFrequency === 'weekly' ? 'weekly'
    : 'daily';
  parts.push(`Monitoring ${freqLabel}`);

  if (tracker.lastChecked) {
    const ms = Date.now() - new Date(tracker.lastChecked).getTime();
    const mins = Math.floor(ms / 60_000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    const ago = days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : mins > 0 ? `${mins}m ago` : 'just now';
    parts.push(`checked ${ago}`);
  }

  if (tracker.trackerType === 'multi_step' && tracker.stepsConfig) {
    try {
      const steps: Array<{ id: string; title: string }> = JSON.parse(tracker.stepsConfig);
      const idx = tracker.currentStepId ? steps.findIndex((s) => s.id === tracker.currentStepId) : -1;
      if (steps.length > 0) {
        parts.push(`step ${idx >= 0 ? idx + 1 : '?'} of ${steps.length}`);
      }
    } catch {}
  } else if (tracker.lastChanged) {
    const ms = Date.now() - new Date(tracker.lastChanged).getTime();
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.floor(ms / 3_600_000);
    if (days > 0) parts.push(`changed ${days}d ago`);
    else if (hours > 0) parts.push(`changed ${hours}h ago`);
  }

  return parts.join(' · ');
}

export async function checkTracker(trackerId: string): Promise<CheckResult> {
  const tracker = await prisma.tracker.findUnique({ where: { id: trackerId } });
  if (!tracker) throw new Error(`Tracker ${trackerId} not found`);

  const config: TrackerConfig = JSON.parse(tracker.monitorConfig);
  const monitorType = tracker.monitorType as MonitorType;
  const trackerType = tracker.trackerType ?? 'binary';
  const stepsConfig = tracker.stepsConfig
    ? (JSON.parse(tracker.stepsConfig) as Array<{ id: string; title: string; description?: string }>)
    : null;

  // Attempt the check with up to 3 tries (exponential backoff: 2s, 4s between attempts)
  let result: CheckResult | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      switch (monitorType) {
        case 'url':
          result = await checkUrl(config);
          break;
        case 'search':
          result = await checkSearch(tracker.title, config);
          break;
        case 'status':
          result = await checkStatus(tracker.title, config);
          break;
        case 'custom':
        default:
          result = await checkCustom(tracker.title, tracker.description ?? '', config, trackerType, stepsConfig);
          break;
      }
      lastError = null;
      break; // success — exit retry loop
    } catch (err) {
      lastError = String(err);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000)); // 2s, 4s
      }
    }
  }

  // All attempts failed — preserve last-known-good status, record error
  if (result === null || lastError !== null) {
    await prisma.tracker.update({
      where: { id: trackerId },
      data: {
        lastChecked: new Date(),
        lastCheckError: lastError,
        lastCheckAttempt: new Date(),
        consecutiveFails: { increment: 1 },
      },
    });
    await prisma.trackerHistory.create({
      data: { trackerId, status: 'check_failed', details: lastError },
    });
    return { status: tracker.currentStatus ?? 'unknown', details: lastError ?? undefined };
  }

  // Success — persist result, clear error state
  const changed = tracker.currentStatus !== null && tracker.currentStatus !== result.status;
  const stepChanged =
    trackerType === 'multi_step' &&
    !!result.currentStepId &&
    result.currentStepId !== tracker.currentStepId;

  let tailoredMessage = tracker.tailoredMessage;
  if ((tracker.currentStatus === null || changed) && result.tailoredMessage) {
    tailoredMessage = result.tailoredMessage;
  }

  await prisma.tracker.update({
    where: { id: trackerId },
    data: {
      previousStatus: tracker.currentStatus,
      currentStatus: result.status,
      lastChecked: new Date(),
      lastChanged: changed || stepChanged ? new Date() : tracker.lastChanged,
      currentStepId: result.currentStepId ?? tracker.currentStepId,
      tailoredMessage: tailoredMessage ?? undefined,
      lastCheckError: null,
      lastCheckAttempt: new Date(),
      consecutiveFails: 0,
    },
  });

  await prisma.trackerHistory.create({
    data: { trackerId, status: result.status, details: result.details },
  });

  return result;
}

export async function listTrackers(activeOnly?: boolean) {
  return prisma.tracker.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

export async function checkAllActive(): Promise<void> {
  const now = new Date();
  const trackers = await prisma.tracker.findMany({ where: { isActive: true } });

  for (const tracker of trackers) {
    const shouldCheck = isCheckDue(tracker.lastChecked, tracker.checkFrequency, now);
    if (shouldCheck) {
      try {
        await checkTracker(tracker.id);
      } catch {
        // continue with next tracker
      }
    }
  }
}

function isCheckDue(lastChecked: Date | null, frequency: string, now: Date): boolean {
  if (!lastChecked) return true;
  const ms = now.getTime() - lastChecked.getTime();
  const hours = ms / (1000 * 60 * 60);
  switch (frequency) {
    case 'hourly':  return hours >= 1;
    case 'daily':   return hours >= 24;
    case 'weekly':  return hours >= 168;
    default:        return hours >= 24;
  }
}

// ── Monitor type implementations ──────────────────────────────────────────────

async function checkUrl(config: TrackerConfig): Promise<CheckResult> {
  if (!config.url) return { status: 'misconfigured', details: 'No URL specified' };

  const res = await fetch(config.url, { signal: AbortSignal.timeout(10_000) });
  const body = await res.text();
  const status = `HTTP ${res.status}`;

  if (config.selector) {
    const match = body.includes(config.selector);
    return {
      status: match ? `found: ${config.selector}` : `not found: ${config.selector}`,
      details: `Checked ${config.url} — status ${res.status}`,
    };
  }

  if (config.expectedPattern) {
    const re = new RegExp(config.expectedPattern, 'i');
    const match = re.test(body);
    return {
      status: match ? 'pattern matched' : 'pattern not found',
      details: `Checked ${config.url} — ${status}`,
    };
  }

  return { status, details: `${config.url} returned ${res.status}` };
}

async function checkSearch(title: string, config: TrackerConfig): Promise<CheckResult> {
  const query = config.query ?? title;
  const msg = await anthropic.messages.create({
    model: ROUTES.LIGHTWEIGHT,
    max_tokens: 256,
    tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
    messages: [
      {
        role: 'user',
        content: `Search for: "${query}". Summarize the current status in one sentence. Return JSON: {"status": "<one-line status>", "details": "<2-3 sentences of context>"}`,
      },
    ],
  });

  return extractJsonFromResponse(msg.content) ?? {
    status: 'checked',
    details: `Searched for "${query}"`,
  };
}

async function checkStatus(title: string, config: TrackerConfig): Promise<CheckResult> {
  const description = config.description ?? title;
  const msg = await anthropic.messages.create({
    model: ROUTES.LIGHTWEIGHT,
    max_tokens: 256,
    tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
    messages: [
      {
        role: 'user',
        content: `What is the current status of: "${description}"? Be concise. Return JSON: {"status": "<short status label>", "details": "<2-3 sentences>", "confidence": <0-1>}`,
      },
    ],
  });

  return extractJsonFromResponse(msg.content) ?? {
    status: 'unknown',
    details: `Could not determine status of "${description}"`,
    confidence: 0,
  };
}

async function checkCustom(
  title: string,
  description: string,
  config: TrackerConfig,
  trackerType: string = 'binary',
  stepsConfig: Array<{ id: string; title: string; description?: string }> | null = null,
): Promise<CheckResult> {
  const prompt = config.description ?? description ?? title;

  let content: string;
  if (trackerType === 'multi_step' && stepsConfig && stepsConfig.length > 0) {
    const stepsJson = JSON.stringify(stepsConfig);
    content = `Monitor this multi-step process: "${prompt}"

Steps: ${stepsJson}

Search for the latest information and determine:
1. The overall current status (concise label)
2. Which step is currently active (return the step's "id" field)
3. A short human-readable summary (tailoredMessage)

Return JSON only: {"status": "<concise status>", "details": "<what you found, 2-4 sentences>", "confidence": <0-1>, "currentStepId": "<step id or null>", "tailoredMessage": "<one sentence>"}`;
  } else {
    content = `Monitor this item: "${prompt}"

Search for the latest information and determine the current status. Write a short, direct tailoredMessage (one sentence) that summarizes the current state in plain language.

Return JSON only: {"status": "<concise status>", "details": "<what you found, 2-4 sentences>", "confidence": <0-1>, "tailoredMessage": "<one sentence summary>"}`;
  }

  const msg = await anthropic.messages.create({
    model: ROUTES.LIGHTWEIGHT,
    max_tokens: 512,
    tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }],
  });

  return extractJsonFromResponse(msg.content) ?? {
    status: 'checked',
    details: `Checked "${title}"`,
    confidence: 0.5,
  };
}

function extractJsonFromResponse(content: Anthropic.ContentBlock[]): CheckResult | null {
  for (const block of content) {
    if (block.type === 'text') {
      const match = block.text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as CheckResult;
        } catch {
          // continue
        }
      }
    }
  }
  return null;
}

function extractJsonText<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

// Dice coefficient bigram similarity — returns 0..1
export function similarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const bigrams = (s: string) => {
    const n = normalize(s);
    const out: string[] = [];
    for (let i = 0; i < n.length - 1; i++) out.push(n.slice(i, i + 2));
    return out;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.length === 0 && bb.length === 0) return 1;
  if (ba.length === 0 || bb.length === 0) return 0;
  const setB = new Map<string, number>();
  for (const g of bb) setB.set(g, (setB.get(g) ?? 0) + 1);
  let matches = 0;
  for (const g of ba) {
    const count = setB.get(g) ?? 0;
    if (count > 0) { matches++; setB.set(g, count - 1); }
  }
  return (2 * matches) / (ba.length + bb.length);
}

export type ReanalyzeResult = {
  trackerType: 'binary' | 'multi_step';
  steps: Array<{ id: string; title: string; description?: string }> | null;
  currentStepId: string | null;
  monitorType: string;
  monitorConfig: Record<string, string>;
};

export type TrackerMetaResult = {
  summaryLine: string;
  tailoredMessage: string;
};

// Re-analyzes tracker scope based on current title/description.
// Returns the new configuration — does NOT write to DB.
export async function reanalyzeTracker(tracker: {
  title: string;
  description: string | null;
}): Promise<ReanalyzeResult> {
  const msg = await anthropic.messages.create({
    model: ROUTES.LIGHTWEIGHT,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are reanalyzing an existing tracker because the user just updated its description. Determine based on the NEW description:

1. Is this a BINARY tracker (one-state check: open/closed, available/not, yes/no)? Or MULTI-STEP (sequential stages of a process)?
2. If multi-step, what are the 3-7 logical steps?
3. What search query or description should be used to check the status?

Tracker:
- Title: ${tracker.title}
- Description: ${tracker.description ?? ''}

Use "multi_step" when tracking a process with ordered stages (job application, visa, enrollment, scholarship cycle, etc.). Use "binary" for everything else.

Respond with ONLY valid JSON, no prose, no markdown:
{
  "trackerType": "binary" or "multi_step",
  "steps": [{"id": "kebab_id", "title": "Step title", "description": "Short step description"}] or null,
  "currentStepId": "kebab_id_of_current_step" or null,
  "monitorType": "custom",
  "monitorConfig": {"query": "web search query to check this", "description": "what to look for"}
}`,
    }],
  });

  const textBlock = msg.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('reanalyzeTracker: no text in response');

  const parsed = extractJsonText<ReanalyzeResult>(textBlock.text);
  if (!parsed) throw new Error('reanalyzeTracker: could not parse JSON from response');

  return parsed;
}

// Generates a human-readable summaryLine + tailoredMessage for a tracker.
// Does NOT write to DB.
export async function regenerateTrackerMeta(tracker: {
  title: string;
  description: string | null;
  trackerType: string;
  currentStatus: string | null;
  currentStepId: string | null;
  stepsConfig: string | null;
}): Promise<TrackerMetaResult> {
  const stepsContext = tracker.trackerType === 'multi_step' && tracker.stepsConfig
    ? `Steps: ${tracker.stepsConfig}`
    : '';

  const msg = await anthropic.messages.create({
    model: ROUTES.LIGHTWEIGHT,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Generate a summary line and tailored message for this tracker.

Tracker:
- Title: ${tracker.title}
- Description: ${tracker.description ?? ''}
- Type: ${tracker.trackerType}
- Current status: ${tracker.currentStatus ?? 'pending first check'}
${tracker.currentStepId ? `- Current step: ${tracker.currentStepId}` : ''}
${stepsContext}

Rules:
- NO emojis. NO fluff. Editorial tone — clean and direct.
- summaryLine: one sentence with **bold** on the most important part. Should feel like a news lede.
- tailoredMessage: 1-2 sentences in plain language. What is Hatch watching for and what should the user expect?

Respond with ONLY valid JSON:
{"summaryLine": "...", "tailoredMessage": "..."}`,
    }],
  });

  const textBlock = msg.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('regenerateTrackerMeta: no text');

  const parsed = extractJsonText<TrackerMetaResult>(textBlock.text);
  if (!parsed) throw new Error('regenerateTrackerMeta: could not parse JSON');

  return parsed;
}
