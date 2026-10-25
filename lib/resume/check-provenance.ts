/**
 * lib/resume/check-provenance.ts
 *
 * The anti-fabrication guard (a partial Phase-4 check, runnable now). Given the
 * candidate pool and a TailoredResume, it asserts for EVERY rendered bullet:
 *   (a) its sourceId exists in the pool's claim ids;
 *   (b) every numeric token in the bullet text also appears in that source
 *       claim's text/metrics — a number in a bullet that is absent from its
 *       source is a fabrication violation.
 *
 * Numbers are compared by their comma-stripped numeric core (so "10+" ↔ "10"
 * and "200,000+" ↔ "200000" are accepted formatting, while a genuinely new
 * number is caught). Equality on the core — not substring — so "20" does not
 * silently pass against a source "200000".
 */

import type { CandidatePool } from '@/lib/resume/candidate-pool';
import type { TailoredResume } from '@/lib/resume/tailor';

export interface ProvenanceViolation {
  sourceId: string;
  bullet: string;
  reason: 'unknown-source-id' | 'unsourced-number';
  detail?: string; // the offending number(s)
}

export interface ProvenanceReport {
  bulletCount: number;
  violations: ProvenanceViolation[];
  droppedUnknownIds: string[];
}

/** Comma-stripped numeric cores in a string, e.g. "200,000+ / 35%" → ["200000","35"]. */
function numericCores(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    out.push(m[0].replace(/,/g, ''));
  }
  return out;
}

export function checkProvenance(pool: CandidatePool, tailored: TailoredResume): ProvenanceReport {
  const claimById = new Map(pool.claims.map((c) => [c.id, c]));
  const violations: ProvenanceViolation[] = [];

  for (const { sourceId, text } of tailored.provenance) {
    const claim = claimById.get(sourceId);

    // (a) sourceId must exist in the pool.
    if (!claim) {
      violations.push({ sourceId, bullet: text, reason: 'unknown-source-id' });
      continue;
    }

    // (b) every numeric core in the bullet must appear in the source's text+metrics.
    const allowed = new Set(numericCores(`${claim.text} ${claim.metrics.join(' ')}`));
    const offending = numericCores(text).filter((n) => !allowed.has(n));
    if (offending.length > 0) {
      violations.push({
        sourceId,
        bullet: text,
        reason: 'unsourced-number',
        detail: offending.join(', '),
      });
    }
  }

  return {
    bulletCount: tailored.provenance.length,
    violations,
    droppedUnknownIds: tailored.droppedUnknownIds,
  };
}
