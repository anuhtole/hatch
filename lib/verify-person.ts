/**
 * lib/verify-person.ts — live web re-verification of a person's current
 * role/affiliation (B-13, Phase 2b).
 *
 * Promotes the one good behavior from the 2026-06-10 freehand session — live
 * re-verification caught that a target had moved institutions — into a
 * first-class chat tool. Every finding carries the source URL it was read
 * from; the output schema deliberately has NO email/contact field, so this
 * tool structurally cannot "find" (i.e. guess) an address. Contact routes
 * come only from discover_targets (verbatim published contacts).
 */

import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';

export interface VerifiedFinding {
  claim: string;     // e.g. "Now Future of Work Lead at BAIR"
  sourceUrl: string; // page the claim was read from
}

export interface PersonVerification {
  name: string;
  org: string;                  // the org the user associated them with
  currentRole?: string;         // best-supported current role/title
  currentAffiliation?: string;  // best-supported current institution
  stillAtOrg: 'yes' | 'no' | 'unclear';
  findings: VerifiedFinding[];  // every finding cited
  caveats?: string;             // ambiguity, conflicting sources, staleness
  verifiedAt: string;           // ISO timestamp of this verification
}

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Server web_search tool (same pattern as lib/resume/research.ts; capped uses).
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
} as unknown as Anthropic.Tool;

const VERDICT_TOOL: Anthropic.Tool = {
  name: 'submit_verification',
  description:
    'Emit the structured verification. Every finding MUST carry the source URL it was read from. ' +
    'Never include an email address or any contact route — that is out of scope for this tool.',
  input_schema: {
    type: 'object',
    properties: {
      currentRole:        { type: 'string', description: 'Best-supported CURRENT role/title, if determinable.' },
      currentAffiliation: { type: 'string', description: 'Best-supported CURRENT institution/org, if determinable.' },
      stillAtOrg: {
        type: 'string',
        enum: ['yes', 'no', 'unclear'],
        description: 'Whether the person still appears to be at the org the user asked about.',
      },
      findings: {
        type: 'array',
        description: 'Each distinct verified fact with the URL it came from.',
        items: {
          type: 'object',
          properties: {
            claim:     { type: 'string' },
            sourceUrl: { type: 'string' },
          },
          required: ['claim', 'sourceUrl'],
        },
      },
      caveats: { type: 'string', description: 'Conflicts, page staleness, name ambiguity — anything the user should weigh.' },
    },
    required: ['stillAtOrg', 'findings'],
  },
};

/**
 * Live web verification. Throws on API failure (callers surface the error —
 * a failed verification must never silently degrade into "probably fine").
 */
export async function verifyPerson(name: string, org: string): Promise<PersonVerification> {
  const prompt =
    `Verify the CURRENT role and affiliation of the person "${name}", previously associated with "${org}". ` +
    `Use web_search on official pages first (lab/department people pages, faculty profiles, the person's own page), ` +
    `then ALWAYS finish by calling submit_verification.\n\n` +
    `Rules:\n` +
    `- Cite the exact URL each finding was read from. A claim with no URL must not be submitted.\n` +
    `- People move: a months-old directory listing is weaker than a current personal/institutional page — note conflicts in caveats.\n` +
    `- If you cannot tell, say stillAtOrg="unclear" — never round up to "yes".\n` +
    `- Do NOT report email addresses or contact routes. Verification only.\n`;

  const msg = await client().messages.create({
    model: ROUTES.RESUME_PIPELINE,
    max_tokens: 2048,
    tools: [WEB_SEARCH_TOOL, VERDICT_TOOL],
    messages: [{ role: 'user', content: prompt }],
  });

  const block = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_verification',
  );
  if (!block) {
    throw new Error(
      `verify_person: model did not call submit_verification (stop_reason=${msg.stop_reason}) — no verification produced`,
    );
  }
  const input = block.input as Omit<PersonVerification, 'name' | 'org' | 'verifiedAt'>;
  if (!Array.isArray(input.findings) || input.findings.length === 0) {
    throw new Error('verify_person: submission carried zero cited findings — refusing to report an unsupported verdict');
  }
  return {
    name,
    org,
    ...input,
    verifiedAt: new Date().toISOString(),
  };
}
