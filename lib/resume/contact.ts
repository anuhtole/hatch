/**
 * lib/resume/contact.ts
 *
 * Loads the grounded résumé header (name + contact line) from the vault's
 * sections/contact.md frontmatter. The header is GROUNDED, never model-generated —
 * the renderer reads these exact strings. Contact records carry kind 'contact' and
 * are excluded from the claim pool (header metadata, not selectable bullets).
 */

import { assembleGroundTruth } from '@/lib/resume/ground-truth';

export interface Contact {
  name: string;
  location: string;
  phone: string;
  email: string;
  linkedin: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Load grounded contact facts, or null if no contact section is present. */
export function loadContact(): Contact | null {
  const gt = assembleGroundTruth();
  const rec = gt.records.find((r) => r.kind === 'contact' && !r.error);
  if (!rec) return null;
  const fm = rec.frontmatter;
  const c: Contact = {
    name: str(fm.name),
    location: str(fm.location),
    phone: str(fm.phone),
    email: str(fm.email),
    linkedin: str(fm.linkedin),
  };
  return c.name ? c : null;
}

/** Contact line segments (pipe-joined in the canonical), in order. */
export function contactSegments(c: Contact): string[] {
  return [c.location, c.phone, c.email, c.linkedin].filter(Boolean);
}
