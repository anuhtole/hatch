/**
 * lib/resume/check-outreach.ts — guard:outreach (B-10).
 *
 * Per outreach draft:
 *   1. RECIPIENT-FACT sentences must carry a citation (sourceUrl) resolving to a
 *      fetched source in the draft, and the sentence's named specifics must
 *      appear in recipient sources ∪ vault claims ∪ target profile (reuses the
 *      cover-letter drift machinery: namedSpecifics + TECH_LEXICON). Numbers in
 *      a recipient-fact must appear in the CITED source's text.
 *   2. ENGAGEMENT CLAIMS ("I read/loved/follow your…", "your paper/talk/post" +
 *      first-person engagement verbs) are allowed ONLY when backed by a
 *      user-stated vault claim (sourcePath …/user-stated.md) cited via claimIds.
 *   3. ANATOLE-FACT sentences: every claimId resolves against the vault pool;
 *      named specifics and numbers trace to the cited claims.
 *   4. The attachment must be the guard-passed docx from the target's last
 *      green pipeline run (sha256 equality, recomputed from disk when present).
 *
 * Runnable self-test: `npm run guard:outreach` (fixtures: clean draft passes;
 * engagement violation FAILS; uncited recipient-fact FAILS; bad claim id FAILS;
 * attachment mismatch FAILS; user-stated-backed engagement passes).
 */

import { existsSync } from 'fs';
import { namedSpecifics, TECH_LEXICON } from '@/lib/resume/check-cover-letter';
import { type Claim } from '@/lib/resume/candidate-pool';
import { sha256File, type LastGreen, type OutreachDraft, type DraftSentence } from '@/lib/resume/outreach';

// ── Violations ──────────────────────────────────────────────────────────────────

export interface OutreachViolation {
  check: 'recipient-citation' | 'recipient-specific' | 'recipient-number'
       | 'engagement-claim'
       | 'anatole-claim' | 'anatole-specific' | 'anatole-number'
       | 'attachment';
  sentence?: string;
  detail: string;
}

// ── Engagement-claim pattern list (fixtures cover pass AND fail) ────────────────

export const ENGAGEMENT_RES: RegExp[] = [
  // first person + engagement verb + "your …"
  /\bI(?:['’]ve|['’]d|['’]m| have| had| was| am| recently| just)?\b[^.!?]{0,80}?\b(read|re-read|loved|enjoyed|follow(?:ed|ing)?|saw|watched|listened(?: to)?|heard|came across|discovered|admired?|appreciated?|studied|devoured)\b[^.!?]{0,80}?\b(?:your|you)\b/i,
  // "your paper/talk/… resonated/inspired/struck …"
  /\byour\s+(?:paper|talk|post|work|blog|article|thread|lecture|book|research|course)\b[^.!?]{0,80}?\b(resonat\w*|inspir\w*|struck|impress\w*|changed|shaped)\b/i,
  // "… resonated with me / inspired me"
  /\b(resonat\w* with me|inspired me|stuck with me)\b/i,
];

export function isEngagementClaim(sentence: string): boolean {
  return ENGAGEMENT_RES.some((re) => re.test(sentence));
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function numericCores(s: string): string[] {
  return [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));
}

function lower(s: string): string { return s.toLowerCase(); }

function inText(term: string, haystackLower: string): boolean {
  return haystackLower.includes(term.toLowerCase());
}

export function isUserStatedClaim(c: Claim): boolean {
  return /user-stated\.md$/.test(c.sourcePath);
}

/**
 * RECIPIENT-NAMING exemption (narrow; mirrors the cover-letter target-naming
 * exemption): a named specific passes when EVERY word of it (possessive and
 * trailing-punctuation stripped) appears in the recipient's published
 * name/group/lab string. Addressing "Prof. Fixture" when the published name is
 * "Prof. Test Fixture" is naming the recipient, not introducing a new entity.
 * "Stanford AI Lab" still fails unless every word is in the recipient string.
 */
// Salutations and honorifics are conventional address forms, not facts — they
// are ignored when judging whether a token is recipient-naming.
const ADDRESS_WORDS = new Set(['hi', 'hello', 'dear', 'hey', 'greetings', 'prof', 'professor', 'dr', 'mr', 'ms', 'mrs']);

function isRecipientNaming(token: string, recipientLower: string): boolean {
  const words = token.split(/\s+/)
    .map((w) => w.replace(/['’]s$/i, '').replace(/[.,;:]+$/g, '').toLowerCase())
    .filter((w) => w && !ADDRESS_WORDS.has(w));
  return words.length > 0 && words.every((w) => recipientLower.includes(w));
}

// ── Core check ──────────────────────────────────────────────────────────────────

export interface CheckOutreachOpts {
  /** Expected last-green attachment. When provided, sha equality is enforced; when
   *  the recorded docx exists on disk its hash is recomputed too. */
  lastGreen?: LastGreen | null;
}

export function checkOutreachDraft(
  draft: OutreachDraft,
  claims: Claim[],
  opts: CheckOutreachOpts = {},
): OutreachViolation[] {
  const v: OutreachViolation[] = [];
  const claimById = new Map(claims.map((c) => [c.id, c]));

  const sourceTextByUrl = new Map(draft.sources.map((s) => [s.url, lower(s.text)]));
  const allSourcesLower = draft.sources.map((s) => lower(s.text)).join('\n');
  const allClaimsLower = claims.map((c) => lower(c.text)).join('\n');
  const profileLower = lower(draft.targetProfileText ?? '');
  const recipientLower = lower(`${draft.recipient.name} ${draft.recipient.group} ${draft.lab}`);
  // The drift union: recipient sources ∪ vault claims ∪ target profile (+ the
  // recipient's own published name/group, which the sources establish).
  const union = `${allSourcesLower}\n${allClaimsLower}\n${profileLower}\n${recipientLower}`;

  const checkSpecificsAgainst = (s: DraftSentence, haystackLower: string, check: OutreachViolation['check']) => {
    for (const term of namedSpecifics(s.text)) {
      if (!inText(term, haystackLower) && !isRecipientNaming(term, recipientLower)) {
        v.push({ check, sentence: s.text, detail: `named specific "${term}" not found in allowed grounding` });
      }
    }
    for (const lex of TECH_LEXICON) {
      if (inText(lex, lower(s.text)) && !inText(lex, haystackLower)) {
        v.push({ check, sentence: s.text, detail: `technique term "${lex}" not found in allowed grounding` });
      }
    }
  };

  for (const s of draft.sentences) {
    // 2) Engagement claims — every sentence, regardless of kind.
    if (isEngagementClaim(s.text)) {
      const cited = (s.claimIds ?? []).map((id) => claimById.get(id)).filter((c): c is Claim => !!c);
      const statedCited = cited.filter(isUserStatedClaim);
      if (!statedCited.length) {
        v.push({
          check: 'engagement-claim',
          sentence: s.text,
          detail: 'engagement claim with no user-stated vault claim backing (claims of engagement are Anatole-facts; vault/user-stated only)',
        });
      } else {
        const statedLower = statedCited.map((c) => lower(c.text)).join('\n');
        for (const term of namedSpecifics(s.text)) {
          if (!inText(term, statedLower) && !isRecipientNaming(term, recipientLower)) {
            v.push({ check: 'engagement-claim', sentence: s.text, detail: `engagement specific "${term}" not in the cited user-stated claim(s)` });
          }
        }
      }
    }

    if (s.kind === 'recipient-fact') {
      // 1) citation must resolve to a fetched source
      const srcLower = s.sourceUrl ? sourceTextByUrl.get(s.sourceUrl) : undefined;
      if (!s.sourceUrl || srcLower === undefined) {
        v.push({ check: 'recipient-citation', sentence: s.text, detail: `recipient-fact citation ${s.sourceUrl ? `"${s.sourceUrl}" does not resolve to a fetched source` : 'missing'}` });
      } else {
        for (const n of numericCores(s.text)) {
          if (!inText(n, srcLower)) v.push({ check: 'recipient-number', sentence: s.text, detail: `number "${n}" not in the cited source ${s.sourceUrl}` });
        }
      }
      checkSpecificsAgainst(s, union, 'recipient-specific');
    } else if (s.kind === 'anatole-fact') {
      // 3) provenance against the vault
      const ids = s.claimIds ?? [];
      const cited = ids.map((id) => claimById.get(id));
      if (!ids.length || cited.some((c) => !c)) {
        v.push({ check: 'anatole-claim', sentence: s.text, detail: `claimIds ${ids.length ? `contain unknown id(s): ${ids.filter((id) => !claimById.has(id)).join(', ')}` : 'missing'}` });
      } else {
        const citedLower = (cited as Claim[]).map((c) => lower(c.text)).join('\n');
        const allowed = `${citedLower}\n${profileLower}\n${recipientLower}`;
        for (const term of namedSpecifics(s.text)) {
          if (!inText(term, allowed) && !isRecipientNaming(term, recipientLower)) {
            v.push({ check: 'anatole-specific', sentence: s.text, detail: `named specific "${term}" not in the cited vault claim(s)` });
          }
        }
        for (const n of numericCores(s.text)) {
          if (!inText(n, citedLower)) v.push({ check: 'anatole-number', sentence: s.text, detail: `number "${n}" not in the cited vault claim(s)` });
        }
      }
    } else {
      // connective / ask: no new specifics beyond the union; numbers must trace too.
      checkSpecificsAgainst(s, union, 'recipient-specific');
      for (const n of numericCores(s.text)) {
        if (!inText(n, `${allSourcesLower}\n${allClaimsLower}`)) {
          v.push({ check: 'recipient-number', sentence: s.text, detail: `number "${n}" in ${s.kind} sentence has no source` });
        }
      }
    }
  }

  // 4) attachment = the guard-passed docx from the target's last green run
  if (opts.lastGreen !== undefined) {
    const lg = opts.lastGreen;
    if (!lg) {
      v.push({ check: 'attachment', detail: 'no last green run recorded for this target — attachment cannot be validated' });
    } else {
      // The attachment must be one of the last-green artifacts (docx or B-11
      // pdf), path AND sha — anything else is not a guard-passed file.
      const expected =
        draft.attachmentPath === lg.docxPath ? { path: lg.docxPath, sha: lg.sha256 }
        : lg.pdfPath && draft.attachmentPath === lg.pdfPath ? { path: lg.pdfPath, sha: lg.pdfSha256 ?? '' }
        : null;
      if (!expected) {
        v.push({ check: 'attachment', detail: `attachment path ${draft.attachmentPath} is neither the last-green docx nor pdf` });
      } else {
        if (draft.attachmentSha256 !== expected.sha) {
          v.push({ check: 'attachment', detail: `attachment sha ${draft.attachmentSha256.slice(0, 12)}… ≠ last-green sha ${expected.sha.slice(0, 12)}…` });
        }
        if (existsSync(expected.path) && sha256File(expected.path) !== expected.sha) {
          v.push({ check: 'attachment', detail: `artifact on disk no longer matches last-green sha — re-run the pipeline` });
        }
      }
    }
  }

  return v;
}

// ── Fixture self-test (npm run guard:outreach) ──────────────────────────────────

function fixtureClaims(): Claim[] {
  return [
    {
      id: 'exp-microsoft#impact#0',
      sourcePath: '03-professional/experience/microsoft.md',
      groupKey: '03-professional/experience/microsoft.md',
      kind: 'experience',
      entity: 'Microsoft',
      section: 'Impact',
      text: 'Built an AI Reviewer Agent for Power Apps as a PM intern at Microsoft',
      metrics: [],
      listItem: true,
    },
    {
      id: 'user-stated#general#0',
      sourcePath: '03-professional/resume/sections/user-stated.md',
      groupKey: '03-professional/resume/sections/user-stated.md',
      kind: 'additional',
      entity: 'User-stated',
      section: 'General',
      text: 'I read the Example Lab 2024 progress report on reward learning',
      metrics: [],
      listItem: true,
    },
  ];
}

function fixtureDraft(sentences: DraftSentence[], sha = 'f'.repeat(64)): OutreachDraft {
  return {
    id: 'fixture',
    lab: 'fixture-lab',
    recipient: {
      name: 'Prof. Jane Doe',
      group: 'Example Lab',
      email: 'doe@example.edu',
      emailSourceUrl: 'https://lab.example.edu/people',
      sourceUrls: ['https://lab.example.edu/research'],
    },
    subject: 'Undergrad RA interest — Example Lab',
    sentences,
    body: sentences.map((s) => s.text).join(' '),
    attachmentPath: '/tmp/fixture-resume.docx',
    attachmentSha256: sha,
    sources: [
      {
        url: 'https://lab.example.edu/research',
        text: 'The Example Lab, led by Prof. Jane Doe, studies reward learning and inverse reinforcement learning. The lab hosts 4 undergraduate researchers each year.',
      },
    ],
    targetProfileText: 'Undergraduate research position at Example Lab.',
    createdAt: '2026-06-10T00:00:00Z',
  };
}

interface Fixture { name: string; draft: OutreachDraft; lastGreen?: LastGreen | null; expectPass: boolean; expectCheck?: OutreachViolation['check'] }

function fixtures(): Fixture[] {
  const lgOk: LastGreen = { docxPath: '/tmp/fixture-resume.docx', sha256: 'f'.repeat(64), coverLetterPath: '', completedAt: '2026-06-10T00:00:00Z' };
  return [
    {
      name: 'clean draft passes',
      expectPass: true,
      lastGreen: lgOk,
      draft: fixtureDraft([
        { text: 'The Example Lab studies reward learning and inverse reinforcement learning.', kind: 'recipient-fact', sourceUrl: 'https://lab.example.edu/research' },
        { text: 'As a PM intern at Microsoft I built an AI Reviewer Agent for Power Apps.', kind: 'anatole-fact', claimIds: ['exp-microsoft#impact#0'] },
        { text: 'Would you be open to a brief chat about undergraduate research in your group?', kind: 'ask' },
      ]),
    },
    {
      name: 'greeting naming the recipient passes (recipient-naming exemption)',
      expectPass: true,
      lastGreen: lgOk,
      draft: fixtureDraft([
        { text: 'Dear Prof. Doe, your group’s page describes work on reward learning.', kind: 'recipient-fact', sourceUrl: 'https://lab.example.edu/research' },
        { text: 'Would you have fifteen minutes for a brief chat?', kind: 'ask' },
      ]),
    },
    {
      name: 'engagement claim without user-stated backing FAILS',
      expectPass: false,
      expectCheck: 'engagement-claim',
      lastGreen: lgOk,
      draft: fixtureDraft([
        { text: 'I read your paper on reward learning and loved it.', kind: 'connective' },
        { text: 'Would you be open to a brief chat?', kind: 'ask' },
      ]),
    },
    {
      name: 'engagement claim WITH user-stated backing passes',
      expectPass: true,
      lastGreen: lgOk,
      draft: fixtureDraft([
        { text: 'I read your Example Lab 2024 progress report on reward learning.', kind: 'anatole-fact', claimIds: ['user-stated#general#0'] },
        { text: 'Would you be open to a brief chat?', kind: 'ask' },
      ]),
    },
    {
      name: 'uncited recipient-fact FAILS',
      expectPass: false,
      expectCheck: 'recipient-citation',
      lastGreen: lgOk,
      draft: fixtureDraft([
        { text: 'The Example Lab studies reward learning.', kind: 'recipient-fact' }, // no sourceUrl
      ]),
    },
    {
      name: 'recipient-fact with unsupported specific FAILS',
      expectPass: false,
      expectCheck: 'recipient-specific',
      lastGreen: lgOk,
      draft: fixtureDraft([
        { text: 'Prof. Jane Doe recently won the Turing Award for her work on SWE-bench.', kind: 'recipient-fact', sourceUrl: 'https://lab.example.edu/research' },
      ]),
    },
    {
      name: 'anatole-fact with unknown claim id FAILS',
      expectPass: false,
      expectCheck: 'anatole-claim',
      lastGreen: lgOk,
      draft: fixtureDraft([
        { text: 'I built a recommendation engine at Netflix.', kind: 'anatole-fact', claimIds: ['nonexistent#claim#9'] },
      ]),
    },
    {
      name: 'attachment hash mismatch FAILS',
      expectPass: false,
      expectCheck: 'attachment',
      lastGreen: { docxPath: '/tmp/fixture-resume.docx', sha256: 'a'.repeat(64), coverLetterPath: '', completedAt: '2026-06-10T00:00:00Z' },
      draft: fixtureDraft([
        { text: 'The Example Lab studies reward learning.', kind: 'recipient-fact', sourceUrl: 'https://lab.example.edu/research' },
      ]),
    },
  ];
}

export function runFixtures(): boolean {
  const claims = fixtureClaims();
  let ok = true;
  for (const f of fixtures()) {
    const violations = checkOutreachDraft(f.draft, claims, { lastGreen: f.lastGreen });
    const passed = violations.length === 0;
    const asExpected = f.expectPass
      ? passed
      : !passed && (!f.expectCheck || violations.some((x) => x.check === f.expectCheck));
    console.log(`${asExpected ? '✓' : '✗'} fixture: ${f.name} — ${passed ? '0 violations' : violations.map((x) => x.check).join(', ')}`);
    if (!asExpected) {
      ok = false;
      for (const x of violations) console.log(`    [${x.check}] ${x.detail}${x.sentence ? ` :: ${x.sentence}` : ''}`);
    }
  }
  return ok;
}

if (require.main === module) {
  const ok = runFixtures();
  console.log(ok ? '\nguard:outreach self-test: ALL FIXTURES PASS' : '\nguard:outreach self-test: FIXTURE FAILURES');
  process.exit(ok ? 0 : 1);
}
