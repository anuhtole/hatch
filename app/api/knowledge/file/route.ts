import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, statSync } from 'fs';
import { join, resolve, extname } from 'path';
import { homedir } from 'os';

// Reads a single vault markdown file by relative path. The path is
// resolved against VAULT_PATH and the result must still live inside
// VAULT_PATH — otherwise we refuse the request. This blocks ../ traversal
// and absolute-path injection.

const VAULT_PATH = process.env.VAULT_PATH ?? join(homedir(), 'vault');
const ROOT = resolve(VAULT_PATH);

// Filenames matching these substrings are restricted per CLAUDE.md and
// must not be served — even if the user's vault happens to contain them.
const RESTRICTED = [
  'tax', 'bank', 'loan', 'mortgage', 'credit', 'payroll', 'salary',
  'w2', '1099', '401k', 'ira', 'brokerage', 'statement', 'invoice', 'billing',
  'ssn', 'routing', 'passport', 'social-security', 'birth-certificate',
  'visa', 'immigration', 'i-20', 'driver', 'license', 'medical',
  'insurance', 'hipaa', 'diagnosis', 'prescription', 'health',
];

function isRestricted(rel: string): boolean {
  const lower = rel.toLowerCase();
  return RESTRICTED.some((kw) => lower.includes(kw));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rel = searchParams.get('path') ?? '';
  if (!rel) return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  if (extname(rel) !== '.md') {
    return NextResponse.json({ error: 'Only markdown files are readable' }, { status: 400 });
  }
  if (isRestricted(rel)) {
    return NextResponse.json({ error: 'Restricted content' }, { status: 403 });
  }

  const full = resolve(join(ROOT, rel));
  if (!full.startsWith(ROOT + '/') && full !== ROOT) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const stat = statSync(full);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }
    const content = readFileSync(full, 'utf-8');
    return NextResponse.json({
      path: rel,
      content,
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
