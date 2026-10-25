/**
 * application-email-monitor.ts
 *
 * Scans Gmail for emails related to job applications and updates PipelineCard statuses.
 *
 * Triggers:
 * - POST /api/career/monitor  (manual or cron)
 * - Called once per day after the daily briefing generates
 *
 * Logic per email:
 *   1. Check subject + sender against known companies in active pipeline cards
 *   2. Classify: interview_invite | rejection | offer | response | assessment
 *   3. Update PipelineCard.status + create PipelineEvent
 */

import { google } from 'googleapis';
import { withGoogleRetry } from '@/lib/google-auth';
import { prisma } from '@/lib/prisma';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MonitorResult {
  scanned: number;
  classified: number;
  updated: number;
  events: Array<{
    org: string;
    role: string;
    classification: EmailClassification;
    fromStatus: string;
    toStatus: string;
  }>;
}

type EmailClassification =
  | 'interview_invite'
  | 'assessment'
  | 'rejection'
  | 'offer'
  | 'response'
  | 'unknown';

interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

// ── Heuristics ────────────────────────────────────────────────────────────────

const INTERVIEW_SIGNALS = [
  'interview',
  'schedule a call',
  'meet with',
  'phone screen',
  'video call',
  'technical screen',
  'next steps',
  'we would like to speak',
  'interested in moving forward',
];

const REJECTION_SIGNALS = [
  'unfortunately',
  'not moving forward',
  'decided to move forward with other',
  'position has been filled',
  'will not be moving',
  'pursue other candidates',
  'other applicants',
  "won't be moving",
  'different direction',
  'not a fit',
];

const OFFER_SIGNALS = [
  'offer letter',
  'offer of employment',
  'pleased to offer',
  'we are happy to extend',
  'formal offer',
  'compensation package',
  'start date',
];

const ASSESSMENT_SIGNALS = [
  'take-home',
  'coding challenge',
  'assessment',
  'technical exercise',
  'hackerrank',
  'codility',
  'leetcode',
  'test link',
];

function classify(subject: string, snippet: string): EmailClassification {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (OFFER_SIGNALS.some((s) => text.includes(s))) return 'offer';
  if (REJECTION_SIGNALS.some((s) => text.includes(s))) return 'rejection';
  if (INTERVIEW_SIGNALS.some((s) => text.includes(s))) return 'interview_invite';
  if (ASSESSMENT_SIGNALS.some((s) => text.includes(s))) return 'assessment';
  return 'unknown';
}

const STATUS_TRANSITIONS: Record<EmailClassification, string | null> = {
  interview_invite: 'interviewing',
  assessment: 'interviewing',
  rejection: 'closed',
  offer: 'offer',
  response: 'applied',
  unknown: null,
};

// ── Gmail fetch helpers ───────────────────────────────────────────────────────

async function fetchRecentApplicationEmails(accountLabel: string, lookbackHours = 24) {
  const afterTimestamp = Math.floor((Date.now() - lookbackHours * 3600 * 1000) / 1000);

  const messages = await withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${afterTimestamp} in:inbox`,
      maxResults: 100,
    });
    return res.data.messages ?? [];
  });

  if (!messages.length) return [];

  const detailed = await withGoogleRetry(accountLabel, async (auth) => {
    const gmail = google.gmail({ version: 'v1', auth });
    return Promise.all(
      messages.map((m) =>
        gmail.users.messages.get({
          userId: 'me',
          id: m.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From'],
        })
      )
    );
  });

  return detailed.map((d) => {
    const headers: GmailHeader[] = d.data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === 'Subject')?.value ?? '';
    const from = headers.find((h) => h.name === 'From')?.value ?? '';
    // Cast to satisfy TS — nullable values are already handled by ??
    const snippet = d.data.snippet ?? '';
    return { id: d.data.id!, subject, from, snippet };
  });
}

// Fuzzy match: check if org name appears in "from" address or subject
function matchesOrg(org: string, subject: string, from: string): boolean {
  const orgSlug = org.toLowerCase().replace(/[^a-z0-9]/g, '');
  const haystack = `${subject} ${from}`.toLowerCase().replace(/[^a-z0-9 @.]/g, '');
  // Check slug match (handles "openai" in "recruiting@openai.com")
  if (haystack.replace(/[^a-z0-9]/g, '').includes(orgSlug)) return true;
  // Check word match (handles "Open AI" in subject)
  const words = org.toLowerCase().split(/\s+/);
  return words.every((w) => w.length > 3 && haystack.includes(w));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runEmailMonitor(
  accountLabel = 'berkeley',
  lookbackHours = 24
): Promise<MonitorResult> {
  const result: MonitorResult = { scanned: 0, classified: 0, updated: 0, events: [] };

  // Load active pipeline cards (applied / interviewing only)
  const activeCards = await prisma.pipelineCard.findMany({
    where: { status: { in: ['applied', 'interviewing'] } },
  });

  if (!activeCards.length) return result;

  let emails: { id: string; subject: string; from: string; snippet: string }[] = [];
  try {
    emails = await fetchRecentApplicationEmails(accountLabel, lookbackHours);
  } catch {
    // If Gmail isn't connected, skip silently
    return result;
  }

  result.scanned = emails.length;

  for (const email of emails) {
    const classification = classify(email.subject, email.snippet);
    if (classification === 'unknown') continue;

    const newStatus = STATUS_TRANSITIONS[classification];
    if (!newStatus) continue;

    // Find matching card
    const card = activeCards.find((c) => matchesOrg(c.org, email.subject, email.from));
    if (!card) continue;

    result.classified++;

    // Skip if already at this status or a later stage
    const stages = ['discovered', 'evaluated', 'applied', 'interviewing', 'offer', 'closed'];
    const currentIdx = stages.indexOf(card.status);
    const newIdx = stages.indexOf(newStatus);
    if (newIdx <= currentIdx && card.status !== 'applied') continue;

    // Update card
    const updateData: Record<string, unknown> = { status: newStatus };
    if (classification === 'interview_invite' || classification === 'assessment') {
      updateData.interviewAt = new Date();
    }
    if (classification === 'offer') {
      updateData.offerAt = new Date();
    }
    if (classification === 'rejection') {
      updateData.closedAt = new Date();
      updateData.statusReason = `Rejected — email signal: "${email.subject.slice(0, 80)}"`;
    }

    await prisma.pipelineCard.update({
      where: { id: card.id },
      data: updateData,
    });

    await prisma.pipelineEvent.create({
      data: {
        cardId: card.id,
        type: 'email_received',
        fromStatus: card.status,
        toStatus: newStatus,
        notes: `${classification} detected. Subject: "${email.subject.slice(0, 120)}"`,
      },
    });

    result.updated++;
    result.events.push({
      org: card.org,
      role: card.role,
      classification,
      fromStatus: card.status,
      toStatus: newStatus,
    });
  }

  return result;
}
