/**
 * lib/models.ts — single source of truth for Anthropic model selection.
 *
 * NAMED ROUTES (B-8). Every call site imports its route from here; ZERO hardcoded
 * model strings may exist outside this file (enforced by `npm run guard:models`).
 *
 * ── EDIT TO REROUTE ─────────────────────────────────────────────────────────────
 *   RESUME_PIPELINE — all résumé stages: SELECT, REPHRASE, cover-letter,
 *                     gap-report, research synthesis, visual QA (vision support
 *                     on claude-fable-5 confirmed live via the Models API:
 *                     image_input.supported=true, 2026-06-10).
 *   APP_DEFAULT     — chat agent, briefing, memory/vault writers, file extraction,
 *                     enrichment: anything user-facing or judgment-heavy.
 *   LIGHTWEIGHT     — explicitly-listed cheap sites only: extraction,
 *                     classification, short structured outputs (tracker checks,
 *                     memory refresh, auto-naming, career suggestion/outreach
 *                     drafts, smart-create, fact regeneration, knowledge tagging).
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * API-surface note (verified against the Claude API reference, 2026-06):
 * claude-fable-5 and claude-opus-4-8 REJECT sampling parameters (`temperature`,
 * `top_p`, `top_k`) and `thinking:{type:"enabled"}` with a 400 (Fable also rejects
 * an explicit `thinking:{type:"disabled"}` — omit the param). Call sites on these
 * routes must not send them — ranking determinism relies on stable tiebreaks
 * (dedupe-keep-first), not temperature 0.
 */

export const ROUTES = {
  // Rerouted 2026-06-16: claude-fable-5 access was gated by the API ("not
  // available, use Opus 4.8"). Opus 4.8 carries vision (the visual QA gate) +
  // forced-tool structured outputs and rejects the same sampling params, so call
  // sites need no other change.
  RESUME_PIPELINE: 'claude-opus-4-8',
  APP_DEFAULT: 'claude-opus-4-8',
  LIGHTWEIGHT: 'claude-sonnet-4-6',
} as const;

export type ModelRoute = keyof typeof ROUTES;

/**
 * @deprecated Legacy tiers, kept ONLY so lib/career-ops.ts (retired module — do
 * not touch) keeps compiling unchanged. CHAT/DEEP map to APP_DEFAULT, FAST to
 * LIGHTWEIGHT. New code imports ROUTES.
 */
export const MODELS = {
  CHAT: ROUTES.APP_DEFAULT,
  DEEP: ROUTES.APP_DEFAULT,
  FAST: ROUTES.LIGHTWEIGHT,
} as const;

export type ModelTier = keyof typeof MODELS;
