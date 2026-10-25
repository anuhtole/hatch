/**
 * lib/resume/structured.ts
 *
 * Structured-output helper (B-8). claude-fable-5 rejects FORCED tool_choice
 * ("tool_choice forces tool use is not compatible with this model", verified
 * live 2026-06-10), so the pipeline's structured calls use the API's structured
 * outputs instead: `output_config.format = {type: "json_schema", schema}` — the
 * canonical replacement per the Claude API reference. The response arrives as a
 * single text block of schema-conforming JSON.
 *
 * `strictSchema` deep-adds `additionalProperties: false` to every object node
 * (required by structured outputs). Existing tool input_schemas pass through
 * unchanged otherwise, so call sites keep their schema definitions.
 */

import Anthropic from '@anthropic-ai/sdk';

type JsonSchema = Record<string, unknown>;

/** Deep-clone a JSON schema, adding additionalProperties:false on every object. */
export function strictSchema(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const o = { ...(node as Record<string, unknown>) };
      for (const k of Object.keys(o)) o[k] = walk(o[k]);
      if (o.type === 'object') o.additionalProperties = false;
      return o;
    }
    return node;
  };
  return walk(schema) as JsonSchema;
}

export interface StructuredOpts {
  stage: string; // for failure logging — every WARN names the failing stage
  model: string;
  maxTokens: number;
  prompt: string | Anthropic.MessageParam['content'];
  schema: JsonSchema;
}

/**
 * One structured call: returns the parsed JSON object (typed by the caller), or
 * null when the response carries no parseable text. NEVER silently: every null
 * path logs a WARN with the stage name, stop_reason, and the raw-response head
 * (B-8.1 — a silent null here previously degraded the gap report to an empty
 * coverage table that looked like a result). Callers must either handle null
 * with a printed consequence or fail their stage.
 */
/** Retry a model call through transient overload/rate-limit/5xx (the API returns
 *  529 overloaded_error under load). Exponential backoff; re-throws other errors
 *  and the final attempt. Deterministic delays (no jitter) — Date.now/random are
 *  unavailable in some run contexts and determinism aids debugging. */
export async function withRetry<R>(fn: () => Promise<R>, stage: string, attempts = 5): Promise<R> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const type = (err as { error?: { error?: { type?: string } } })?.error?.error?.type;
      const transient = status === 429 || status === 529 || (typeof status === 'number' && status >= 500) ||
        type === 'overloaded_error' || type === 'rate_limit_error' || /ETIMEDOUT|ECONNRESET|overloaded/i.test(String((err as Error)?.message));
      if (!transient || i === attempts - 1) throw err;
      const waitMs = 2000 * 2 ** i; // 2s, 4s, 8s, 16s
      console.warn(`⚠ [structured:${stage}] transient API error (${type ?? status ?? 'unknown'}) — retry ${i + 1}/${attempts - 1} in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

export async function structuredCreate<T>(opts: StructuredOpts): Promise<T | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const params = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    output_config: { format: { type: 'json_schema', schema: strictSchema(opts.schema) } },
    messages: [{ role: 'user', content: opts.prompt }],
    // output_config is accepted by the API; the installed SDK's param type lags it.
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;
  const msg = await withRetry(() => client.messages.create(params), opts.stage);
  const warn = (why: string, raw = '') =>
    console.warn(
      `⚠ [structured:${opts.stage}] ${why} — stop_reason=${msg.stop_reason}, ` +
      `output_tokens=${msg.usage.output_tokens}/${opts.maxTokens}, blocks=[${msg.content.map((b) => b.type).join(',')}]` +
      (raw ? `, raw head: ${JSON.stringify(raw.slice(0, 200))}` : ''),
    );

  if (msg.stop_reason === 'max_tokens') {
    warn('response TRUNCATED at max_tokens (thinking tokens count against the budget)');
  }
  const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) {
    warn('no text block in response');
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    warn('text block is not parseable JSON (truncation or schema miss)', text);
    return null;
  }
}
