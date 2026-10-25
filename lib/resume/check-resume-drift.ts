/**
 * lib/resume/check-resume-drift.ts
 *
 * Drift guard for the TAILORED RÉSUMÉ bullets (complements the numeric provenance
 * check, which only catches grafted numbers). The rephrase step can graft a JD
 * buzzword onto a bullet whose source claim never used it — e.g. a source
 * "anti-fabrication guards" became "anti-fabrication EVAL guards" because "eval"
 * is all over the job description. Numbers-only guarding misses this.
 *
 * Rule, per rephrased bullet:
 *   flag any domain/technique term or named tool/specific that appears in the JD
 *   text but NOT in that bullet's SOURCE CLAIM text (a JD-sourced specific grafted
 *   in = drift). Proper nouns from the source's own entity are allowed; ordinary
 *   rephrasing words (not in the JD) are fine — only JD-jargon / named specifics
 *   are targeted.
 *
 * Reuses the cover-letter guard's lexicon + named-specific extraction verbatim.
 */

import type { CandidatePool } from '@/lib/resume/candidate-pool';
import type { TailoredResume } from '@/lib/resume/tailor';
import { TECH_LEXICON, namedSpecifics } from '@/lib/resume/check-cover-letter';

export interface ResumeDriftFlag {
  sourceId: string;
  bullet: string;
  term: string;
  category: 'jd-term' | 'unknown-source' | 'research-term';
}

export interface ResumeDriftReport {
  bulletCount: number;
  flags: ResumeDriftFlag[];
}

export function checkResumeDrift(
  tailored: TailoredResume,
  pool: CandidatePool,
  jdText: string,
  researchTerms: string[] = [],
): ResumeDriftReport {
  const claimById = new Map(pool.claims.map((c) => [c.id, c]));
  const jdLower = jdText.toLowerCase();
  const research = researchTerms.map((t) => t.toLowerCase()).filter(Boolean);
  const flags: ResumeDriftFlag[] = [];

  for (const b of tailored.provenance) {
    const claim = claimById.get(b.sourceId);
    if (!claim) {
      flags.push({ sourceId: b.sourceId, bullet: b.text, term: b.sourceId, category: 'unknown-source' });
      continue;
    }

    // The bullet's allowed source: its own source claim text + its entity name
    // (e.g. "Microsoft"/"Hatch", which legitimately may be named in a bullet).
    const source = `${claim.text} ${claim.entity ?? ''}`.toLowerCase();
    const bulletLower = b.text.toLowerCase();
    const seen = new Set<string>();

    const flagIfDrift = (term: string, display: string) => {
      // Drift = present in the bullet AND in the JD, but NOT in the source claim.
      if (bulletLower.includes(term) && jdLower.includes(term) && !source.includes(term)) {
        if (!seen.has(term)) {
          seen.add(term);
          flags.push({ sourceId: b.sourceId, bullet: b.text, term: display, category: 'jd-term' });
        }
      }
    };

    // Domain/technique lexicon terms.
    for (const term of TECH_LEXICON) flagIfDrift(term, term);
    // Named tools / proper nouns (only fire when they're JD jargon absent from source).
    for (const pn of namedSpecifics(b.text)) flagIfDrift(pn.toLowerCase(), pn);

    // Research terms are a FLAG set, never an allow-list: a research-brief term that
    // reaches the bullet but is in NEITHER the source claim NOR the JD = containment
    // breach (research leaked into content).
    for (const term of research) {
      if (bulletLower.includes(term) && !source.includes(term) && !jdLower.includes(term)) {
        if (!seen.has(term)) {
          seen.add(term);
          flags.push({ sourceId: b.sourceId, bullet: b.text, term, category: 'research-term' });
        }
      }
    }
  }

  return { bulletCount: tailored.provenance.length, flags };
}
