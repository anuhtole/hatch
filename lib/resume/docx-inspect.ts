/**
 * lib/resume/docx-inspect.ts
 *
 * Minimal .docx structural inspector — unzips word/document.xml and extracts the
 * formatting facts the parity guard compares (paragraphs: alignment, bottom border,
 * tab stops, list flag, hyperlink presence; runs: font, size, bold/italic/smallCaps/
 * allCaps; page size + margins). Used on BOTH the canonical vault .docx and the
 * rendered .docx so the parity assertion uses one parser on both sides.
 */

import JSZip from 'jszip';
import { readFileSync } from 'fs';

export interface IRun {
  text: string;
  font?: string;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  smallCaps?: boolean;
  allCaps?: boolean;
}
export interface IPara {
  text: string;
  align?: string;
  borderBottom?: { val: string; sz: number };
  tabs: Array<{ pos: number; val: string }>;
  isList: boolean;
  hasHyperlink: boolean;
  runs: IRun[];
}
export interface IDoc {
  page: { w?: number; h?: number; top?: number; bottom?: number; left?: number; right?: number };
  paragraphs: IPara[];
}

function flag(rpr: string, tag: string): boolean | undefined {
  const re = new RegExp(`<w:${tag}\\b(?:\\s+w:val="([^"]*)")?\\s*/?>`);
  const m = rpr.match(re);
  if (!m) return undefined;
  const v = (m[1] ?? '').toLowerCase();
  return v === '0' || v === 'false' || v === 'off' ? false : true;
}

function parseRun(block: string): IRun {
  const rprMatch = block.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
  const rpr = rprMatch ? rprMatch[1] : '';
  const font = rpr.match(/<w:rFonts[^>]*w:ascii="([^"]*)"/)?.[1];
  const szHalf = rpr.match(/<w:sz\b[^>]*w:val="(\d+)"/)?.[1];
  // Capture text AND structural tabs (<w:tab/>) in document order, so a tabbed
  // line extracts as "left\tright" (the canonical embeds literal \t in w:t; the
  // renderer uses <w:tab/> — both must read back as a separator).
  const text = [...block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>/g)]
    .map((m) => (m[0].startsWith('<w:tab') ? '\t' : m[1]))
    .join('');
  return {
    text: text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
    font,
    sizePt: szHalf ? parseInt(szHalf, 10) / 2 : undefined,
    bold: flag(rpr, 'b'),
    italic: flag(rpr, 'i'),
    smallCaps: flag(rpr, 'smallCaps'),
    allCaps: flag(rpr, 'caps'),
  };
}

function parsePara(block: string): IPara {
  const pprMatch = block.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
  const ppr = pprMatch ? pprMatch[1] : '';
  const align = ppr.match(/<w:jc\b[^>]*w:val="([^"]*)"/)?.[1];
  const bb = ppr.match(/<w:pBdr>[\s\S]*?<w:bottom\b[^>]*w:val="([^"]*)"[^>]*w:sz="(\d+)"/);
  const tabs = [...ppr.matchAll(/<w:tab\b[^>]*w:val="([^"]*)"[^>]*w:pos="(-?\d+)"/g)].map((m) => ({ val: m[1], pos: parseInt(m[2], 10) }));
  const isList = /<w:numPr>/.test(ppr);
  const hasHyperlink = /<w:hyperlink\b/.test(block);
  // runs (includes those nested in hyperlinks — fine for our checks)
  const runs = [...block.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)].map((m) => parseRun(m[0])).filter((r) => r.text !== '' || r.font);
  return {
    text: runs.map((r) => r.text).join(''),
    align,
    borderBottom: bb ? { val: bb[1], sz: parseInt(bb[2], 10) } : undefined,
    tabs,
    isList,
    hasHyperlink,
    runs,
  };
}

export async function inspectDocxBuffer(buf: Buffer): Promise<IDoc> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  // Match BOTH normal paragraphs and self-closing empties (<w:p/>) — blank spacer
  // paragraphs serialize self-closing and are part of the canonical vertical rhythm;
  // missing them silently skews spacer counts and page estimates.
  const paragraphs = [...body.matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((m) => (m[0].endsWith('/>') ? parsePara('') : parsePara(m[0])));
  const pgSz = xml.match(/<w:pgSz\b[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"/);
  const pgMar = xml.match(/<w:pgMar\b[^>]*w:top="(-?\d+)"[^>]*w:right="(-?\d+)"[^>]*w:bottom="(-?\d+)"[^>]*w:left="(-?\d+)"/);
  return {
    page: {
      w: pgSz ? parseInt(pgSz[1], 10) : undefined,
      h: pgSz ? parseInt(pgSz[2], 10) : undefined,
      top: pgMar ? parseInt(pgMar[1], 10) : undefined,
      right: pgMar ? parseInt(pgMar[2], 10) : undefined,
      bottom: pgMar ? parseInt(pgMar[3], 10) : undefined,
      left: pgMar ? parseInt(pgMar[4], 10) : undefined,
    },
    paragraphs,
  };
}

export async function inspectDocxFile(path: string): Promise<IDoc> {
  return inspectDocxBuffer(readFileSync(path));
}
