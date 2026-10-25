/**
 * lib/resume/tailor-fixture.ts
 *
 * End-to-end Phase-3b runner:
 *   read ~/hatch/test-jd.txt → buildCandidatePool → tailorResume (Opus) →
 *   write ~/hatch/out/tailored.json + render ~/hatch/out/tailored-resume.docx →
 *   run checkProvenance and print the summary.
 *
 * Run with:  npx tsx lib/resume/tailor-fixture.ts
 * (loads ANTHROPIC_API_KEY from .env.local / .env)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildCandidatePool } from '@/lib/resume/candidate-pool';
import { tailorResume } from '@/lib/resume/tailor';
import { tailorSections } from '@/lib/resume/tailor-sections';
import { renderResumeDocx } from '@/lib/resume/render-docx';
import { checkProvenance } from '@/lib/resume/check-provenance';
import { checkResumeDrift } from '@/lib/resume/check-resume-drift';
import { fetchJobPosting } from '@/lib/resume/fetch-job';

/**
 * JD source: optional env JD_URL → fetchJobPosting. If the URL is unset or the
 * fetch comes back 'too-thin', fall back to the manually-pasted ~/hatch/test-jd.txt.
 */
async function resolveJd(): Promise<{ text: string; via: string }> {
  const jdPath = join(homedir(), 'hatch', 'test-jd.txt');
  const url = process.env.JD_URL;
  if (url) {
    const fetched = await fetchJobPosting(url);
    if (fetched.source === 'fetch') {
      return { text: fetched.text, via: `URL fetch <${url}> (${fetched.text.length} chars)` };
    }
    const text = readFileSync(jdPath, 'utf-8');
    return { text, via: `URL too-thin → fallback file ${jdPath} (${text.length} chars)` };
  }
  const text = readFileSync(jdPath, 'utf-8');
  return { text, via: `manual-paste file ${jdPath} (${text.length} chars)` };
}

async function main() {
  const { text: jdText, via } = await resolveJd();
  console.log(`[tailor-fixture] JD source: ${via}`);

  const pool = buildCandidatePool();
  console.log(`[tailor-fixture] pool: ${pool.entities.length} entities, ${pool.claims.length} claims`);

  const tailored = await tailorResume(pool, jdText);

  // Part B — route grounded Education + Additional into the document.
  const sections = await tailorSections(pool, jdText);
  tailored.resumeDoc.education = sections.education;
  tailored.resumeDoc.additional = sections.additional;

  const outDir = join(homedir(), 'hatch', 'out');
  mkdirSync(outDir, { recursive: true });

  const jsonPath = join(outDir, 'tailored.json');
  writeFileSync(jsonPath, JSON.stringify(tailored, null, 2));

  // Exact strings to render (membership guard validates these) + the never-rendered
  // study list + the per-bullet line-fill report.
  writeFileSync(join(outDir, 'edu-additional-selection.json'), JSON.stringify(sections.selection, null, 2));
  writeFileSync(join(outDir, 'skills-to-learn.json'), JSON.stringify(sections.skillsToLearn, null, 2));
  writeFileSync(join(outDir, 'line-fill-report.json'), JSON.stringify(tailored.lineFill, null, 2));

  const buf = await renderResumeDocx(tailored.resumeDoc);
  const docxPath = join(outDir, 'tailored-resume.docx');
  writeFileSync(docxPath, buf);

  // Which entities got selected (in render order).
  const expEntities = tailored.resumeDoc.experience.map((e) => `${e.company} (${e.bullets.length})`);
  const projEntities = tailored.resumeDoc.projects.map((e) => `${e.company} (${e.bullets.length})`);

  console.log(`\n[tailor-fixture] wrote ${jsonPath}`);
  console.log(`[tailor-fixture] wrote ${docxPath} (${buf.length} bytes)`);
  console.log(`\n=== SELECTED ENTITIES ===`);
  console.log(`  Professional Experience: ${expEntities.join(', ') || '(none)'}`);
  console.log(`  Research & Project Experience: ${projEntities.join(', ') || '(none)'}`);

  // ── Rendered Education + Additional blocks ───────────────────────────────────
  const ed = sections.education[0];
  console.log(`\n=== EDUCATION (rendered) ===`);
  console.log(`  ${ed.school}${ed.right ? `   [right] ${ed.right}` : ''}`);
  console.log(`  ${ed.degrees}`);
  console.log(`  Relevant Coursework: ${ed.coursework}`);
  console.log(`  (coursework packed into ${sections.coursePack.lineCount} line(s); ` +
    `last line ${Math.round(sections.coursePack.lastLineFill * 100)}% full)`);
  console.log(`\n=== ADDITIONAL INFORMATION (rendered) ===`);
  console.log(`  Skills & Languages: ${sections.additional.skillsAndLanguages}`);
  console.log(`  Interests: ${sections.additional.interests}`);
  console.log(`  skills selected: ${sections.selection.skills.length} (of grounded set) · languages ${sections.selection.languages.length} · interests ${sections.selection.interests.length}`);

  // ── Skills gap (study list — NEVER rendered) ─────────────────────────────────
  console.log(`\n=== SKILLS TO LEARN (out/skills-to-learn.json — never rendered) ===`);
  console.log(`  ${sections.skillsToLearn.length ? sections.skillsToLearn.join(', ') : '(none)'}`);

  // ── Line-fill report summary ─────────────────────────────────────────────────
  const fills = tailored.lineFill.map((l) => l.lastLineFill).sort((a, b) => a - b);
  const med = fills.length ? fills[Math.floor(fills.length / 2)] : 0;
  const reRolled = tailored.lineFill.filter((l) => l.reRolled).length;
  const stillShort = tailored.lineFill.filter((l) => l.short).length;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  console.log(`\n=== LINE-FILL REPORT (out/line-fill-report.json) ===`);
  console.log(`  bullets: ${tailored.lineFill.length} · re-rolled: ${reRolled} · left short: ${stillShort}`);
  console.log(`  last-line fill — min ${fills.length ? pct(fills[0]) : 'n/a'} · median ${fills.length ? pct(med) : 'n/a'} · max ${fills.length ? pct(fills[fills.length - 1]) : 'n/a'}`);

  // ── Provenance check on this output ──────────────────────────────────────────
  const report = checkProvenance(pool, tailored);
  console.log(`\n=== PROVENANCE CHECK ===`);
  console.log(`  bullet count: ${report.bulletCount}`);
  console.log(`  droppedUnknownIds: ${report.droppedUnknownIds.length ? report.droppedUnknownIds.join(', ') : '(none)'}`);
  console.log(`  violations: ${report.violations.length}`);
  for (const v of report.violations) {
    console.log(`    ✗ [${v.reason}] sourceId=${v.sourceId}${v.detail ? ` offending=${v.detail}` : ''}`);
    console.log(`      bullet: ${v.bullet}`);
  }

  // ── Résumé-bullet drift check (JD-term grafting) ─────────────────────────────
  const drift = checkResumeDrift(tailored, pool, jdText);
  console.log(`\n=== RÉSUMÉ DRIFT CHECK (JD-term grafting) ===`);
  console.log(`  drift flags: ${drift.flags.length}`);
  for (const f of drift.flags) {
    console.log(`    ✗ [${f.category}] term="${f.term}"  source=${f.sourceId}`);
    console.log(`      bullet: ${f.bullet}`);
  }

  // Exit non-zero on any violation so callers/gates can detect failure.
  if (report.violations.length > 0 || drift.flags.length > 0) {
    console.log(`\n[tailor-fixture] RESULT: FLAGS PRESENT (numeric=${report.violations.length}, drift=${drift.flags.length})`);
    process.exit(2);
  }
  console.log(`\n[tailor-fixture] RESULT: CLEAN ✓ (0 numeric, 0 drift)`);
}

main().catch((err) => {
  console.error('[tailor-fixture] failed:', err);
  process.exit(1);
});
