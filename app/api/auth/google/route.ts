import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google-auth';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const account = searchParams.get('account') ?? 'berkeley';
  const popup = searchParams.get('popup') === '1';

  try {
    const url = getAuthUrl(account, { popup });
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate auth URL';
    console.error('[auth/google GET]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
