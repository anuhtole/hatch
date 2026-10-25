/**
 * UI feature flags — single source of truth for hiding dashboard sections.
 *
 * The 2026-06 product pivot focuses Hatch on deep chat with persistent
 * memory and agent tool execution. Career and the right-rail dashboard
 * modules are hidden from the UI without touching the DB tables, API
 * routes, or component files — flip a flag back to `true` to restore.
 */
export const FEATURES = {
  CAREER:      false,
  BRIEFING:    false,
  TASKS:       false,
  MARKETS:     false,
  TRACKERS:    false,
  ASSIGNMENTS: false,
} as const;

// True when at least one right-rail module is enabled. The AmbientPanel and
// its column-toggle are hidden entirely when this is false.
export const ANY_RAIL_MODULE_ENABLED =
  FEATURES.BRIEFING ||
  FEATURES.ASSIGNMENTS ||
  FEATURES.MARKETS ||
  FEATURES.TRACKERS ||
  FEATURES.TASKS;
