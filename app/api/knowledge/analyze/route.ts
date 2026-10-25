/**
 * app/api/knowledge/analyze/route.ts
 *
 * POST { text: string, filename: string }
 * → { summary: string, suggestedTags: string[] }
 *
 * Calls Claude to produce a concise summary + relevant tags for the ingestion
 * review modal. Fast — uses haiku for speed.
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';

const client = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { text, filename } = (await req.json()) as { text?: string; filename?: string };

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    // Truncate to ~8k chars so we stay within a fast, cheap token budget
    const excerpt = text.length > 8000 ? text.slice(0, 8000) + '\n\n[…truncated]' : text;

    const message = await client.messages.create({
      model: ROUTES.LIGHTWEIGHT,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `You are a knowledge-base assistant. Given the document below, return ONLY valid JSON with this shape:
{
  "summary": "<2-3 sentence summary of what this document is about and why it's useful>",
  "suggestedTags": ["<tag1>", "<tag2>", ...]
}

Suggested tags should be short (1-2 words), lowercase, relevant to the content (topics, type, course name, etc). Return 3-6 tags.

Filename: ${filename ?? 'unknown'}

Document:
${excerpt}`,
        },
      ],
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '{}';

    // Parse — strip code fences if Claude wrapped it
    const jsonStr = raw.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim();
    const result = JSON.parse(jsonStr) as { summary: string; suggestedTags: string[] };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[knowledge/analyze]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
