import { NextRequest, NextResponse } from 'next/server';
import { handleCallback } from '@/lib/google-auth';

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/** Parse the OAuth `state` param. Format: "<account>" or "<account>:popup". */
function parseState(raw: string | null): { account: string; popup: boolean } {
  const value = raw ?? 'berkeley';
  const [account, mode] = value.split(':');
  return { account: account || 'berkeley', popup: mode === 'popup' };
}

/**
 * Renders a tiny HTML page that posts a message to the opener and closes the
 * popup. Falls back to a /?view=settings link if there's no opener (user opened
 * the callback URL directly in a normal tab).
 */
function popupResponse(payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  // origin is computed at runtime from window.location.origin so the message is
  // only delivered same-origin (and the receiver enforces the same check).
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Connecting…</title></head>
<body style="font-family:system-ui;background:#17141C;color:#FBF5EC;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center">
    <div style="font-size:14px;opacity:0.7">Finishing connection…</div>
  </div>
  <script>
    (function () {
      var payload = ${json};
      try {
        if (window.opener) {
          window.opener.postMessage(payload, window.location.origin);
          window.close();
          return;
        }
      } catch (e) {
        // window.opener access can throw if cross-origin / null — fall through.
      }
      // No opener (user pasted URL directly): fall back to the main-tab flow.
      var qs = payload.type === 'oauth-success'
        ? '?view=settings&connected=' + encodeURIComponent(payload.account || '')
        : '?view=settings&error=' + encodeURIComponent(payload.error || 'oauth_failed');
      window.location.replace(qs);
    })();
  </script>
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const { account, popup } = parseState(searchParams.get('state'));

  // User denied consent on Google's page
  if (error) {
    console.error('[auth/callback/google] Google returned error:', error);
    if (popup) return popupResponse({ type: 'oauth-error', provider: 'google', error, account });
    return NextResponse.redirect(new URL(`/?view=settings&error=${error}`, BASE));
  }

  if (!code) {
    console.error('[auth/callback/google] No authorization code in callback');
    if (popup) return popupResponse({ type: 'oauth-error', provider: 'google', error: 'no_code', account });
    return NextResponse.redirect(new URL('/?view=settings&error=no_code', BASE));
  }

  console.log('[auth/callback/google] Exchanging code for tokens, account:', account, 'popup:', popup);

  try {
    const result = await handleCallback(code, account);
    console.log('[auth/callback/google] Success — email:', result.email);
    if (popup) return popupResponse({ type: 'oauth-success', provider: 'google', account, email: result.email });
    return NextResponse.redirect(new URL(`/?view=settings&connected=${account}`, BASE));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = err instanceof Error && (err as { response?: { data?: unknown } }).response?.data
      ? JSON.stringify((err as { response?: { data?: unknown } }).response?.data)
      : '';
    console.error('[auth/callback/google] Token exchange failed:', message, detail);
    if (popup) return popupResponse({ type: 'oauth-error', provider: 'google', error: 'oauth_failed', account });
    return NextResponse.redirect(new URL('/?view=settings&error=oauth_failed', BASE));
  }
}
