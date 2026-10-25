/**
 * lib/resume/fetch-job.ts
 *
 * Fetch a job posting from a URL and extract readable text, so the resume
 * builder can take a link instead of pasted text.
 *
 * The fetch/extract logic is PORTED (self-contained — no import from the
 * career-ops module, which is being retired): try the common ATS public APIs
 * first (Ashby / Greenhouse / Lever), then fall back to plain HTML stripping.
 *
 * Returns source: 'too-thin' when the extracted text is too short to be a real
 * JD (< ~400 chars) or is an obvious client-rendered JS shell — the caller
 * should then fall back to a manually-pasted JD.
 */

// Default target for the end-to-end runner (overridable via env ANTHROPIC_JD_URL).
// Anthropic postings are served by Greenhouse's `job-boards.greenhouse.io` host, which
// the ATS regex below resolves to the public boards-api (board=anthropic).
export const ANTHROPIC_JD_URL = 'https://job-boards.greenhouse.io/anthropic/jobs/5181852008';

const TOO_THIN_CHARS = 400;
// A real JD is comfortably longer than this; below it, a JS-shell marker is
// trusted. (Guards against false-positives: many content-rich pages include a
// <noscript>/"enable JavaScript" fallback but are NOT shells.)
const SHELL_MAX_CHARS = 1200;

// Distinctive client-rendered-shell phrases that don't appear in real JD prose.
const JS_SHELL_RE =
  /enable JavaScript to run this app|you need to enable JavaScript|please enable JavaScript to (?:use|view|continue)/i;

/** Decode the common HTML entities. Greenhouse's `content` field is ENTITY-ENCODED
 *  HTML (e.g. "&lt;p&gt;…&lt;/p&gt;"), so we must decode before stripping tags or the
 *  encoded tags survive as literal boilerplate. &amp; is decoded LAST to avoid
 *  double-decoding. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&rsquo;|&#8217;/gi, '’')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function stripHtml(html: string): string {
  // Decode first so entity-encoded tags become real tags and get stripped too.
  return decodeEntities(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Try structured ATS public APIs. Returns extracted text or null to fall through. */
async function fetchFromAts(url: string): Promise<string | null> {
  try {
    const ashby = url.match(/ashbyhq\.com\/([^/]+)\/([a-f0-9-]{36})/i);
    if (ashby) {
      const jobId = ashby[2];
      const res = await fetch(`https://api.ashbyhq.com/posting-public/jobPosting?jobPostingId=${jobId}`);
      if (res.ok) {
        const d = (await res.json()) as { title?: string; organizationName?: string; descriptionHtml?: string };
        return `# ${d.title ?? 'Role'} at ${d.organizationName ?? 'Company'}\n\n${stripHtml(d.descriptionHtml ?? '')}`;
      }
    }

    const gh = url.match(/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
    if (gh) {
      const [, board, jobId] = gh;
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`);
      if (res.ok) {
        const d = (await res.json()) as { title?: string; location?: { name?: string }; content?: string };
        return `# ${d.title ?? 'Role'}\nLocation: ${d.location?.name ?? 'Unknown'}\n\n${stripHtml(d.content ?? '')}`;
      }
    }

    const lever = url.match(/lever\.co\/([^/]+)\/([a-f0-9-]{36})/i);
    if (lever) {
      const [, company, postingId] = lever;
      const res = await fetch(`https://api.lever.co/v0/postings/${company}/${postingId}`);
      if (res.ok) {
        const d = (await res.json()) as {
          text?: string; description?: string; lists?: { text: string; content: string }[];
        };
        const sections = (d.lists ?? []).map((l) => `## ${l.text}\n${l.content}`).join('\n\n');
        return stripHtml(`# ${d.text ?? 'Role'} at ${company}\n\n${d.description ?? ''}\n\n${sections}`);
      }
    }
  } catch {
    /* fall through to plain HTML */
  }
  return null;
}

export async function fetchJobPosting(url: string): Promise<{ text: string; source: 'fetch' | 'too-thin' }> {
  let text = '';
  try {
    const ats = await fetchFromAts(url);
    if (ats && ats.trim()) {
      text = ats.trim();
    } else {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Hatch/1.0)' },
        signal: AbortSignal.timeout(15_000),
      });
      const html = await res.text();
      text = stripHtml(html).slice(0, 10_000);
    }
  } catch {
    // Network/parse failure → treat as too-thin so the caller falls back.
    return { text: '', source: 'too-thin' };
  }

  // Primary signal: readable length. Secondary: a distinctive shell marker in
  // otherwise-thin content (a long, real JD is never a shell).
  if (text.length < TOO_THIN_CHARS) {
    return { text, source: 'too-thin' };
  }
  if (text.length < SHELL_MAX_CHARS && JS_SHELL_RE.test(text)) {
    return { text, source: 'too-thin' };
  }
  return { text, source: 'fetch' };
}
