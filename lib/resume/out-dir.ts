/**
 * lib/resume/out-dir.ts
 *
 * Per-target output directory resolution (B-8). Every run's artifacts land in
 * out/<target>/ (e.g. out/bair/tailored-resume.docx); the legacy single-target
 * flow keeps writing to out/ directly (target = none). Guards resolve the SAME
 * directory via --target=<name> argv or the RESUME_TARGET env var, so a guard
 * always reads the run it is checking.
 */

import { join } from 'path';
import { homedir } from 'os';

const BASE = join(homedir(), 'hatch', 'out');

/** Target name from argv (--target=<name>) or RESUME_TARGET env; null = legacy out/. */
export function resolveTargetName(argv: string[] = process.argv): string | null {
  const flag = argv.find((a) => a.startsWith('--target='));
  if (flag) return flag.slice('--target='.length) || null;
  return process.env.RESUME_TARGET || null;
}

/** Output dir for a target name (null → legacy out/). */
export function outDirFor(target: string | null): string {
  if (!target) return BASE;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(target)) throw new Error(`invalid target name: ${target}`);
  return join(BASE, target);
}

/** Convenience: resolve from the current process context. */
export function resolveOutDir(): string {
  return outDirFor(resolveTargetName());
}
