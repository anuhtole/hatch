import { anthropic } from './claude';
import { MODELS } from './models';

/**
 * Generate a concise 4-5 word title for a conversation from its first user
 * message. Calls Haiku (ROUTES.LIGHTWEIGHT). Always returns a non-empty string —
 * on failure or timeout it falls back to a snippet of the first message so
 * the caller can persist it unconditionally.
 *
 * Used by the C2 auto-naming pipeline. Fire-and-forget from the client via
 * POST /api/conversations/[id]/auto-name; never block chat streaming on it.
 */
export async function generateChatTitle(firstUserMessage: string): Promise<string> {
  const trimmed = firstUserMessage.trim().slice(0, 500);
  if (!trimmed) return 'New chat';

  try {
    const res = await anthropic.messages.create(
      {
        model: ROUTES.LIGHTWEIGHT,
        max_tokens: 30,
        system:
          "Generate a concise 4-5 word title for a chat starting with this message. " +
          "Return ONLY the title text, no quotes, no punctuation, no leading or trailing whitespace. " +
          "Examples: 'Inbox triage', 'Solow model intuition', 'Madrid travel plans', " +
          "'Draft investor update'. Maximum 5 words.",
        messages: [{ role: 'user', content: trimmed }],
      },
      { timeout: 5_000 },
    );

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const cleaned = stripWrappingPunctuation(text);
    if (!cleaned) return fallbackSnippet(trimmed);

    const words = cleaned.split(/\s+/);
    if (words.length > 5) return words.slice(0, 5).join(' ');
    return cleaned;
  } catch {
    return fallbackSnippet(trimmed);
  }
}

function stripWrappingPunctuation(s: string): string {
  return s
    .replace(/^[\s"'“”‘’.:-]+/, '')
    .replace(/[\s"'“”‘’.:!?]+$/, '')
    .trim();
}

function fallbackSnippet(message: string): string {
  const words = message.split(/\s+/).slice(0, 5).join(' ');
  return words || 'New chat';
}

// Lightweight namespace import for the Anthropic.TextBlock type without
// pulling the whole SDK type tree into the top-level imports.
import type Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
