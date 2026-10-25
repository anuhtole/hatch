/**
 * lib/resume/ground-truth.ts
 *
 * Phase 1 of the vault-grounded resume builder.
 *
 * Loads the user's real experience + project records from the Obsidian vault
 * (via lib/vault.ts) and turns each into a SOURCE-TAGGED record: frontmatter +
 * heading-delimited sections + the full raw markdown. The `raw` field is kept
 * verbatim per record so a later anti-fabrication guard can string/number-match
 * generated resume output against the actual source text.
 *
 * Additive only — independent of the legacy career-ops module (whose
 * apply-to-role flow was retired in B-9).
 */

import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import matter from 'gray-matter';
import { readNote } from '@/lib/vault';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SourceKind = 'experience' | 'project' | 'education' | 'additional' | 'contact';

export interface SourceSection {
  heading: string;
  level: number; // 1–6, from the number of leading '#'
  text: string;  // body text under this heading, up to the next heading
}

export interface SourceRecord {
  sourcePath: string;                   // relative vault path it came from
  kind: SourceKind;
  frontmatter: Record<string, unknown>; // title, role, period, location, type, …
  sections: SourceSection[];            // parsed from ## / ### …
  raw: string;                          // full raw markdown (for later verification)
  error?: string;                       // set instead of throwing if the file is missing
}

export interface GroundTruth {
  records: SourceRecord[];
  generatedAt: string; // ISO timestamp
}

// ── Source discovery ──────────────────────────────────────────────────────────
// Auto-discover source files by directory (sorted → deterministic record order
// and stable ids downstream). Skills live inside the experience files' "Skills
// Developed" sections (03-professional/skills/ is empty), so no separate skills
// file. VAULT_PATH mirrors lib/vault.ts so both resolve the same root.

const VAULT_PATH = process.env.VAULT_PATH ?? join(homedir(), 'vault');

const EXPERIENCE_DIR = '03-professional/resume/experience'; // flat
const PROJECTS_DIR = '04-projects';                          // recurse subfolders
// Education / Additional sections (NOT the canonical resume.md pointer or the
// .docx — discovery only finds .md, and the pointer lives one level up).
const SECTIONS_DIR = '03-professional/resume/sections';      // flat

/** Map a section filename to its kind: additional.md → 'additional'; contact.md →
 *  'contact' (header metadata, not claims); user-stated.md → 'additional' (general
 *  interview answers: pool-visible for gap coverage, but structurally excluded from
 *  résumé SELECT and from the membership universes, which filter by filename);
 *  everything else (education.md, coursework.md) → 'education'. */
function sectionKind(relPath: string): SourceKind {
  if (/\badditional\.md$/i.test(relPath)) return 'additional';
  if (/\bcontact\.md$/i.test(relPath)) return 'contact';
  if (/\buser-stated\.md$/i.test(relPath)) return 'additional';
  return 'education';
}

// A file is skipped (kept out of the pool) when it is not "ready":
//   - it contains a TODO(Anatole) marker (an unconfirmed draft), OR
//   - it is a deprecated redirect stub (a duplicate pointing elsewhere), OR
//   - (projects) it lives in a project folder whose owner marked ANY file
//     TODO(Anatole) — the whole project is unconfirmed, so its frontmatter-less
//     sibling docs are unconfirmed too (B-16).
// NOTE (B-16): a missing YAML frontmatter is NO LONGER a skip. Real confirmed
// content (e.g. 04-projects/spine/Spine Shipped Features.md) is a flat dump with
// no frontmatter; it is ingested with path-inferred defaults and the structural
// noise filter (downstream) drops its chat preamble / section labels.
const SKIP_MARKER = 'TODO(Anatole)';
const REDIRECT_RE = /tags:\s*\[[^\]]*\bredirect\b|has been renamed|status:\s*deprecated/i;

/** The project folder a vault-relative path belongs to (e.g.
 *  "04-projects/spine/Spine Shipped Features.md" → "04-projects/spine"), or null
 *  for non-project paths / files directly under 04-projects. */
function projectFolderOf(relPath: string): string | null {
  const parts = relPath.split('/');
  return parts.length >= 3 && parts[0] === '04-projects' ? `${parts[0]}/${parts[1]}` : null;
}

/** Recursively list *.md under a vault-relative dir, returning sorted relative paths. */
function discoverMarkdown(relDir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      return; // missing dir — nothing to discover
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const full = join(abs, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && entry.toLowerCase().endsWith('.md')) {
        out.push(relative(VAULT_PATH, full));
      }
    }
  };
  walk(join(VAULT_PATH, relDir));
  return out.sort();
}

/**
 * Load a discovered file, or return null to skip a not-ready file (TODO(Anatole)
 * marker, deprecated/redirect stub, or `blockedFolder` — a project folder the
 * owner flagged unconfirmed). Missing frontmatter is NOT a skip (B-16).
 * Unreadable files still surface as errored records.
 */
function loadDiscovered(relPath: string, kind: SourceKind, blockedFolder = false): SourceRecord | null {
  const note = readNote(relPath);
  if (
    note &&
    (blockedFolder || note.content.includes(SKIP_MARKER) || REDIRECT_RE.test(note.content))
  ) {
    return null;
  }
  return loadRecord(relPath, kind);
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Split markdown body into heading-delimited sections. Generic: any level of
 * ATX heading (#…######) starts a section; its text runs to the next heading.
 * Content before the first heading (preamble) is not a section but is preserved
 * in the record's `raw`. Fenced code blocks are tracked so a '#' comment inside
 * a ``` block isn't mistaken for a heading.
 */
function parseSections(body: string): SourceSection[] {
  const lines = body.split('\n');
  const sections: SourceSection[] = [];
  let current: { heading: string; level: number; lines: string[] } | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      if (current) current.lines.push(line);
      continue;
    }

    const m = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (m) {
      if (current) {
        sections.push({ heading: current.heading, level: current.level, text: current.lines.join('\n').trim() });
      }
      current = { heading: m[2].trim(), level: m[1].length, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push({ heading: current.heading, level: current.level, text: current.lines.join('\n').trim() });
  }

  // B-16 fallback: a file with NO ATX headings (a flat dump like
  // "Spine Shipped Features.md") yields zero sections above, so its real content
  // would never become claims. Re-parse it treating a short, non-terminal "label"
  // line as a heading and the paragraph lines beneath it as that section's body.
  // Only triggers when ATX found nothing — normal markdown files are untouched.
  if (sections.length === 0 && body.trim()) return parseBareHeadingSections(lines);

  return sections;
}

/** True if a line reads as a bare section label rather than a content sentence:
 *  short, not a list item, not ending in sentence/clause punctuation. */
function isBareHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^[-*●]\s+/.test(t)) return false;          // list item, not a heading
  if (/[.!?:;,]$/.test(t)) return false;          // sentence/clause → content, not a label
  return t.split(/\s+/).length <= 7;              // labels are short
}

/** Heading-less flat-file parser: bare label lines start sections; content before
 *  the first label is preamble (dropped, like ATX preamble). If no label is found,
 *  the whole body becomes a single "Notes" section (the noise filter still applies). */
function parseBareHeadingSections(lines: string[]): SourceSection[] {
  const sections: SourceSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; if (current) current.lines.push(line); continue; }
    if (!inFence && isBareHeading(line)) {
      if (current) sections.push({ heading: current.heading, level: 2, text: current.lines.join('\n').trim() });
      current = { heading: line.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, level: 2, text: current.lines.join('\n').trim() });
  if (sections.length === 0) {
    return [{ heading: 'Notes', level: 2, text: lines.join('\n').trim() }];
  }
  return sections;
}

/** Load one vault file into a SourceRecord, tagging it as missing rather than throwing. */
function loadRecord(sourcePath: string, kind: SourceKind): SourceRecord {
  const note = readNote(sourcePath);
  if (!note) {
    return {
      sourcePath,
      kind,
      frontmatter: {},
      sections: [],
      raw: '',
      error: `File not found or unreadable at vault path: ${sourcePath}`,
    };
  }

  // readNote().content is the full raw file (frontmatter included). gray-matter
  // splits the YAML frontmatter from the markdown body; `raw` keeps everything.
  let frontmatter: Record<string, unknown> = {};
  let body = note.content;
  try {
    const parsed = matter(note.content);
    frontmatter = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch (err) {
    // Malformed frontmatter — keep the record, parse sections from the whole file,
    // and note the parse problem.
    return {
      sourcePath,
      kind,
      frontmatter: {},
      sections: parseSections(note.content),
      raw: note.content,
      error: `Frontmatter parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    sourcePath,
    kind,
    frontmatter,
    sections: parseSections(body),
    raw: note.content,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Assemble the full source-tagged ground truth from the vault: every experience
 * and project record, each carrying its frontmatter, parsed sections, and full
 * raw markdown. Missing files surface as records with an `error` note.
 */
export function assembleGroundTruth(): GroundTruth {
  const experiencePaths = discoverMarkdown(EXPERIENCE_DIR);
  const projectPaths = discoverMarkdown(PROJECTS_DIR);
  const sectionPaths = discoverMarkdown(SECTIONS_DIR);

  // Project folders whose owner marked ANY file TODO(Anatole) are unconfirmed:
  // their frontmatter-less sibling docs (which no longer self-skip) are skipped too
  // (B-16 — keeps an unbuilt/draft project like agent-eval fully out of the pool).
  const blockedFolders = new Set<string>();
  for (const p of projectPaths) {
    const note = readNote(p);
    if (note && note.content.includes(SKIP_MARKER)) {
      const folder = projectFolderOf(p);
      if (folder) blockedFolders.add(folder);
    }
  }
  const isBlocked = (p: string): boolean => {
    const folder = projectFolderOf(p);
    return folder !== null && blockedFolders.has(folder);
  };

  const records: SourceRecord[] = [
    ...experiencePaths.map((p) => loadDiscovered(p, 'experience')),
    ...projectPaths.map((p) => loadDiscovered(p, 'project', isBlocked(p))),
    ...sectionPaths.map((p) => loadDiscovered(p, sectionKind(p))),
  ].filter((r): r is SourceRecord => r !== null);

  return {
    records,
    generatedAt: new Date().toISOString(),
  };
}
