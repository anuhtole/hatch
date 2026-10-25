/**
 * lib/resume/fetch-target.ts
 *
 * Target profiles (B-8): generalizes fetch-job from "one JD URL" to a named
 * TARGET — {name, urls[], pastedText?} — e.g. a research lab or group whose
 * relevant context spans several pages plus a pasted description.
 *
 * For each URL: fetch via fetchJobPosting (ATS APIs → HTML strip → too-thin
 * detection). The extracted texts and pastedText concatenate into ONE target
 * profile text, which flows into the SAME injection points a JD does (SELECT
 * emphasis ranking, gap-report, drift-guard term anchoring). A Greenhouse JD is
 * simply the single-URL special case.
 *
 * TRUST: a target profile is treated exactly like a JD + research — it informs
 * EMPHASIS and GAP QUESTIONS only, never content. All containments unchanged.
 *
 * Failure rule (same as fetch-job): an explicitly-configured URL that fails to
 * extract STOPS the run — never a silent fallback.
 *
 * JS-shell pages (e.g. bair.berkeley.edu, a client-rendered Next.js app whose
 * raw HTML strips to 4 chars): when the plain fetch comes back too-thin, we
 * retry ONCE with a headless browser render (playwright chromium, already a
 * repo dependency) and extract document.body.innerText — the SAME url, real
 * rendered text. If that is still too thin, the run STOPs as before.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fetchJobPosting } from '@/lib/resume/fetch-job';
import { renderPage, closeRenderer } from '@/lib/resume/render-page';

export interface TargetDef {
  name: string;          // directory-safe id, e.g. "bair", "chai"
  title?: string;        // human label, e.g. "BAIR — Berkeley AI Research"
  urls: string[];        // 1+ pages to fetch (lab/group/position)
  pastedText?: string;   // optional pasted description, concatenated after fetches
}

export interface TargetProfile {
  name: string;
  title: string;
  text: string;                                    // the assembled profile text
  sources: Array<{ url: string; chars: number }>;  // per-URL extraction sizes
}

export class TargetFetchError extends Error {
  constructor(public url: string, public reason: string) {
    super(`target URL failed: ${url} (${reason})`);
  }
}

/** Load targets/<name>.json from the repo. Throws if missing/invalid. */
export function loadTargetDef(name: string): TargetDef {
  const path = join(homedir(), 'hatch', 'targets', `${name}.json`);
  const def = JSON.parse(readFileSync(path, 'utf-8')) as TargetDef;
  if (!def.name) def.name = name;
  if (!Array.isArray(def.urls)) throw new Error(`targets/${name}.json: "urls" must be an array`);
  if (def.urls.length === 0 && !def.pastedText?.trim()) {
    throw new Error(
      `targets/${name}.json has no urls and no pastedText — fill in the real target URLs ` +
      `(placeholders are never invented; ask Anatole for them).`,
    );
  }
  return def;
}

/** Persist targets/<name>.json (shared by /api/resume/run and the resume_tailor
 *  chat tool). Preserves an existing _note; never silently rewrites semantics. */
export function saveTargetDef(def: TargetDef & { title?: string }): string {
  if (!def.name || !/^[a-z0-9][a-z0-9_-]*$/i.test(def.name)) {
    throw new Error('target name must be a short alphanumeric id');
  }
  const urls = (def.urls ?? []).map((u) => u.trim()).filter(Boolean);
  const pastedText = def.pastedText?.trim() ?? '';
  if (urls.length === 0 && !pastedText) {
    throw new Error('target needs at least one URL or pasted text');
  }
  const targetsDir = join(homedir(), 'hatch', 'targets');
  mkdirSync(targetsDir, { recursive: true });
  const path = join(targetsDir, `${def.name}.json`);
  let note = `Created in-app @ ${new Date().toISOString().slice(0, 10)}.`;
  if (existsSync(path)) {
    try { note = (JSON.parse(readFileSync(path, 'utf-8')) as { _note?: string })._note ?? note; } catch { /* keep default */ }
  }
  writeFileSync(path, JSON.stringify({
    name: def.name, title: def.title?.trim() || def.name, urls, pastedText, _note: note,
  }, null, 2) + '\n');
  return path;
}

// Mirrors fetch-job's readable-length floor: below this, an extraction is not a
// real page of content.
const MIN_CHARS = 400;

/** Headless-render extraction for JS-shell pages (shared renderer, B-10.1):
 *  real DOM innerText after the client app runs. '' on any failure. */
async function renderWithBrowser(url: string): Promise<string> {
  const rendered = await renderPage(url);
  return rendered ? rendered.text.slice(0, 10_000) : '';
}

/**
 * Fetch every URL in the target def and assemble the profile. An explicit URL
 * that comes back 'too-thin'/empty (even after the headless-render retry)
 * throws TargetFetchError — the caller STOPs.
 */
export async function fetchTarget(def: TargetDef): Promise<TargetProfile> {
  const parts: string[] = [];
  const sources: Array<{ url: string; chars: number }> = [];

  try {
    for (const url of def.urls) {
      const fetched = await fetchJobPosting(url);
      let text = fetched.source === 'fetch' ? fetched.text.trim() : '';
      if (!text) {
        // JS-shell retry: same URL, rendered DOM text.
        const rendered = await renderWithBrowser(url);
        if (rendered.length >= MIN_CHARS) text = rendered;
      }
      if (!text) {
        throw new TargetFetchError(url, `extraction came back '${fetched.source}' (${fetched.text.length} chars; headless render also too thin)`);
      }
      parts.push(`=== SOURCE: ${url} ===\n${text}`);
      sources.push({ url, chars: text.length });
    }
  } finally {
    await closeRenderer();
  }

  if (def.pastedText?.trim()) {
    parts.push(`=== PASTED DESCRIPTION ===\n${def.pastedText.trim()}`);
    sources.push({ url: '(pasted)', chars: def.pastedText.trim().length });
  }

  const title = def.title ?? def.name;
  return { name: def.name, title, text: `# ${title}\n\n${parts.join('\n\n')}`, sources };
}
