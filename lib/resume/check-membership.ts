/**
 * lib/resume/check-membership.ts
 *
 * Membership guard for the Education + Additional render data. STRONGER than the
 * drift guard: it asserts EXACT SET MEMBERSHIP — every rendered course / skill /
 * language / degree / interest must be a character-exact member of its grounded set
 * (recomputed from ground-truth), and no study-list skill ("skills to learn") may
 * leak into the rendered selection. Any violation ⇒ non-zero exit (gate fails).
 *
 * Reads:  out/edu-additional-selection.json  (the exact strings to render)
 *         out/skills-to-learn.json           (the never-rendered study list)
 * Truth:  groundedSections(buildCandidatePool())  — same extractor the tailor uses.
 *
 * Run:  npx tsx lib/resume/check-membership.ts   (npm run guard:membership)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildCandidatePool, type CandidatePool } from '@/lib/resume/candidate-pool';
import { groundedSections, aliasTraces, type SectionSelection } from '@/lib/resume/tailor-sections';
import { resolveOutDir } from '@/lib/resume/out-dir';
import { compareProfessional, compareResearchProject, minBulletsFor, priorityRank } from '@/lib/resume/composition';
import type { ResumeDoc } from '@/lib/resume/render-docx';
import type { CompositionEntity } from '@/lib/resume/tailor';

export interface MembershipViolation {
  field: string;
  value: string;
  reason: string;
}

export interface MembershipReport {
  violations: MembershipViolation[];
  checked: Record<string, number>;
}

/**
 * Validate a rendered selection against the grounded sets. `skillsToLearn` is the
 * study list that must NOT appear anywhere in the rendered selection.
 */
export function checkMembership(
  selection: SectionSelection,
  skillsToLearn: string[],
): MembershipReport {
  const pool = buildCandidatePool();
  const g = groundedSections(pool);
  const v: MembershipViolation[] = [];

  const degreeSet = new Set(g.degrees);
  const courseSet = new Set(g.coursework);     // relevant ∪ canvas
  const skillSet = new Set(g.skills);          // grounded skills set
  const langSet = new Set(g.languages);        // 2 — validated against its OWN set
  const interestSet = new Set(g.interests);    // 11

  // Degrees — exact members.
  for (const d of selection.degrees) {
    if (!degreeSet.has(d)) v.push({ field: 'degree', value: d, reason: 'not in grounded degrees' });
  }
  // School name + grad year — derive (substring) from the grounded school claim.
  if (!g.schoolClaim.includes(selection.schoolName) || !selection.schoolName)
    v.push({ field: 'schoolName', value: selection.schoolName, reason: 'not a substring of grounded school claim' });
  if (!g.schoolClaim.includes(selection.gradYear) || !selection.gradYear)
    v.push({ field: 'gradYear', value: selection.gradYear, reason: 'not a substring of grounded school claim' });

  // Coursework — exact members of the grounded DISPLAY-name universe (canvas excluded).
  for (const c of selection.coursework) {
    if (!courseSet.has(c)) v.push({ field: 'coursework', value: c, reason: 'not in grounded coursework display universe' });
  }
  // Alias-tracing — every display alias must trace to its original CV name (no new
  // tech/domain token, no level/scope change). Guards the vault aliases themselves.
  for (const { original, display } of g.courseAliases) {
    if (!aliasTraces(original, display))
      v.push({ field: 'course-alias', value: `${original} → ${display}`, reason: 'alias introduces a word not traceable to the original' });
  }
  // Skills — exact members of the 23 (validated separately from languages, though
  // they share one rendered line).
  for (const s of selection.skills) {
    if (!skillSet.has(s)) v.push({ field: 'skill', value: s, reason: 'not in grounded skills set' });
  }
  // Languages — exact members of the 2.
  for (const l of selection.languages) {
    if (!langSet.has(l)) v.push({ field: 'language', value: l, reason: 'not in grounded languages (2)' });
  }
  // Interests — exact members of the 11.
  for (const i of selection.interests) {
    if (!interestSet.has(i)) v.push({ field: 'interest', value: i, reason: 'not in grounded interests (11)' });
  }

  // Study-list leak — no "skill to learn" may appear in the rendered skills (exact,
  // case-insensitive) — it must never reach the document.
  const renderedSkillsLower = new Set(selection.skills.map((s) => s.toLowerCase()));
  for (const s of skillsToLearn) {
    if (renderedSkillsLower.has(s.toLowerCase()))
      v.push({ field: 'skills-to-learn-leak', value: s, reason: 'study-list skill leaked into rendered selection' });
  }

  return {
    violations: v,
    checked: {
      degrees: selection.degrees.length,
      coursework: selection.coursework.length,
      skills: selection.skills.length,
      languages: selection.languages.length,
      interests: selection.interests.length,
      skillsToLearn: skillsToLearn.length,
    },
  };
}

/**
 * B-14 SECTION-SKELETON assertions (composition contract + priority roster).
 * Recomputes the deterministic skeleton from the pool's vault metadata and
 * asserts the rendered doc is a valid PRIORITY-FITTED subset:
 *   - rendered entries are a subsequence of the section roster (render order
 *     preserved: professional reverse-chron, research canonical);
 *   - PRIORITY-PREFIX: every OMITTED entry is lower-priority (higher rank) than
 *     every KEPT entry — omission only ever happens from the priority tail
 *     (B-14 part 3 one-page roster fit), never an arbitrary deletion;
 *   - no cross-section movement (an entity renders ONLY in its metadata section);
 *   - per-entry bullet floors for KEPT entries, net of any TRUTHFUL deficit.
 * A run that drops NO entries (full roster fits) reduces to the original exact-
 * roster assertion.
 */
export function checkComposition(
  pool: CandidatePool,
  doc: Pick<ResumeDoc, 'experience' | 'projects'>,
  composition: CompositionEntity[],
): MembershipViolation[] {
  const v: MembershipViolation[] = [];
  const deficitByEntity = new Map(composition.map((c) => [c.entity, c.deficit]));

  for (const [section, rendered] of [
    ['professional', doc.experience],
    ['research-project', doc.projects],
  ] as const) {
    const roster = pool.entities
      .filter((e) => e.section === section && (e.kind === 'experience' || e.kind === 'project'))
      .sort(section === 'professional' ? compareProfessional : compareResearchProject);

    const renderedNames = rendered.map((e) => e.company);
    const rosterByName = new Map(roster.map((e) => [e.name, e]));

    // Every rendered entry must be a known roster member of THIS section.
    const unknown = renderedNames.filter((n) => !rosterByName.has(n));
    if (unknown.length) {
      v.push({ field: `skeleton.${section}`, value: unknown.join(' | '), reason: `rendered entry not in this section's vault roster` });
      continue;
    }
    // Render order must be a SUBSEQUENCE of the roster order (no reordering).
    const rosterIdx = (n: string) => roster.findIndex((e) => e.name === n);
    let prev = -1, ordered = true;
    for (const n of renderedNames) { const idx = rosterIdx(n); if (idx <= prev) { ordered = false; break; } prev = idx; }
    if (!ordered) {
      v.push({ field: `skeleton.${section}.order`, value: renderedNames.join(' | '), reason: `render order is not the canonical roster subsequence: ${roster.map((e) => e.name).join(' | ')}` });
    }
    // PRIORITY-PREFIX: omitted entries must all rank below kept entries.
    const keptSet = new Set(renderedNames);
    const kept = roster.filter((e) => keptSet.has(e.name));
    const omitted = roster.filter((e) => !keptSet.has(e.name));
    if (omitted.length) {
      const maxKeptRank = Math.max(...kept.map((e) => priorityRank(e.sourcePath)));
      for (const o of omitted) {
        if (priorityRank(o.sourcePath) < maxKeptRank) {
          v.push({ field: `skeleton.${section}.priority`, value: o.name, reason: `omitted but higher-priority than a kept entry — roster fit must drop from the priority tail only` });
        }
      }
    }
    // Floors for KEPT entries (net of truthful deficit).
    rendered.forEach((e) => {
      const meta = rosterByName.get(e.company)!;
      const min = minBulletsFor(meta.sourcePath);
      const deficit = deficitByEntity.get(meta.name) ?? 0;
      const floor = Math.max(0, min - deficit);
      if (e.bullets.length < floor) {
        v.push({ field: `skeleton.${section}.minBullets`, value: `${meta.name}: ${e.bullets.length}`, reason: `below floor ${min}${deficit ? ` (truthful deficit ${deficit} → effective ${floor})` : ''}` });
      }
    });
  }

  // Cross-section: no entity may render in the other section's array.
  const bySection = new Map(pool.entities.map((e) => [e.name, e.section]));
  for (const e of doc.experience) {
    const s = bySection.get(e.company);
    if (s && s !== 'professional') {
      v.push({ field: 'skeleton.crossSection', value: e.company, reason: `metadata section is ${s} but rendered under Professional Experience` });
    }
  }
  for (const e of doc.projects) {
    const s = bySection.get(e.company);
    if (s && s !== 'research-project') {
      v.push({ field: 'skeleton.crossSection', value: e.company, reason: `metadata section is ${s} but rendered under Research & Project Experience` });
    }
  }
  return v;
}

// ── Runnable ────────────────────────────────────────────────────────────────────

function main(): void {
  const outDir = resolveOutDir();
  const selPath = join(outDir, 'edu-additional-selection.json');
  const learnPath = join(outDir, 'skills-to-learn.json');

  let selection: SectionSelection;
  let skillsToLearn: string[];
  try {
    selection = JSON.parse(readFileSync(selPath, 'utf-8')) as SectionSelection;
  } catch {
    console.error(`[check-membership] FAIL: cannot read ${selPath} — run the tailor fixture first.`);
    process.exit(2);
    return;
  }
  try {
    skillsToLearn = JSON.parse(readFileSync(learnPath, 'utf-8')) as string[];
  } catch {
    skillsToLearn = [];
  }

  const report = checkMembership(selection, skillsToLearn);

  // B-14: section-skeleton assertions against the run's rendered doc.
  let skeletonViolations: MembershipViolation[] = [];
  try {
    const t = JSON.parse(readFileSync(join(outDir, 'tailored.json'), 'utf-8'));
    skeletonViolations = checkComposition(
      buildCandidatePool(),
      t.resumeDoc,
      (t.composition?.entities ?? []) as CompositionEntity[],
    );
  } catch {
    console.log('  (no tailored.json in out dir — skeleton asserts skipped)');
  }

  console.log('=== MEMBERSHIP GUARD (Education + Additional + B-14 skeleton) ===');
  console.log(`  checked: ${JSON.stringify(report.checked)}`);
  const all = [...report.violations, ...skeletonViolations];
  console.log(`  violations: ${all.length}`);
  for (const v of all) {
    console.log(`    ✗ [${v.field}] ${JSON.stringify(v.value)} — ${v.reason}`);
  }
  if (all.length > 0) {
    console.log('[check-membership] RESULT: VIOLATIONS PRESENT');
    process.exit(2);
  }
  console.log('[check-membership] RESULT: CLEAN ✓ (grounded members + intact section skeleton)');
}

// Run only when invoked directly (not when imported by a fixture).
if (process.argv[1] && process.argv[1].includes('check-membership')) main();
