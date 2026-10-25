import { NextRequest, NextResponse } from 'next/server';
import { getEmail } from '@/lib/gmail';
import { sanitizeEmailHtml } from '@/lib/email-sanitize';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const account = searchParams.get('account') ?? 'berkeley';

  try {
    const email = await getEmail(account, id);
    // Sanitize server-side so the renderer can dangerouslySetInnerHTML
    // without re-running an allowlist on every paint.
    const safeHtml = sanitizeEmailHtml(email.html);
    return NextResponse.json({
      email: {
        ...email,
        html: safeHtml,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch email';
    console.error('[email/[id] GET]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
