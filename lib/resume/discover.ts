/**
 * lib/resume/discover.ts — lab target discovery (B-10 Phase 1).
 *
 * Given a lab root URL, crawl PUBLISHED pages only (groups, people, research
 * areas, join/opportunities pages) and produce a ranked shortlist of groups/PIs
 * with fit rationales grounded in BOTH regimes:
 *   - lab-side facts (topics, people, process, contact) trace to fetched page
 *     URLs — citation carried per fact;
 *   - fit rationales cite a vault claim id AND a source URL, validated
 *     structurally (claim id must exist in the candidate pool; URL must be one
 *     we actually fetched).
 *
 * HARD RULES (structural, not prompt-text):
 *   - Same-domain only, depth-capped, robots.txt-respecting, rate-limited.
 *   - Contact info appears ONLY if the email string occurs VERBATIM in a fetched
 *     page's text (no pattern-guessed addresses — "first.last@" inference is a
 *     fabrication). No published route → "application page only".
 *   - Discovery NEVER creates outreach drafts. It writes a shortlist; the user
 *     picks recipients in the UI (picks become queue entries — see outreach.ts).
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { structuredCreate } from '@/lib/resume/structured';
import { ROUTES } from '@/lib/models';
import { buildCandidatePool, type CandidatePool } from '@/lib/resume/candidate-pool';
import { isSelectableClaim } from '@/lib/resume/bullet-hygiene';
import { outDirFor } from '@/lib/resume/out-dir';
import { renderPage, closeRenderer } from '@/lib/resume/render-page';

// ── Crawl constants (// EDIT TO RETAILOR) ───────────────────────────────────────
export const CRAWL_DEPTH_MAX = 2;       // root = depth 0
export const CRAWL_PAGE_MAX = 24;       // hard page budget per lab
export const CRAWL_RATE_LIMIT_MS = 800; // min spacing between request STARTS
export const CRAWL_TIMEOUT_MS = 20_000;
// Plain-HTML extract below this → headless-render fallback (B-10.1). The page
// was already robots-cleared before its plain fetch; the render hits the SAME
// url, and rendered-DOM links re-enter the queue through the same robots/
// same-domain/depth checks as plain-fetch links.
export const RENDER_FALLBACK_MIN_CHARS = 200;
const USER_AGENT = 'HatchDiscovery/1.0 (+academic outreach research; respectful crawler)';

// Only follow links whose path looks like published lab structure.
const RELEVANT_PATH_RE =
  /(people|person|faculty|student|member|group|lab|team|research|area|topic|project|join|opportun|undergrad|intern|prospective|contact|publication|about)/i;

// ── Types ───────────────────────────────────────────────────────────────────────

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  depth: number;
}

export interface GroupContact {
  kind: 'email' | 'application-page';
  value: string;     // the published email, or the application/join page URL
  sourceUrl: string; // page the contact was published on
}

export interface GroupEntry {
  name: string;            // group or PI name
  pi?: string;
  topics: string[];
  people: string[];
  undergradProcess?: string; // stated undergrad/RA/internship process, verbatim-ish
  contact: GroupContact | null; // null → "application page only" with no known page
  sourceUrls: string[];
}

export interface FitRationale {
  claimId: string;   // vault claim id (validated against the pool)
  sourceUrl: string; // lab page the fit reasoning is anchored to (validated)
  text: string;
}

export interface AccessibilitySignals {
  statedUndergradProgram?: string;
  joinPage?: string;
  undergradCoauthors?: string;
}

export interface RankedGroup extends GroupEntry {
  fitScore: number; // 0–100
  rationales: FitRationale[];
  accessibility: AccessibilitySignals;
}

export interface LabDiscovery {
  lab: string;
  rootUrl: string;
  fetchedPages: FetchedPage[];
  shortlist: RankedGroup[];
  droppedRationales: number; // citations that failed structural validation
  generatedAt: string;
}

// ── HTML helpers ────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&mdash;|&#8212;/g, '—').replace(/&ndash;|&#8211;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function pageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    try {
      const abs = new URL(m[1], baseUrl);
      abs.hash = '';
      if (abs.protocol === 'http:' || abs.protocol === 'https:') out.add(abs.toString());
    } catch { /* malformed href — skip */ }
  }
  return [...out];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch one URL with timeout + UA. Returns null on any failure (crawl is fail-soft per page). */
export async function fetchPage(url: string): Promise<{ html: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CRAWL_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (ct && !/text\/html|application\/xhtml/.test(ct)) return null;
    return { html: await res.text() };
  } catch {
    return null;
  }
}

// ── robots.txt (User-agent: * Disallow prefixes; simple prefix semantics) ───────

export async function fetchRobotsDisallow(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return [];
    const lines = (await res.text()).split('\n');
    const disallow: string[] = [];
    let applies = false;
    for (const raw of lines) {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) continue;
      const ua = line.match(/^user-agent:\s*(.+)$/i);
      if (ua) { applies = ua[1].trim() === '*'; continue; }
      const dis = line.match(/^disallow:\s*(.*)$/i);
      if (dis && applies && dis[1].trim()) disallow.push(dis[1].trim());
    }
    return disallow;
  } catch {
    return [];
  }
}

export function robotsAllows(url: string, disallow: string[]): boolean {
  const path = new URL(url).pathname;
  return !disallow.some((p) => path.startsWith(p.replace(/\*$/, '')));
}

// ── Crawl ───────────────────────────────────────────────────────────────────────

export async function crawlLab(rootUrl: string, log: (s: string) => void): Promise<FetchedPage[]> {
  const root = new URL(rootUrl);
  const disallow = await fetchRobotsDisallow(root.origin);
  if (disallow.length) log(`robots.txt: ${disallow.length} disallow rule(s) honored`);

  const linkFilter = (l: string): boolean => {
    try {
      const u = new URL(l);
      if (u.hostname !== root.hostname) return false;           // same-domain only
      if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|bib|ps|mp4|pptx?|docx?)$/i.test(u.pathname)) return false;
      return u.pathname === '/' || RELEVANT_PATH_RE.test(u.pathname);
    } catch { return false; }
  };

  const seen = new Set<string>();
  const pages: FetchedPage[] = [];
  let queue: Array<{ url: string; depth: number }> = [{ url: root.toString(), depth: 0 }];

  try {
    while (queue.length && pages.length < CRAWL_PAGE_MAX) {
      const { url, depth } = queue.shift()!;
      const norm = url.replace(/\/$/, '');
      if (seen.has(norm)) continue;
      seen.add(norm);
      if (!robotsAllows(url, disallow)) { log(`  robots-skip ${url}`); continue; }

      // Spacing is measured from request START — the headless fallback's own
      // latency counts toward it (no double-waiting on slow renders).
      const t0 = Date.now();
      const res = await fetchPage(url);
      if (!res) {
        await sleep(Math.max(0, CRAWL_RATE_LIMIT_MS - (Date.now() - t0)));
        log(`  fetch-fail ${url}`);
        continue;
      }

      let text = stripHtml(res.html);
      let links = extractLinks(res.html, url);
      let renderedNote = '';

      if (text.length < RENDER_FALLBACK_MIN_CHARS) {
        // JS-shell page: render the SAME (robots-cleared) url and re-extract
        // text AND links from the real DOM.
        const rendered = await renderPage(url);
        if (rendered && rendered.text.length > text.length) {
          text = rendered.text;
          links = [...new Set([...links, ...rendered.links])];
          renderedNote = ' (headless-rendered)';
        } else {
          renderedNote = ' (headless render did not help)';
        }
      }
      await sleep(Math.max(0, CRAWL_RATE_LIMIT_MS - (Date.now() - t0)));

      pages.push({ url, title: pageTitle(res.html), text, depth });
      log(`  [d${depth}] ${url} — ${text.length} chars${renderedNote}`);

      if (depth < CRAWL_DEPTH_MAX) {
        queue = queue.concat(links.filter(linkFilter).map((l) => ({ url: l, depth: depth + 1 })));
      }
    }
  } finally {
    await closeRenderer();
  }
  return pages;
}

// ── Extraction (model reads fetched text; every fact carries its page URL) ──────

interface ExtractedGroups {
  groups: Array<{
    name: string;
    pi?: string;
    topics?: string[];
    people?: string[];
    undergradProcess?: string;
    contactEmail?: string;
    applicationUrl?: string;
    sourceUrls: string[];
  }>;
}

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          pi: { type: 'string' },
          topics: { type: 'array', items: { type: 'string' } },
          people: { type: 'array', items: { type: 'string' } },
          undergradProcess: { type: 'string' },
          contactEmail: { type: 'string' },
          applicationUrl: { type: 'string' },
          sourceUrls: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'sourceUrls'],
      },
    },
  },
  required: ['groups'],
};

const PAGE_EXCERPT_CHARS = 6000;

export async function extractGroups(pages: FetchedPage[], log: (s: string) => void): Promise<GroupEntry[]> {
  const corpus = pages
    .map((p) => `=== PAGE ${p.url}\nTITLE: ${p.title}\n${p.text.slice(0, PAGE_EXCERPT_CHARS)}`)
    .join('\n\n');

  const extracted = await structuredCreate<ExtractedGroups>({
    stage: 'discover-extract',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8000,
    schema: EXTRACT_SCHEMA,
    prompt:
      `Below are fetched pages from a research lab's PUBLIC website. Extract the research ` +
      `groups and/or PIs (principal investigators) described.\n\n` +
      `For each group/PI:\n` +
      `- name, pi (if distinct), topics (research areas), people (names listed as members)\n` +
      `- undergradProcess: any STATED process for undergrads/RAs/interns to get involved ` +
      `(quote or closely paraphrase the page; omit if nothing is stated)\n` +
      `- contactEmail: ONLY an email address that appears LITERALLY in the page text below. ` +
      `NEVER construct or guess an address. Omit if none appears.\n` +
      `- applicationUrl: a join/apply/opportunities page URL if one is referenced.\n` +
      `- sourceUrls: the PAGE urls (from the "=== PAGE" headers) each fact came from.\n\n` +
      `Only report what these pages state. Do not use outside knowledge of the lab.\n\n${corpus}`,
  });
  if (!extracted) throw new Error('[discover-extract] structured extraction returned null — cannot proceed');

  const fetchedUrls = new Set(pages.map((p) => p.url));
  const allText = pages.map((p) => p.text.toLowerCase()).join('\n');

  const groups: GroupEntry[] = [];
  for (const g of extracted.groups) {
    const sourceUrls = (g.sourceUrls ?? []).filter((u) => fetchedUrls.has(u));
    if (!sourceUrls.length) { log(`  ✗ drop "${g.name}" — no valid source URLs`); continue; }

    // STRUCTURAL contact rule: email must appear verbatim in fetched text.
    let contact: GroupContact | null = null;
    if (g.contactEmail) {
      const email = g.contactEmail.trim().toLowerCase();
      const onPage = pages.find((p) => sourceUrls.includes(p.url) && p.text.toLowerCase().includes(email))
        ?? pages.find((p) => p.text.toLowerCase().includes(email));
      if (onPage && allText.includes(email)) {
        contact = { kind: 'email', value: g.contactEmail.trim(), sourceUrl: onPage.url };
      } else {
        log(`  ✗ contact "${g.contactEmail}" for ${g.name} NOT verbatim on any fetched page — dropped (no guessed emails)`);
      }
    }
    if (!contact && g.applicationUrl && fetchedUrls.has(g.applicationUrl)) {
      contact = { kind: 'application-page', value: g.applicationUrl, sourceUrl: g.applicationUrl };
    } else if (!contact && g.applicationUrl) {
      // Application URL referenced but not crawled — keep it (it was published as a link), cite the referring page.
      contact = { kind: 'application-page', value: g.applicationUrl, sourceUrl: sourceUrls[0] };
    }

    groups.push({
      name: g.name,
      pi: g.pi,
      topics: g.topics ?? [],
      people: g.people ?? [],
      undergradProcess: g.undergradProcess,
      contact,
      sourceUrls,
    });
  }
  return groups;
}

// ── Fit ranking vs GROUNDED vault claims ────────────────────────────────────────

interface RankOutput {
  rankings: Array<{
    groupName: string;
    fitScore: number;
    rationales: Array<{ claimId: string; sourceUrl: string; text: string }>;
    statedUndergradProgram?: string;
    joinPage?: string;
    undergradCoauthors?: string;
  }>;
}

const RANK_SCHEMA = {
  type: 'object',
  properties: {
    rankings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          groupName: { type: 'string' },
          fitScore: { type: 'number' },
          rationales: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claimId: { type: 'string' },
                sourceUrl: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['claimId', 'sourceUrl', 'text'],
            },
          },
          statedUndergradProgram: { type: 'string' },
          joinPage: { type: 'string' },
          undergradCoauthors: { type: 'string' },
        },
        required: ['groupName', 'fitScore', 'rationales'],
      },
    },
  },
  required: ['rankings'],
};

export async function rankGroups(
  groups: GroupEntry[],
  pages: FetchedPage[],
  pool: CandidatePool,
  log: (s: string) => void,
): Promise<{ shortlist: RankedGroup[]; dropped: number }> {
  // Catalog = grounded, hygiene-filtered claims only (same selectable surface as SELECT).
  const catalog = pool.claims
    .filter((c) => (c.kind === 'experience' || c.kind === 'project' || c.kind === 'additional') && isSelectableClaim(c))
    .map((c) => `${c.id} :: [${c.entity}] ${c.text}`);

  const groupDesc = groups
    .map((g) =>
      `GROUP "${g.name}"${g.pi ? ` (PI: ${g.pi})` : ''}\n` +
      `  topics: ${g.topics.join('; ') || '(none listed)'}\n` +
      `  people: ${g.people.slice(0, 12).join(', ') || '(none listed)'}\n` +
      (g.undergradProcess ? `  stated undergrad process: ${g.undergradProcess}\n` : '') +
      `  sourceUrls: ${g.sourceUrls.join(' ')}`)
    .join('\n\n');

  const ranked = await structuredCreate<RankOutput>({
    stage: 'discover-rank',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8000,
    schema: RANK_SCHEMA,
    prompt:
      `Score the fit between a candidate and each research group below (0–100).\n\n` +
      `THE ONLY FACTS ABOUT THE CANDIDATE are the claims in this catalog (id :: [entity] text):\n` +
      `${catalog.join('\n')}\n\n` +
      `THE ONLY FACTS ABOUT EACH GROUP are in its description (every group lists its sourceUrls):\n` +
      `${groupDesc}\n\n` +
      `For each group return:\n` +
      `- fitScore 0–100\n` +
      `- rationales: 1–4 entries, EACH citing one claimId from the catalog AND one sourceUrl ` +
      `from that group's sourceUrls, with a one-sentence reason connecting the claim to the ` +
      `group's published topics. NEVER cite a claim id or URL not listed above. NEVER invent ` +
      `a candidate fact.\n` +
      `- accessibility signals, ONLY if stated on the pages: statedUndergradProgram, joinPage ` +
      `(URL), undergradCoauthors (what the pages say about undergrad involvement/co-authorship).\n` +
      `Order is irrelevant; we sort by fitScore.`,
  });
  if (!ranked) throw new Error('[discover-rank] structured ranking returned null — cannot proceed');

  const claimIds = new Set(pool.claims.map((c) => c.id));
  const fetchedUrls = new Set(pages.map((p) => p.url));
  const byName = new Map(groups.map((g) => [g.name.toLowerCase(), g]));

  let dropped = 0;
  const shortlist: RankedGroup[] = [];
  for (const r of ranked.rankings) {
    const g = byName.get(r.groupName.toLowerCase());
    if (!g) { log(`  ✗ ranking for unknown group "${r.groupName}" — dropped`); continue; }
    const valid: FitRationale[] = [];
    for (const ra of r.rationales) {
      const claimOk = claimIds.has(ra.claimId);
      const urlOk = fetchedUrls.has(ra.sourceUrl) || g.sourceUrls.includes(ra.sourceUrl);
      if (claimOk && urlOk) valid.push(ra);
      else { dropped++; log(`  ✗ rationale dropped for ${g.name}: claimOk=${claimOk} urlOk=${urlOk} (${ra.claimId} / ${ra.sourceUrl})`); }
    }
    if (!valid.length) { log(`  ✗ "${g.name}" excluded — no structurally valid fit rationale survived`); continue; }
    shortlist.push({
      ...g,
      fitScore: Math.max(0, Math.min(100, r.fitScore)),
      rationales: valid,
      accessibility: {
        statedUndergradProgram: r.statedUndergradProgram,
        joinPage: r.joinPage,
        undergradCoauthors: r.undergradCoauthors,
      },
    });
  }
  shortlist.sort((a, b) => b.fitScore - a.fitScore);
  return { shortlist, dropped };
}

// ── Orchestration + artifact writer ─────────────────────────────────────────────

export async function discoverLab(lab: string, rootUrl: string, log: (s: string) => void): Promise<LabDiscovery> {
  log(`crawl: ${rootUrl} (depth≤${CRAWL_DEPTH_MAX}, pages≤${CRAWL_PAGE_MAX}, ${CRAWL_RATE_LIMIT_MS}ms between fetches)`);
  const pages = await crawlLab(rootUrl, log);
  if (!pages.length) throw new Error(`[discover-crawl] zero pages fetched from ${rootUrl}`);
  log(`crawl done: ${pages.length} pages`);

  // Thin-site backstop: even WITH the headless-render fallback (B-10.1), the
  // crawl surfaced almost no text — fail LOUDLY instead of "zero groups".
  const totalText = pages.reduce((n, p) => n + p.text.length, 0);
  if (totalText < 600) {
    throw new Error(
      `[discover-crawl] crawl surfaced only ${totalText} chars of text across ${pages.length} ` +
      `page(s), even after the headless-render fallback. The site publishes too little crawlable ` +
      `content at this root — pick a different labRoot or treat this lab as not discoverable.`,
    );
  }

  const groups = await extractGroups(pages, log);
  log(`extracted ${groups.length} group(s)/PI(s)`);
  if (!groups.length) throw new Error('[discover-extract] zero groups extracted');

  const pool = buildCandidatePool();
  const { shortlist, dropped } = await rankGroups(groups, pages, pool, log);
  log(`ranked: ${shortlist.length} on shortlist, ${dropped} invalid rationale(s) dropped`);

  return { lab, rootUrl, fetchedPages: pages, shortlist, droppedRationales: dropped, generatedAt: new Date().toISOString() };
}

export function writeDiscovery(d: LabDiscovery): { mdPath: string; jsonPath: string } {
  const dir = outDirFor(d.lab);
  mkdirSync(dir, { recursive: true });

  const jsonPath = join(dir, 'discovery.json');
  // fetchedPages kept (guard + outreach need the source texts), but truncated per page.
  const slim = {
    ...d,
    fetchedPages: d.fetchedPages.map((p) => ({ ...p, text: p.text.slice(0, PAGE_EXCERPT_CHARS) })),
  };
  writeFileSync(jsonPath, JSON.stringify(slim, null, 2));

  const lines: string[] = [];
  lines.push(`# ${d.lab} — target discovery`);
  lines.push('');
  lines.push(`> Root: ${d.rootUrl} · ${d.fetchedPages.length} published pages crawled · generated ${d.generatedAt}`);
  lines.push(`> SHORTLIST FOR APPROVAL — discovery never auto-creates outreach drafts. Pick recipients in Resume Studio → Outreach.`);
  lines.push('');
  d.shortlist.forEach((g, i) => {
    lines.push(`## ${i + 1}. ${g.name}${g.pi ? ` — PI: ${g.pi}` : ''}  (fit ${g.fitScore}/100)`);
    if (g.topics.length) lines.push(`**Topics:** ${g.topics.join('; ')}`);
    if (g.people.length) lines.push(`**People listed:** ${g.people.join(', ')}`);
    lines.push('');
    lines.push(`**Fit rationale** (each cites vault claim id + source URL):`);
    for (const r of g.rationales) lines.push(`- ${r.text}  \n  ↳ claim \`${r.claimId}\` · source ${r.sourceUrl}`);
    const acc: string[] = [];
    if (g.accessibility.statedUndergradProgram) acc.push(`stated undergrad program: ${g.accessibility.statedUndergradProgram}`);
    if (g.accessibility.joinPage) acc.push(`join page: ${g.accessibility.joinPage}`);
    if (g.accessibility.undergradCoauthors) acc.push(`undergrad involvement: ${g.accessibility.undergradCoauthors}`);
    if (g.undergradProcess) acc.push(`stated process: ${g.undergradProcess}`);
    if (acc.length) { lines.push(''); lines.push(`**Accessibility signals:** ${acc.join(' · ')}`); }
    lines.push('');
    if (g.contact?.kind === 'email') {
      lines.push(`**Published contact:** ${g.contact.value} (published at ${g.contact.sourceUrl})`);
    } else if (g.contact?.kind === 'application-page') {
      lines.push(`**Contact route:** application page only — ${g.contact.value}`);
    } else {
      lines.push(`**Contact route:** application page only (no published route found on crawled pages)`);
    }
    lines.push('');
  });

  const mdPath = join(dir, 'discovery.md');
  writeFileSync(mdPath, lines.join('\n'));
  return { mdPath, jsonPath };
}
