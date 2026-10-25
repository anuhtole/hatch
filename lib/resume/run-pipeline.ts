/**
 * lib/resume/run-pipeline.ts
 *
 * The résumé pipeline as a LIBRARY (B-9): the single implementation behind two
 * frontends — the CLI e2e fixture (npm run resume:e2e) and the in-app flow
 * (POST /api/resume/run, streamed NDJSON progress). Ported verbatim from the
 * e2e fixture's runTarget; console printing became `emit.log(...)`, stage
 * boundaries emit `emit.stage(name, status)`, and gate failures throw
 * StageError(stage, detail) instead of process.exit — each frontend decides how
 * to surface them. NO trust rule changed: same fail-fast stages, same guards,
 * no affordance anywhere to continue past a failed gate.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { writeLastGreen, sha256File } from '@/lib/resume/last-green';
import { buildCandidatePool } from '@/lib/resume/candidate-pool';
import { tailorResume, selectClaimIds, compactBullets, condenseOrphans, restoreLineFill } from '@/lib/resume/tailor';
import { tailorSections } from '@/lib/resume/tailor-sections';
import { runResearch, deriveCompanyRole, researchFlagTerms, type ResearchBrief } from '@/lib/resume/research';
import { renderResumeDocx } from '@/lib/resume/render-docx';
import { generateCoverLetter, checkCoverLetterNumbers } from '@/lib/resume/cover-letter';
import { checkCoverLetterDrift, companyFromGreeting } from '@/lib/resume/check-cover-letter';
import { checkProvenance } from '@/lib/resume/check-provenance';
import { checkResumeDrift } from '@/lib/resume/check-resume-drift';
import { checkMembership, checkComposition } from '@/lib/resume/check-membership';
import { buildGapReport } from '@/lib/resume/gap-report';
import { fetchJobPosting, ANTHROPIC_JD_URL } from '@/lib/resume/fetch-job';
import { loadTargetDef, fetchTarget, TargetFetchError } from '@/lib/resume/fetch-target';
import { outDirFor } from '@/lib/resume/out-dir';
import { loadContact, contactSegments } from '@/lib/resume/contact';
import { estimateHeight, MAX_PAGES } from '@/lib/resume/one-page';
import { fitToOnePageWord } from '@/lib/resume/fit-page-word';
import { convertDocxToPdfViaWord, wordAvailable, warmUpWord } from '@/lib/resume/word-pdf';
import { inspectDocxBuffer, inspectDocxFile } from '@/lib/resume/docx-inspect';
import { checkFormatParity } from '@/lib/resume/check-format-parity';
import { checkAts } from '@/lib/resume/check-ats';
import { convertDocx, checkVisual, remediate, contentText, type VisualFinding } from '@/lib/resume/check-visual';
import type { LayoutTweaks } from '@/lib/resume/render-docx';

// ── Frontend contract ───────────────────────────────────────────────────────────

export type StageStatus = 'start' | 'pass' | 'fail';

export interface PipelineEmit {
  log(line: string): void;
  stage(name: string, status: StageStatus, detail?: string): void;
}

export class StageError extends Error {
  constructor(public stage: string, public detail: string) {
    super(`[${stage}] ${detail}`);
  }
}

export interface RunCtx {
  targetName: string | null;   // null = legacy single-JD mode (out/)
  outDir: string;
  jdText: string;              // JD or assembled target-profile text
  title: string;
  via: string;
  researchCompany: string;     // research is advisory; for targets, the target title
  researchRole: string;
  researchUrl: string;
}

export interface RunResult {
  targetName: string | null;
  outDir: string;
  docxPath: string;
  coverLetterPath: string;
  pngPath: string;
  docxBytes: number;
}

// ── Context resolution ──────────────────────────────────────────────────────────

/** Legacy single-JD resolution (env ANTHROPIC_JD_URL else the fetch-job constant). */
export async function resolveLegacyCtx(): Promise<RunCtx> {
  const url = process.env.ANTHROPIC_JD_URL ?? ANTHROPIC_JD_URL;
  const outDir = outDirFor(null);
  if (url) {
    const fetched = await fetchJobPosting(url);
    if (fetched.source !== 'fetch' || !fetched.text.trim()) {
      throw new StageError('fetch-job',
        `Explicit URL given (${url}) but extraction came back '${fetched.source}' ` +
        `(${fetched.text.length} chars). NOT falling back to test-jd.txt — fix the URL/parser.`);
    }
    const title = fetched.text.split('\n')[0].replace(/^#\s*/, '').trim();
    const { company, role } = deriveCompanyRole(url, fetched.text);
    return {
      targetName: null, outDir, jdText: fetched.text, title, via: `URL fetch <${url}>`,
      researchCompany: company, researchRole: role, researchUrl: url,
    };
  }
  const text = readFileSync(join(homedir(), 'hatch', 'test-jd.txt'), 'utf-8');
  const { company, role } = deriveCompanyRole('', text);
  return {
    targetName: null, outDir, jdText: text, title: '(manual paste)', via: 'test-jd.txt (no URL set)',
    researchCompany: company, researchRole: role, researchUrl: '',
  };
}

/** Target-mode resolution: load targets/<name>.json and fetch its profile. */
export async function resolveTargetCtx(name: string): Promise<RunCtx> {
  let def;
  try {
    def = loadTargetDef(name);
  } catch (e) {
    throw new StageError('fetch-target', e instanceof Error ? e.message : String(e));
  }
  try {
    const profile = await fetchTarget(def);
    return {
      targetName: name,
      outDir: outDirFor(name),
      jdText: profile.text,
      title: profile.title,
      via: `target "${name}" (${profile.sources.map((s) => `${s.url}: ${s.chars}c`).join(', ')})`,
      researchCompany: profile.title,
      researchRole: `candidate application to ${profile.title}`,
      researchUrl: def.urls[0] ?? '',
    };
  } catch (e) {
    if (e instanceof TargetFetchError) throw new StageError('fetch-target', `${e.message} — STOP (no silent fallback).`);
    throw e;
  }
}

// ── Internal helpers (ported) ───────────────────────────────────────────────────

/** Source-level containment gate: research.ts importable only by orchestrators. */
function assertContainment(emit: PipelineEmit): void {
  const repo = join(homedir(), 'hatch');
  const forbidden = ['lib/resume/cover-letter.ts', 'lib/resume/render-docx.ts'];
  const offenders: string[] = [];
  for (const f of forbidden) {
    const src = readFileSync(join(repo, f), 'utf-8');
    if (/from\s+['"]@\/lib\/resume\/research['"]/.test(src)) offenders.push(f);
  }
  const tailorSrc = readFileSync(join(repo, 'lib/resume/tailor.ts'), 'utf-8');
  if (/from\s+['"]@\/lib\/resume\/research['"]/.test(tailorSrc)) offenders.push('lib/resume/tailor.ts');
  if (offenders.length) throw new StageError('containment-check', `research.ts imported by content entrypoint(s): ${offenders.join(', ')}`);
  emit.log(`containment: research.ts not imported by rephrase/cover-letter/render entrypoints ✓`);
}

function orderDiff(before: string[], after: string[]): string[] {
  const lines: string[] = [];
  const beforeRank = new Map(before.map((id, i) => [id, i]));
  after.forEach((id, i) => {
    const was = beforeRank.has(id) ? beforeRank.get(id)! : -1;
    if (was !== i) lines.push(`  ${id}: ${was === -1 ? 'NEW' : `#${was + 1}`} → #${i + 1}`);
  });
  return lines;
}

// ── The pipeline ────────────────────────────────────────────────────────────────

export async function runTarget(ctx: RunCtx, emit: PipelineEmit, argv: string[] = process.argv): Promise<RunResult> {
  mkdirSync(ctx.outDir, { recursive: true });
  const { jdText, title, via, outDir } = ctx;
  const guard = (name: string, count: number, detail: string): void => {
    emit.stage(name, count === 0 ? 'pass' : 'fail', detail);
    if (count > 0) throw new StageError(name, detail);
  };

  emit.stage('fetch', 'pass', via);
  emit.log(`profile: ${title} — ${jdText.length} chars (${via})`);

  assertContainment(emit);
  emit.stage('containment', 'pass');

  // B-14 part 3: Word is the rendering authority for the one-page fit + shipped
  // PDF. Fail fast (and clearly) if it isn't available rather than mid-pipeline.
  if (!wordAvailable()) {
    throw new StageError('word', 'Microsoft Word not found — the one-page roster fit and shipped PDF render through Word (install Word, sign in, grant Automation permission). See lib/resume/word-pdf.ts.');
  }
  // Warm up + health-check Word NOW (launch past any cold-start/recovery dialog,
  // prove the canonical CV renders 1 page in genuine Garamond) so the later
  // rapid roster-fit calls hit a warm, validated Word — and a real failure
  // surfaces here with a clear message, not 3 minutes into the run.
  try {
    mkdirSync(join(outDir, 'visual'), { recursive: true });
    warmUpWord(join(outDir, 'visual'));
  } catch (e) {
    throw new StageError('word', e instanceof Error ? e.message : String(e));
  }
  emit.stage('word', 'pass', 'Word ready (canonical CV = 1 page in Garamond)');

  const pool = buildCandidatePool();
  emit.stage('pool', 'pass', `${pool.entities.length} entities, ${pool.claims.length} claims`);

  // Research (advisory; fail-soft).
  const doResearch = !argv.includes('--no-research');
  let brief: ResearchBrief | null = null;
  if (doResearch) {
    emit.stage('research', 'start', `${ctx.researchCompany} — ${ctx.researchRole}`);
    brief = await runResearch(ctx.researchCompany, ctx.researchRole, new Date().toISOString());
    if (!brief) emit.log(`⚠ WARN: research unavailable (web_search/parse failed) — continuing WITHOUT research.`);
    emit.stage('research', 'pass', brief ? `${brief.sources.length} sources, ${brief.themes.length} themes` : 'unavailable (fail-soft)');
  } else {
    emit.stage('research', 'pass', 'skipped (--no-research)');
  }
  const emphasis = brief ? brief.themes.map((t) => t.theme) : [];
  const researchTerms = brief ? researchFlagTerms(brief) : [];
  const researchQuestions = brief ? brief.openQuestions : [];
  if (brief) {
    writeFileSync(join(outDir, 'research-brief.json'), JSON.stringify(brief, null, 2));
    for (const t of brief.themes) emit.log(`  theme: ${t.theme}   ↳ ${t.sourceUrl}`);
  }

  // Baseline SELECT (for the rank diff) + tailor.
  emit.stage('tailor', 'start');
  const baseline = await selectClaimIds(pool, jdText, []);
  const tailored = await tailorResume(pool, jdText, { emphasis });
  const diff = orderDiff(baseline.orderedIds, tailored.selectedOrder);
  emit.log(diff.length ? `rank diff vs no-research baseline:\n${diff.join('\n')}` : 'rank diff: none');
  emit.stage('tailor', 'pass', `${tailored.provenance.length} bullets selected`);

  emit.stage('sections', 'start');
  const sections = await tailorSections(pool, jdText);
  tailored.resumeDoc.education = sections.education;
  tailored.resumeDoc.additional = sections.additional;
  emit.stage('sections', 'pass');

  const contact = loadContact();
  if (!contact) throw new StageError('header', 'no grounded contact section (sections/contact.md) found');
  tailored.resumeDoc.header = { name: contact.name, contact: contactSegments(contact) };
  emit.stage('header', 'pass');

  for (const d of tailored.suppressedDuplicates) emit.log(`near-dup suppressed: ${d.sourceId} :: ${d.text.slice(0, 70)}`);

  // B-14 composition contract accounting (skeleton is structural; this is the receipt).
  for (const ce of tailored.composition.entities) {
    emit.log(
      `composition: [${ce.section}] ${ce.entity} — ${ce.rendered} bullets (selected ${ce.selected}, backfilled ${ce.backfilled}, floor ${ce.min}${ce.deficit ? `, DEFICIT ${ce.deficit}` : ''})`,
    );
  }

  // B-14 compaction: if the assembled doc exceeds the budget even before trim,
  // re-roll multi-line bullets toward one line FIRST (same anti-fabrication
  // acceptance gate as line-fill; verbatim fallback) — the canonical CV achieves
  // the contract's density with one-line bullets, and trimming below the role
  // floors is forbidden.
  const preEst = estimateHeight(tailored.resumeDoc);
  if (!preEst.fits) {
    const c = await compactBullets(tailored.resumeDoc, tailored.provenance, pool, jdText);
    emit.log(`compaction: ${preEst.heightTwips}tw over budget → compacted ${c.compacted}/${c.attempted} multi-line bullets`);
  }

  // B-39: orphan-condense (PRE-FIT). Kill true single-word / <20%-fill trailing lines by
  // DELETING words from the rendered bullet (delete-only token-subset guard + the shared
  // numeric/drift gate), reclaiming whole lines BEFORE the roster/fill decision so the
  // freed space feeds page-fill. Strictly fewer lines on accept ⇒ never grows the page.
  // Never authors; an un-condensable orphan is left honest. Condensed texts accumulate so
  // restoreLineFill won't re-lengthen them.
  const condensedTexts = new Set<string>();
  {
    const oc = await condenseOrphans(tailored.resumeDoc, tailored.provenance, pool, jdText);
    for (const t of oc.condensedTexts) condensedTexts.add(t);
    if (oc.attempted) emit.log(`orphan-condense (pre-fit): shortened ${oc.condensed}/${oc.attempted} true-orphan bullet(s) by deletion`);
    for (const pr of oc.pairs) emit.log(`  condensed[pre-fit]:\n     before: ${pr.before}\n     after:  ${pr.after}`);
  }

  // B-14 part 3: WORD-AUTHORITATIVE one-page roster fit. Word (not LibreOffice
  // or an internal estimate) is the rendering authority — it authored the
  // canonical one-page CV. When the full roster + Skills/Interests exceeds one
  // Word page, the lowest-PRIORITY entries are omitted (logged, never deleted
  // from the vault) and the page is re-filled with grounded bullets to the caps,
  // every step Word-verified. Render order is unchanged; nothing is invented.
  const probeDocx = join(outDir, 'visual', 'fit-probe.docx');
  mkdirSync(join(outDir, 'visual'), { recursive: true });
  const measurePages = (b: Buffer): number => {
    writeFileSync(probeDocx, b);
    return convertDocxToPdfViaWord(probeDocx, 'fit-probe.pdf').pages;
  };
  const fit = await fitToOnePageWord(
    tailored.resumeDoc, tailored.provenance, tailored.composition.entities, tailored.reserve,
    (d) => renderResumeDocx(d), measurePages, emit.log,
  );
  for (const k of fit.kept) emit.log(`  kept: [${k.section}] ${k.entity} — ${k.bullets} bullets (floor ${k.floor})`);
  for (const d of fit.dropped) emit.log(`  OMITTED (priority, over one page): [${d.section}] ${d.entity}`);
  emit.log(`roster-fit: ${fit.kept.length} entries, filled-back ${fit.filledBack}, ${fit.measures} Word measures → ${fit.finalPages} page(s)`);
  emit.stage('one-page', fit.finalPages === MAX_PAGES ? 'pass' : 'fail', `${fit.finalPages} Word page(s), ${fit.dropped.length} omitted`);
  if (fit.finalPages > MAX_PAGES) throw new StageError('one-page', `Word renders ${fit.finalPages} pages after the priority roster fit could not reduce further`);

  // B-16: two-line cap. The roster fit fills back VERBATIM grounded reserve bullets,
  // some of which run to three+ lines and were never compacted (compaction ran
  // pre-fit). Trim any surviving 3+-line bullet down to ≤ two lines — compaction
  // only ever SHORTENS (strictly-fewer-lines + the anti-fab gate), so this frees
  // vertical space and can never push the page back over one (no re-measure needed).
  const postC = await compactBullets(tailored.resumeDoc, tailored.provenance, pool, jdText);
  if (postC.attempted) emit.log(`two-line cap: compacted ${postC.compacted}/${postC.attempted} three-line bullet(s) post-fit`);

  // B-39: orphan-condense (POST-FIT re-check). The roster fill-back adds verbatim reserve
  // bullets that can introduce new single-word / near-empty trailing lines; reclaim them
  // too. Strictly reduces lines → can only shrink the page (no re-measure needed). Bounded:
  // exactly one pre-fit + one post-fit invocation (no unbounded loop).
  {
    const oc = await condenseOrphans(tailored.resumeDoc, tailored.provenance, pool, jdText);
    for (const t of oc.condensedTexts) condensedTexts.add(t);
    if (oc.attempted) emit.log(`orphan-condense (post-fit): shortened ${oc.condensed}/${oc.attempted} true-orphan bullet(s) by deletion`);
    for (const pr of oc.pairs) emit.log(`  condensed[post-fit]:\n     before: ${pr.before}\n     after:  ${pr.after}`);
  }

  // B-26: standing render-feedback line-fill (grounded RESTORE). For each rendered bullet
  // whose last wrapped line is under-full IN THE PROSE BAND (20–80%), re-include grounded
  // detail the current phrasing dropped — within the SAME line count, so height is unchanged
  // and the page can never spill. B-39: true orphans (<20% / single word) are NOT restored
  // here (condenseOrphans reclaimed them); condensed bullets are skipped so they aren't
  // re-lengthened. Anti-fab gate identical to compaction; ≤3 passes.
  const rest = await restoreLineFill(tailored.resumeDoc, tailored.provenance, pool, jdText, condensedTexts);
  if (rest.attempted) emit.log(`line-fill restore: ${rest.restored} bullet(s) filled from source (${rest.passes} pass(es), ${rest.attempted} under-full candidates)`);

  // Consolidated ACTION LIST (vault metadata gaps + floor deficits + omissions).
  const actionList = [...tailored.composition.actionList];
  for (const d of fit.dropped) actionList.push(`OMITTED for one-page fit (lowest priority): ${d.entity} [${d.section}] — present in the vault, add back by raising its ENTRY_PRIORITY or allowing two pages`);
  if (actionList.length) {
    emit.log(`── ACTION LIST (vault / roster) ──`);
    for (const a of actionList) emit.log(`  ${a}`);
  }

  writeFileSync(join(outDir, 'composition-report.json'), JSON.stringify({
    entities: tailored.composition.entities,
    actionList,
    rosterFit: fit,
  }, null, 2));

  writeFileSync(join(outDir, 'tailored.json'), JSON.stringify(tailored, null, 2));
  writeFileSync(join(outDir, 'edu-additional-selection.json'), JSON.stringify(sections.selection, null, 2));
  writeFileSync(join(outDir, 'skills-to-learn.json'), JSON.stringify(sections.skillsToLearn, null, 2));
  writeFileSync(join(outDir, 'line-fill-report.json'), JSON.stringify(tailored.lineFill, null, 2));

  const buf = await renderResumeDocx(tailored.resumeDoc);
  const docxPath = join(outDir, 'tailored-resume.docx');
  writeFileSync(docxPath, buf);
  emit.stage('render', 'pass', `${buf.length} bytes`);

  emit.stage('cover-letter', 'start');
  const coverLetterPath = join(outDir, 'cover-letter.docx');
  const letter = await generateCoverLetter(tailored, jdText, { outPath: coverLetterPath });
  emit.stage('cover-letter', 'pass', `${letter.sentences.length} sentences`);

  emit.stage('gap-report', 'start');
  const gap = await buildGapReport(jdText, pool, tailored, researchQuestions);
  writeFileSync(join(outDir, 'gap-report.json'), JSON.stringify(gap, null, 2));
  emit.stage('gap-report', 'pass', `${gap.items.length} items, ${gap.questions.length} questions`);

  // ── Guards (fail-fast, same order as CLI) ─────────────────────────────────────
  const mem = checkMembership(sections.selection, sections.skillsToLearn);
  for (const v of mem.violations) emit.log(`  ✗ [${v.field}] ${JSON.stringify(v.value)} — ${v.reason}`);
  guard('guard:membership', mem.violations.length, `${mem.violations.length} violation(s) — ${JSON.stringify(mem.checked)}`);

  // B-14 composition contract: section roster/order/floors, post one-page trim.
  const skel = checkComposition(pool, tailored.resumeDoc, tailored.composition.entities);
  for (const v of skel) emit.log(`  ✗ [${v.field}] ${JSON.stringify(v.value)} — ${v.reason}`);
  guard('guard:composition', skel.length, `${skel.length} violation(s) — fixed skeleton, role floors`);

  const prov = checkProvenance(pool, tailored);
  for (const v of prov.violations) emit.log(`  ✗ [${v.reason}] ${v.sourceId} ${v.detail ?? ''} :: ${v.bullet}`);
  guard('guard:provenance', prov.violations.length, `${prov.violations.length} violation(s) over ${prov.bulletCount} bullets`);

  const drift = checkResumeDrift(tailored, pool, jdText, researchTerms);
  for (const f of drift.flags) emit.log(`  ✗ [${f.category}] "${f.term}" :: ${f.bullet}`);
  guard('guard:resume-drift', drift.flags.length, `${drift.flags.length} flag(s)`);

  const targetCompany = companyFromGreeting(letter.greeting);
  const clDrift = checkCoverLetterDrift(letter.sentences, tailored, pool, jdText, targetCompany, researchTerms);
  const clNums = checkCoverLetterNumbers(letter.text, letter.provenance);
  for (const w of clDrift.warnings) emit.log(`  ⚠ WARN (target-naming, exempt) "${w.term}" :: ${w.sentence}`);
  for (const f of clDrift.flags) emit.log(`  ✗ [${f.category}] "${f.term}" :: ${f.sentence}`);
  for (const v of clNums.violations) emit.log(`  ✗ [number] ${v}`);
  guard('guard:cover-letter', clDrift.flags.length + clNums.violations.length,
    `${clDrift.flags.length} drift + ${clNums.violations.length} numeric (target-company="${targetCompany}")`);

  const [renderedDoc, canonicalDoc] = await Promise.all([
    inspectDocxBuffer(buf),
    inspectDocxFile(join(homedir(), 'vault', 'Anatole Palmer Seychal CV.docx')),
  ]);
  // B-14: per-entry header-completeness asserts ride along; truthful vault
  // metadata gaps land on the action list (printed below), never as violations.
  const headerEntries = [...tailored.resumeDoc.experience, ...tailored.resumeDoc.projects]
    .map((e) => ({ company: e.company, location: e.location, role: e.role, dates: e.dates }));
  const headerActionList: string[] = [];
  const parity = checkFormatParity(renderedDoc, canonicalDoc, headerEntries, headerActionList);
  for (const x of parity) emit.log(`  ✗ [${x.field}] expected ${x.expected} · got ${x.actual}`);
  for (const a of headerActionList) emit.log(`  ${a}`);
  guard('guard:parity', parity.length, `${parity.length} mismatch(es) incl. entry-header asserts`);

  const ats = await checkAts(buf);
  for (const x of ats) emit.log(`  ✗ [${x.check}] ${x.detail}`);
  guard('guard:ats', ats.length, `${ats.length} violation(s)`);

  // ── Visual QA gate (text-immutable remediation loop) ──────────────────────────
  emit.stage('visual', 'start');
  let visualBuf = buf;
  let tweaks: LayoutTweaks = {};
  let findings: VisualFinding[] = [];
  let pngPath = '';
  const baselineText = await contentText(visualBuf);
  for (let iter = 1; iter <= 3; iter++) {
    const iterText = await contentText(visualBuf);
    if (iterText !== baselineText) throw new StageError('visual-text-immutability', 'extracted content text changed inside the remediation loop');
    writeFileSync(docxPath, visualBuf);
    const art = convertDocx(docxPath, outDir);
    pngPath = art.pngPath;
    findings = await checkVisual(pngPath);
    const high = findings.filter((f) => f.severity === 'high');
    emit.log(`visual iteration ${iter}: ${findings.length} finding(s), ${high.length} high`);
    for (const f of findings) emit.log(`  ${f.severity === 'high' ? '✗' : '⚠'} [${f.severity}] ${f.issue} @ ${f.location}`);
    if (high.length === 0) break;
    const next = remediate(findings, tweaks);
    if (!next) { emit.log('  (no layout-only remediation available for remaining high findings)'); break; }
    tweaks = next;
    emit.log(`  remediating with layout tweaks: ${JSON.stringify(tweaks)}`);
    visualBuf = await renderResumeDocx(tailored.resumeDoc, tweaks);
  }
  const finalHigh = findings.filter((f) => f.severity === 'high');
  guard('guard:visual', finalHigh.length, `${finalHigh.length} high finding(s)`);

  // PDF export (B-14 part 3): the shipped text-layer PDF is rendered by WORD —
  // the same authority the roster fit measured against — so its pagination is
  // exactly what a recruiter opens. Asserts one page defensively.
  emit.stage('pdf', 'start');
  const pdf = convertDocxToPdfViaWord(docxPath, 'resume.pdf');
  if (pdf.pages !== MAX_PAGES) throw new StageError('pdf', `Word PDF has ${pdf.pages} page(s), expected ${MAX_PAGES}`);
  emit.stage('pdf', 'pass', `${pdf.pages} page(s), Word-rendered — ${pdf.pdfPath}`);

  // Record the green run (B-10): outreach may attach ONLY artifacts from a run
  // where every stage and guard passed — guard:outreach verifies these hashes.
  if (ctx.targetName) {
    writeLastGreen(ctx.targetName, {
      docxPath,
      sha256: sha256File(docxPath),
      pdfPath: pdf.pdfPath,
      pdfSha256: sha256File(pdf.pdfPath),
      coverLetterPath,
      completedAt: new Date().toISOString(),
    });
  }

  emit.stage('done', 'pass', `all stages passed, all guards 0`);
  return {
    targetName: ctx.targetName,
    outDir,
    docxPath,
    coverLetterPath,
    pngPath,
    docxBytes: buf.length,
  };
}
