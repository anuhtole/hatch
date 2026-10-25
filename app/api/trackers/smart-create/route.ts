import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/claude';
import { createTracker, checkTracker } from '@/lib/tracker';
import { prisma } from '@/lib/prisma';
import { ROUTES } from '@/lib/models';

type StepDef = { id: string; title: string; description?: string };

export const maxDuration = 60;

function extractJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

// Dice coefficient bigram similarity — returns 0..1
function similarity(a: string, b: string): number {
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

export async function POST(req: NextRequest) {
  try {
    const { title, description } = await req.json();
    if (!title?.trim() || !description?.trim()) {
      return NextResponse.json({ error: 'title and description are required' }, { status: 400 });
    }

    // Dedup: check for similar tracker created in the last 60 seconds
    const cutoff = new Date(Date.now() - 60_000);
    const recent = await prisma.tracker.findMany({ where: { createdAt: { gte: cutoff } } });
    const duplicate = recent.find((t) => similarity(t.title, title.trim()) > 0.85);
    if (duplicate) {
      return NextResponse.json(duplicate, { status: 200 });
    }

    // Ask Claude to parse the description and determine tracker parameters
    const msg = await anthropic.messages.create({
      model: ROUTES.LIGHTWEIGHT,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are configuring a tracker for a personal AI assistant. Given the title and description below, determine the best configuration.

Title: "${title}"
Description: "${description}"

Determine:
- monitorType: one of "custom" (Claude + web search, best for most things), "search" (web search query), "url" (HTTP check), "status" (current state lookup)
- monitorConfig: { url?: string, query?: string, description?: string } — populate the most relevant fields
- checkFrequency: "hourly" | "daily" | "weekly"
- category: a short tag like "Academic", "Career", "Markets", "Health", "News", "Tech", or null
- color: "yellow" | "green" | "blue" | "red" | "purple"
- trackerType: "binary" or "multi_step"
  - Use "multi_step" when the thing being tracked is a process with ordered stages (e.g. job application pipeline, visa application, software release, enrollment process)
  - Use "binary" for everything else (open/closed, up/down, published/not, changed/unchanged)
- stepsConfig: if trackerType is "multi_step", an array of steps in order: [{ "id": "step_1", "title": "...", "description": "..." }, ...]
  - Include 3-7 steps that represent real stages of the process
  - If trackerType is "binary", set stepsConfig to null
- tailoredMessage: a single short sentence (max 15 words) that describes what this tracker is watching for in plain language

Rules:
- Use "custom" for anything requiring reasoning (job apps, application status, deadlines, general topics)
- Use "url" only if description mentions a specific URL to check
- Use "search" if description is clearly a web search query
- For color: yellow = general/academic, blue = career/professional, green = health/positive, red = urgent/markets, purple = projects
- Set description in monitorConfig to a clear instruction for what to check

Return JSON only: { "monitorType": "...", "monitorConfig": { ... }, "checkFrequency": "...", "category": "...", "color": "...", "trackerType": "...", "stepsConfig": [...] | null, "tailoredMessage": "..." }`,
      }],
    });

    const textBlock = msg.content.find((b) => b.type === 'text');
    let parsed: {
      monitorType: string;
      monitorConfig: Record<string, string>;
      checkFrequency: string;
      category: string | null;
      color: string;
      trackerType: string;
      stepsConfig: StepDef[] | null;
      tailoredMessage: string;
    } | null = null;

    if (textBlock && textBlock.type === 'text') {
      parsed = extractJson(textBlock.text);
    }

    const monitorType = (parsed?.monitorType ?? 'custom') as 'url' | 'search' | 'status' | 'custom';
    const monitorConfig = parsed?.monitorConfig ?? { description };
    const checkFrequency = parsed?.checkFrequency ?? 'daily';
    const category = parsed?.category ?? undefined;
    const color = parsed?.color ?? 'yellow';
    const trackerType = parsed?.trackerType ?? 'binary';
    const stepsConfig = parsed?.stepsConfig ?? undefined;
    const tailoredMessage = parsed?.tailoredMessage ?? undefined;

    const tracker = await createTracker({
      title: title.trim(),
      description: description.trim(),
      category,
      monitorType,
      monitorConfig,
      checkFrequency,
      color,
      trackerType,
      stepsConfig: stepsConfig ?? undefined,
      tailoredMessage,
    });

    // Run initial check in background (don't block the response)
    checkTracker(tracker.id).catch(() => {});

    return NextResponse.json(tracker, { status: 201 });
  } catch (err) {
    console.error('[trackers/smart-create]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
