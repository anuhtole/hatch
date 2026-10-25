/**
 * lib/resume/word-pdf.ts — Word-authoritative docx → PDF export (B-14 part 3).
 *
 * The shipped résumé must paginate EXACTLY as Microsoft Word renders it — Word
 * authored the canonical one-page CV, and LibreOffice (the B-11 engine) paginates
 * ~half a page looser, rendering even the canonical CV as two pages regardless of
 * font. So Word itself is the rendering authority: this module drives the installed
 * Word.app via AppleScript to produce the real text-layer PDF and reports its true
 * page count.
 *
 * ENVIRONMENT: macOS with Microsoft Word installed, signed in, and granted
 * Automation permission for the controlling terminal. Fails LOUDLY (never silently
 * falls back to a looser engine) so a broken Word automation can't ship a
 * mis-paginated résumé.
 *
 * The genuine Monotype Garamond (Office's GARA.ttf family) must be installed as the
 * "Garamond" family — see scripts/install-garamond.sh.
 */

import { execFileSync } from 'child_process';
import { existsSync, unlinkSync, readFileSync, copyFileSync } from 'fs';
import { dirname, join, basename } from 'path';
import { homedir } from 'os';

// AppleScript: activate Word, open the docx by POSIX path, export as PDF, close
// without saving. `activate` + a settle delay are REQUIRED — without them Word
// returns -609 "Connection is invalid" on the open/save handoff.
const WORD_EXPORT_OSA = `
on run argv
  set inPOSIX to item 1 of argv
  set outPOSIX to item 2 of argv
  tell application "Microsoft Word"
    activate
    open POSIX file inPOSIX
    delay 1.5
    set theDoc to active document
    save as theDoc file name outPOSIX file format format PDF
    delay 0.4
    close theDoc saving no
  end tell
  return "ok"
end run
`;

/** Count pages in a PDF via the page-tree /Count (fallback: /Type /Page objects). */
export function pdfPageCount(pdfPath: string): number {
  const raw = readFileSync(pdfPath).toString('latin1');
  const counts = [...raw.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length) return Math.max(...counts);
  const pageObjs = raw.match(/\/Type\s*\/Page(?![s\w])/g);
  return pageObjs ? pageObjs.length : 0;
}

export interface WordPdfExport { pdfPath: string; pages: number }

/**
 * Convert `docxPath` → PDF via Word, written to `outName` in the docx's directory.
 * Returns the path and Word's true page count. Throws loudly on any failure.
 * Does NOT enforce a page count — callers (the roster-fit loop) read `pages`.
 */
export function convertDocxToPdfViaWord(docxPath: string, outName: string): WordPdfExport {
  if (!existsSync(docxPath)) throw new Error(`word-pdf: docx not found: ${docxPath}`);
  const pdfPath = join(dirname(docxPath), outName);
  if (existsSync(pdfPath)) unlinkSync(pdfPath); // stale-result guard

  // Word can stall when a leftover document/modal (e.g. a recovery dialog from a
  // prior crash) blocks AppleScript. Attempt once; on failure, clear open
  // documents and retry. NEVER force-kill Word — that itself triggers the
  // recovery dialog on next launch.
  const attempt = (): string =>
    execFileSync('osascript', ['-e', WORD_EXPORT_OSA, docxPath, pdfPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000, // generous: first export after a cold Word launch is slow
      encoding: 'utf-8',
    }).trim();

  let out = '';
  try {
    out = attempt();
  } catch (firstErr) {
    try {
      execFileSync('osascript', ['-e', 'tell application "Microsoft Word" to close every document saving no'], {
        stdio: 'pipe', timeout: 30_000,
      });
      out = attempt();
    } catch (retryErr) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(
        `word-pdf: Word export failed for ${basename(docxPath)} (after recovery retry) — ${msg}\n` +
        `Ensure Microsoft Word is installed, signed in (past any license/recovery dialog), and that the ` +
        `terminal has Automation permission for Word (System Settings → Privacy & Security → Automation).`,
      );
    }
  }
  if (!existsSync(pdfPath)) {
    throw new Error(`word-pdf: Word reported "${out}" but produced no PDF at ${pdfPath}`);
  }
  return { pdfPath, pages: pdfPageCount(pdfPath) };
}

/** True when Word.app is present (the convert call activates it; it need not be
 *  already running). The convert function is the real reachability test — it
 *  fails loudly if automation/sign-in is blocked. */
export function wordAvailable(): boolean {
  return existsSync('/Applications/Microsoft Word.app');
}

/**
 * Warm up + health-check Word before the pipeline's render-heavy roster fit:
 * export the canonical one-page CV. This (1) launches Word past any cold-start /
 * recovery dialog while we can still fail with a clear message, (2) proves the
 * whole chain works (Word automation + genuine Garamond + 1-page pagination)
 * against a KNOWN one-page document, so a later 2-page render is real content,
 * not a broken renderer. Throws if Word is unreachable or the canonical isn't 1pg.
 */
export function warmUpWord(scratchDir: string): void {
  const canonical = join(homedir(), 'vault', 'Anatole Palmer Seychal CV.docx');
  if (!existsSync(canonical)) return; // no canonical to check against — skip warm-up
  const warm = join(scratchDir, 'word-warmup.docx');
  copyFileSync(canonical, warm);
  const { pages } = convertDocxToPdfViaWord(warm, 'word-warmup.pdf');
  if (pages !== 1) {
    throw new Error(
      `word-pdf warm-up: the canonical one-page CV rendered as ${pages} pages in Word — the ` +
      `genuine Monotype Garamond may not be installed (run scripts/install-garamond.sh) or Word's ` +
      `layout is off. Fix before trusting the pipeline's one-page fit.`,
    );
  }
}
