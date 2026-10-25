/**
 * lib/resume/render-page.ts — shared headless-render fallback (B-10.1).
 *
 * One implementation for every JS-shell fallback (fetch-target retries, the
 * discovery crawler) — a page that serves markup but no text is client-rendered,
 * so we load the SAME url in headless chromium and read the real DOM:
 * body.innerText for content, anchor hrefs for link discovery (client-rendered
 * nav is invisible to a plain fetch).
 *
 * Callers own policy: when to fall back (their own thresholds), robots checks
 * (the url must already be robots-cleared before calling), and pacing. Call
 * closeRenderer() when done — the chromium instance is a lazy singleton so a
 * crawl doesn't relaunch the browser per page.
 */

import type { Browser } from 'playwright';

const RENDER_TIMEOUT_MS = 30_000;
const PAINT_WAIT_MS = 4_000; // let the client app paint after domcontentloaded

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import('playwright').then(({ chromium }) => chromium.launch({ headless: true }));
  }
  return browserPromise;
}

export interface RenderedPage {
  text: string;    // document.body.innerText, whitespace-normalized
  links: string[]; // absolute hrefs from the rendered DOM
}

/** Render one page. Returns null on any failure (callers decide to STOP or skip). */
export async function renderPage(url: string): Promise<RenderedPage | null> {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
      await page.waitForTimeout(PAINT_WAIT_MS);
      const { text, links } = await page.evaluate(() => ({
        text: document.body.innerText,
        links: Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href),
      }));
      return {
        text: text.replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim(),
        links: [...new Set(links)],
      };
    } finally {
      await page.close();
    }
  } catch {
    return null;
  }
}

/** Close the shared browser (no-op if never launched). Safe to call repeatedly. */
export async function closeRenderer(): Promise<void> {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try { (await p).close(); } catch { /* already gone */ }
}
