import { NextRequest, NextResponse } from 'next/server';
import { listEmails, draftEmail } from '@/lib/gmail';
import { AuthError } from '@/lib/google-auth';
import { createPendingAction, type EmailSendPayload } from '@/lib/pending-actions';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const account = searchParams.get('account') ?? 'berkeley';
  const q = searchParams.get('q') ?? undefined;
  const maxResults = parseInt(searchParams.get('maxResults') ?? '20', 10);

  try {
    const emails = await listEmails(account, q, maxResults);
    return NextResponse.json({ emails });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch emails';
    console.error('[email GET]', error);
    const status = error instanceof AuthError ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { account = 'berkeley', to, subject, body: emailBody, isDraft = false } = body;

  if (!to || !subject || !emailBody) {
    return NextResponse.json(
      { error: 'Missing required fields: to, subject, body' },
      { status: 400 }
    );
  }

  // Safety gate: validate every recipient before sending so this endpoint can
  // never deliver to a malformed address. `to` may be an array or a comma/
  // semicolon-separated string.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const recipients = (Array.isArray(to) ? to : String(to).split(/[,;]/))
    .map((a) => String(a).trim())
    .filter(Boolean);
  const invalidRecipients = recipients.filter((a) => !EMAIL_RE.test(a));
  if (recipients.length === 0 || invalidRecipients.length > 0) {
    return NextResponse.json(
      {
        error: invalidRecipients.length > 0
          ? `Invalid recipient address(es): ${invalidRecipients.join(', ')}`
          : 'No valid recipient specified.',
      },
      { status: 400 }
    );
  }

  try {
    if (isDraft) {
      const result = await draftEmail(account, to, subject, emailBody);
      return NextResponse.json({ success: true, result });
    }

    // HATCH NEVER SENDS (B-10): this route no longer dispatches mail. The send
    // exists only as an email_send PendingAction; the caller surfaces it for
    // explicit per-message approval, and only the pending-action executor can
    // reach the mail API.
    const payload: EmailSendPayload = {
      account,
      to: recipients.join(', '),
      subject,
      body: emailBody,
    };
    const { id, summary } = await createPendingAction('email_send', payload);
    return NextResponse.json(
      { success: true, requiresApproval: true, pendingActionId: id, summary },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue email';
    console.error('[email POST]', error);
    const status = error instanceof AuthError ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
