import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { getApplicationsPipeline } from '@/lib/career-ops';
import { ROUTES } from '@/lib/models';

const client = new Anthropic();

function currentISOWeek(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-${String(week).padStart(2, '0')}`;
}

// POST — generate a fresh batch of suggestions for the current week
export async function POST() {
  try {
    const weekOf = currentISOWeek();

    // Check if already generated this week
    const existing = await prisma.careerSuggestion.count({ where: { weekOf } });
    if (existing > 0) {
      const suggestions = await prisma.careerSuggestion.findMany({ where: { weekOf }, orderBy: { createdAt: 'asc' } });
      return NextResponse.json({ suggestions, weekOf, cached: true });
    }

    // Pull pipeline context
    const pipeline = await getApplicationsPipeline().catch(() => ({ total: 0, byStatus: {} as Record<string, number>, applications: [] }));
    const pipelineContext = Object.entries(pipeline.byStatus)
      .map(([s, n]) => `${n} ${s}`)
      .join(', ') || 'no applications yet';

    const systemPrompt = `You are a career advisor for Anatole Seychal — UC Berkeley junior (Applied Math, Data Science, Political Economy). His applications pipeline: ${pipelineContext}.

CRITICAL BALANCE RULE: Anatole pursues a DUAL-TRACK career strategy:
- Track A (60-70% weight): "Cracked Tech Builder" — AI labs (Anthropic, OpenAI, DeepMind, Mistral, Cohere, xAI), hot AI startups (Cursor, Perplexity, Sierra, Harvey, Cognition, Factory), AI infra (Vercel, LangChain, Pinecone, Modal), voice AI (ElevenLabs, Deepgram), quant (Jane Street, Two Sigma, HRT, Citadel), Big Tech AI orgs. Goal: technical credibility, product sense, startup hustle.
- Track B (30-40% weight): "AI Policy Heavyweight" — policy teams at AI labs (Anthropic Policy, OpenAI Policy), think tanks (RAND, CSET, CNAS, Brookings, GovAI), US AISI, CHAI. Goal: rare intersection of technical + policy credibility.

For each of the 3 categories (skill, network, content), apply this ratio:
- 2 suggestions should advance Track A (tech/cracked)
- 1 suggestion should advance Track B (policy)

NEVER generate more than 1 policy suggestion per category. Anatole's PolEcon concentration already keeps him exposed to policy — Hatch must ensure the tech builder track doesn't get neglected.

Generate exactly 9 career suggestions for this week — 3 per category (skill, network, content). Each must be specific and actionable.

Return JSON array: [{"category":"skill"|"network"|"content","title":"...","body":"...","priority":"high"|"medium"|"low","actionLabel":"...optional CTA..."}]

Keep title under 60 chars. Body 1-2 sentences. Be concrete — name specific people, orgs, skills, or content ideas.`;

    const msg = await client.messages.create({
      model: ROUTES.LIGHTWEIGHT,
      max_tokens: 1200,
      messages: [{ role: 'user', content: 'Generate this week\'s career suggestions.' }],
      system: systemPrompt,
    });

    const raw = (msg.content[0] as { type: string; text: string }).text;
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in Claude response');

    const items = JSON.parse(jsonMatch[0]) as Array<{
      category: string;
      title: string;
      body: string;
      priority?: string;
      actionLabel?: string;
    }>;

    const suggestions = await Promise.all(
      items.map((item) =>
        prisma.careerSuggestion.create({
          data: {
            weekOf,
            category: item.category,
            title: item.title,
            body: item.body,
            priority: item.priority ?? 'medium',
            status: 'open',
            actionLabel: item.actionLabel ?? null,
          },
        })
      )
    );

    return NextResponse.json({ suggestions, weekOf, cached: false });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
