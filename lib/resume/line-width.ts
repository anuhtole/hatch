/**
 * lib/resume/line-width.ts
 *
 * Width measurement for the canonical Garamond .docx body (10.5 pt), used by:
 *   - the coursework packer (fill exactly N wrapped lines, no orphan), and
 *   - the experience line-fill optimizer (keep the last wrapped line ≥80% full).
 *
 * Method (Phase-0d): there is no Garamond font-metrics file available, so we use
 * the Times-Roman AFM per-glyph advance widths (a near-identical old-style serif)
 * as the proportional SHAPE, then SCALE-CALIBRATE the absolute size to real
 * canonical full lines extracted from the CV .docx. Calibration (Phase 0):
 *
 *   usable width = page 12240 − margins(720+720) = 10800 twips (7.5")
 *   4 canonical full lines (author packed each to exactly fill the 7.5" line):
 *     [32] 134c  "● Refined, organized, … by 15%"            53051 AFM units
 *     [38] 130c  "● Integrated fine-tuned LLM … costs"       53158
 *     [19] 130c  "● Architected multi-agent … editing"       51576
 *     [7]  126c  "Relevant Coursework: … Physics"            52214
 *   median = 53051 units ⇒ K = 10800 / 53051 = 0.20358 twips/unit.
 *   Cross-validation: those lines measure 10800 / 10822 / 10500 / 10630 twips
 *   (err −2.8%…+0.2%). 3% safety margin ⇒ LINE_BUDGET = 10476 twips.
 *
 * Pure, deterministic, no I/O.
 */

// ── Constants (calibrated in Phase 0d) ─────────────────────────────────────────

export const USABLE_TWIPS = 10800;          // writable line width (7.5")
export const SAFETY = 0.03;                 // proxy-metric safety margin
export const LINE_BUDGET = Math.round(USABLE_TWIPS * (1 - SAFETY)); // 10476
export const K = 10800 / 53051;             // twips per AFM unit (calibration anchor)
export const FILL_TARGET = 0.80;            // a wrapped last line should be ≥80% full

// Times-Roman AFM advance widths (/1000 em). Unlisted glyphs default to 500.
const AFM: Record<string, number> = {
  ' ': 250, '!': 333, '"': 408, '#': 500, $: 500, '%': 833, '&': 778, "'": 180,
  '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333, '.': 250, '/': 278,
  '0': 500, '1': 500, '2': 500, '3': 500, '4': 500, '5': 500, '6': 500, '7': 500,
  '8': 500, '9': 500, ':': 278, ';': 278, '<': 564, '=': 564, '>': 564, '?': 444, '@': 921,
  A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389,
  K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611,
  U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611, '[': 333, '\\': 278, ']': 333,
  '^': 469, _: 500, '`': 333,
  a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278,
  k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278,
  u: 500, v: 500, w: 722, x: 500, y: 500, z: 444, '{': 480, '|': 200, '}': 480, '~': 541,
  '●': 500, '—': 1000, '–': 500, '’': 333, '‘': 333, '“': 408, '”': 408, '…': 1000,
};

/** Calibrated width of a string in twips (proportional, Garamond-proxy). */
export function measureTwips(s: string): number {
  let units = 0;
  for (const ch of s) units += AFM[ch] ?? 500;
  return units * K;
}

/**
 * Simulate greedy word-wrap of `text` into visual lines at `maxTwips` (default the
 * real usable width). A word never splits; a single over-long word occupies its own
 * line. This mirrors how Word lays the paragraph out, so we can inspect the LAST line.
 */
export function wrapLines(text: string, maxTwips: number = USABLE_TWIPS): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (cur && measureTwips(trial) > maxTwips) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Fill fraction (0..1) of the bullet's LAST visual line, relative to the usable width. */
export function lastLineFill(text: string): number {
  const lines = wrapLines(text);
  return measureTwips(lines[lines.length - 1]) / USABLE_TWIPS;
}

export interface LineFillMeasure {
  lineCount: number;
  lastLineFill: number; // 0..1
  lastWordCount: number;
  orphan: boolean;      // multi-line AND last line is 1–2 words
  needsFill: boolean;   // multi-line AND (last line <80% full OR orphan)
}

/** Measure a single rendered bullet/line string for the line-fill optimizer. */
export function measureLineFill(text: string): LineFillMeasure {
  const lines = wrapLines(text);
  const last = lines[lines.length - 1];
  const lastWordCount = last.split(/\s+/).filter(Boolean).length;
  const fill = measureTwips(last) / USABLE_TWIPS;
  const multi = lines.length > 1;
  const orphan = multi && lastWordCount <= 2;
  return {
    lineCount: lines.length,
    lastLineFill: fill,
    lastWordCount,
    orphan,
    needsFill: multi && (fill < FILL_TARGET || orphan),
  };
}

// ── Coursework packer ──────────────────────────────────────────────────────────

export interface PackResult {
  selected: string[];   // course names, in render order (verbatim — never altered)
  lines: string[];      // simulated wrapped lines of the full coursework paragraph
  lineCount: number;
  lastLineFill: number; // 0..1
}

/**
 * Greedily pack JD-ranked course names into exactly `lineBudget` wrapped lines of
 * the rendered coursework paragraph ("<prefix><c1>, <c2>, …"). Verbatim names only
 * — never truncated/abbreviated/rephrased.
 *
 *  - add a course only if the whole paragraph still wraps to ≤ lineBudget lines and
 *    no line overflows LINE_BUDGET (3% safety);
 *  - ONE-lookahead swap: if the next-ranked course doesn't fit, try the best later
 *    course that does (maximize fill) before giving up;
 *  - NO ORPHAN: if the final line ends up a single short dangling token, drop it.
 *
 * `prefix` is the bold "Relevant Coursework: " label rendered inline on line 1
 * (same font/size ⇒ same width metric), so it counts against the budget.
 */
export function packCourses(
  rankedNames: string[],
  lineBudget: number,
  prefix = 'Relevant Coursework: ',
): PackResult {
  const fits = (names: string[]): { ok: boolean; lines: string[] } => {
    const para = prefix + names.join(', ');
    const lines = wrapLines(para, USABLE_TWIPS);
    const ok =
      lines.length <= lineBudget &&
      lines.every((l) => measureTwips(l) <= LINE_BUDGET);
    return { ok, lines };
  };

  const chosen: string[] = [];
  const remaining = [...rankedNames];

  while (remaining.length) {
    // Try the next-ranked course first (preserve JD relevance order).
    const next = remaining[0];
    if (fits([...chosen, next]).ok) {
      chosen.push(next);
      remaining.shift();
      continue;
    }
    // One-lookahead swap: best later course that still fits (most fill = longest name).
    let swapIdx = -1;
    let swapWidth = -1;
    for (let i = 1; i < remaining.length; i++) {
      if (fits([...chosen, remaining[i]]).ok) {
        const w = measureTwips(remaining[i]);
        if (w > swapWidth) { swapWidth = w; swapIdx = i; }
      }
    }
    if (swapIdx >= 0) {
      chosen.push(remaining[swapIdx]);
      remaining.splice(swapIdx, 1);
      continue;
    }
    break; // nothing else fits in the budget
  }

  // No-orphan: drop a lone short dangling token on the final line.
  let result = fits(chosen);
  if (chosen.length > 1 && result.lines.length === lineBudget) {
    const lastLine = result.lines[result.lines.length - 1];
    const lastWords = lastLine.split(/\s+/).filter(Boolean).length;
    if (lastWords <= 2 && measureTwips(lastLine) / USABLE_TWIPS < 0.30) {
      chosen.pop();
      result = fits(chosen);
    }
  }

  const lastFill = measureTwips(result.lines[result.lines.length - 1]) / USABLE_TWIPS;
  return { selected: chosen, lines: result.lines, lineCount: result.lines.length, lastLineFill: lastFill };
}
