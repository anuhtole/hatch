/**
 * lib/resume/outreach-constants.ts — outreach pacing knobs (B-10).
 * Client-safe (no fs/sdk imports) so the UI can display the limits.
 *
 * // EDIT TO RETAILOR ─────────────────────────────────────────────────────────
 * Pacing limits DRAFTING pressure; sending is already 1:1 human-gated.
 */
export const MAX_DRAFTS_PER_DAY = 3;                // across all labs
export const MIN_HOURS_BETWEEN_SENDS_SAME_LAB = 24; // no new draft while a same-lab send is this fresh

export const OUTREACH_WORDS_MIN = 120;
export const OUTREACH_WORDS_MAX = 180;

// Which last-green artifact gets attached to outreach emails. Either way the
// guard hash-verifies the bytes against last-green.json before any send.
export const OUTREACH_ATTACHMENT_FORMAT: 'pdf' | 'docx' = 'pdf';
