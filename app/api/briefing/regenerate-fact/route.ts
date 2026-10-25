import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { anthropic } from '@/lib/claude';
import { todayDate, getBriefing, type BriefingContent, type DidYouKnowSection } from '@/lib/daily-briefing';
import { ROUTES } from '@/lib/models';

export const maxDuration = 60;

function extractJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

export async function POST() {
  try {
    const date = todayDate();
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const categories = ['mathematics', 'etymology', 'history', 'physics', 'philosophy', 'economics', 'linguistics', 'biology', 'astronomy', 'psychology'];
    // Pick a random category different from the day's default
    const randomOffset = Math.floor(Math.random() * (categories.length - 1)) + 1;
    const category = categories[(dayOfYear + randomOffset) % categories.length];

    const msg = await anthropic.messages.create({
      model: ROUTES.LIGHTWEIGHT,
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

    let didYouKnow: DidYouKnowSection = { fact: 'Knowledge compounds in unexpected ways.', category };

    const textBlock = msg.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const result = extractJson<DidYouKnowSection>(textBlock.text);
      if (result) didYouKnow = result;
    }

    // Update stored briefing
    const existing = await getBriefing(date);
    if (existing) {
      const updated: BriefingContent = { ...existing, didYouKnow };
      await prisma.dailyBriefing.update({
        where: { date },
        data: { content: JSON.stringify(updated) },
      });
    }

    return NextResponse.json({ didYouKnow });
  } catch (err) {
    console.error('[briefing/regenerate-fact]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
