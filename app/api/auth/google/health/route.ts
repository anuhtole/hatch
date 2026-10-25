import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOAuthClient } from '@/lib/google-auth';

// Real connection health for a Google account. The SettingsView used to
// compute "Token expired" from access-token TTL — but access tokens are
// designed to expire every ~1 hour and be silently refreshed. The only
// thing that actually matters is whether the refresh_token still works.
//
// This endpoint tries an explicit refresh against Google. If that
// succeeds, the connection is healthy regardless of how stale the cached
// access_token is. If it fails, the user genuinely needs to reconnect.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const label = searchParams.get('account') ?? 'berkeley';

  const account = await prisma.account.findUnique({ where: { label } });
  if (!account) {
    return NextResponse.json({ connected: false, reason: 'no_account' });
  }
  if (!account.refreshToken) {
    return NextResponse.json({ connected: false, reason: 'no_refresh_token', email: account.email });
  }

  try {
    const auth = await getOAuthClient(label);
    // refreshAccessToken hits Google's /token endpoint. The 'tokens'
    // listener registered in getOAuthClient persists the result.
    await auth.refreshAccessToken();
    return NextResponse.json({
      connected: true,
      email: account.email,
      lastVerified: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      connected: false,
      reason: 'refresh_failed',
      email: account.email,
      error: message,
    });
  }
}
