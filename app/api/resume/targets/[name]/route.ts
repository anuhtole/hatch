/**
 * DELETE /api/resume/targets/[name] — remove a resume target: its definition
 * (targets/<name>.json) AND all rendered artifacts (out/<name>/). B-43.
 *
 * BOUNDED + SAFE:
 *  - HARD-PROTECTS the canonical seed targets (chai/bair/industry-pm) → 403, no override.
 *  - validates the name with the SAME regex outDirFor uses (rejects path traversal).
 *  - asserts the resolved out dir is strictly UNDER ~/hatch/out/ and is NOT the out/ root
 *    before any recursive remove; asserts the target JSON resolves strictly under targets/.
 *  - NEVER touches the out/ root, out/selection-diff.md, out/canonical-format-manifest.json,
 *    the vault, KnowledgeItem, or the interview suppression dotfile.
 */

import { NextResponse } from 'next/server';
import { existsSync, rmSync, unlinkSync, copyFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { homedir } from 'os';
import { outDirFor } from '@/lib/resume/out-dir';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ name: string }> };

/** Canonical seed targets — hard-protected, cannot be deleted (no override). */
const PROTECTED = new Set(['chai', 'bair', 'industry-pm']);
/** Mirrors the name rule in lib/resume/out-dir.ts. */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export async function DELETE(_req: Request, { params }: Params) {
  const { name } = await params;

  // (a) hard protection — canonical seed targets cannot be deleted (no override param).
  if (PROTECTED.has(name)) {
    return NextResponse.json(
      { error: `"${name}" is a protected canonical target and cannot be deleted.` },
      { status: 403 },
    );
  }
  // (b) name validation — same rule as outDirFor; rejects traversal / odd names.
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: `invalid target name: ${name}` }, { status: 400 });
  }

  const outRoot = resolve(join(homedir(), 'hatch', 'out'));
  const targetsDir = resolve(join(homedir(), 'hatch', 'targets'));
  const removed: string[] = [];

  // (c) out/<name>/ — resolve via outDirFor (throws on a bad name: defense in depth),
  //     then assert it is strictly UNDER out/ and is not the out/ root itself.
  let outDir: string;
  try {
    outDir = resolve(outDirFor(name));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  if (outDir === outRoot || !outDir.startsWith(outRoot + sep)) {
    return NextResponse.json({ error: 'refused: resolved path is the out/ root or escapes it' }, { status: 500 });
  }
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
    removed.push(`out/${name}/`);
  }

  // (d) targets/<name>.json — assert strictly UNDER targets/; back up, then unlink.
  const targetFile = resolve(join(targetsDir, `${name}.json`));
  if (targetFile !== targetsDir && targetFile.startsWith(targetsDir + sep) && existsSync(targetFile)) {
    try { copyFileSync(targetFile, `${targetFile}.bak.${Date.now()}`); } catch { /* best-effort backup */ }
    unlinkSync(targetFile);
    removed.push(`targets/${name}.json`);
  }

  if (removed.length === 0) {
    return NextResponse.json({ error: `target "${name}" not found` }, { status: 404 });
  }
  return NextResponse.json({ deleted: name, removed });
}
