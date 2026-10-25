import { google } from 'googleapis';
import { prisma } from './prisma';

const SCOPES = [
  // userinfo.email lets getTokenInfo() resolve the connected account's
  // address without a separate userinfo call — without it, the Settings
  // pill falls back to an empty string under "Connected".
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(accountLabel: string, opts?: { popup?: boolean }) {
  const oauth2Client = createOAuthClient();
  // State encodes both the account label and whether the start page was a popup,
  // so the callback can tell whether to close itself vs. redirect the main tab.
  const state = opts?.popup ? `${accountLabel}:popup` : accountLabel;
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent', // always force consent so Google returns a refresh_token
  });
}

/**
 * Returns a configured OAuth2 client with:
 * - refresh_token set (so googleapis auto-refreshes when the access token expires)
 * - a `tokens` event listener that persists newly issued tokens back to the DB
 *
 * This means: once connected, tokens silently refresh forever without re-login.
 */
export async function getOAuthClient(accountLabel: string) {
  const account = await prisma.account.findUnique({
    where: { label: accountLabel },
  });

  if (!account?.refreshToken) {
    throw new AuthError(
      `Not connected to Google. Please reconnect in Settings → Berkeley Email.`,
      accountLabel
    );
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: account.refreshToken,
    access_token: account.accessToken ?? undefined,
    expiry_date: account.tokenExpiry ? account.tokenExpiry.getTime() : undefined,
  });

  // Whenever googleapis silently issues a new access token, persist it to DB
  oauth2Client.on('tokens', async (tokens) => {
    console.log(`[google-auth] Token auto-refreshed for "${accountLabel}"`);
    await prisma.account.update({
      where: { label: accountLabel },
      data: {
        ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
        // Only overwrite refresh_token if Google returned a new one (rotation)
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.expiry_date ? { tokenExpiry: new Date(tokens.expiry_date) } : {}),
      },
    });
  });

  return oauth2Client;
}

/**
 * Wraps a Google API call with automatic retry on 401.
 *
 * Flow:
 *   1. Get an OAuth client (with refresh_token set)
 *   2. Call fn(auth) — googleapis will auto-refresh if the access token is expired
 *   3. If we still get a 401, force an explicit refresh and retry once
 *   4. If the forced refresh fails, throw an AuthError that surfaces as
 *      "Reconnect Berkeley Email" in the UI
 */
export async function withGoogleRetry<T>(
  accountLabel: string,
  fn: (auth: ReturnType<typeof createOAuthClient>) => Promise<T>
): Promise<T> {
  const auth = await getOAuthClient(accountLabel);

  try {
    return await fn(auth);
  } catch (err: any) {
    const status = err?.response?.status ?? err?.status;

    if (status === 401) {
      console.warn(
        `[google-auth] 401 for "${accountLabel}" — forcing explicit refresh and retrying`
      );

      try {
        const { credentials } = await auth.refreshAccessToken();
        auth.setCredentials(credentials);

        // Persist the freshly forced tokens
        await prisma.account.update({
          where: { label: accountLabel },
          data: {
            ...(credentials.access_token ? { accessToken: credentials.access_token } : {}),
            ...(credentials.refresh_token ? { refreshToken: credentials.refresh_token } : {}),
            ...(credentials.expiry_date
              ? { tokenExpiry: new Date(credentials.expiry_date) }
              : {}),
          },
        });
      } catch (refreshErr: any) {
        console.error(`[google-auth] Refresh failed for "${accountLabel}":`, refreshErr?.message);
        throw new AuthError(
          `Google access expired for "${accountLabel}". Please reconnect in Settings → Berkeley Email.`,
          accountLabel
        );
      }

      return await fn(auth); // retry with fresh credentials
    }

    throw err;
  }
}

/**
 * Called by the OAuth callback route after Google redirects back.
 * Exchanges the auth code for tokens and saves them to the DB.
 *
 * Key fix: if Google doesn't return a new refresh_token (happens when the user
 * has already granted consent), we keep the one already in the DB rather than
 * overwriting it with null.
 */
export async function handleCallback(code: string, accountLabel: string) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token) {
    throw new Error('Token exchange returned no access_token');
  }

  // Resolve the email from the token itself — no separate userinfo call needed
  const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token);
  const email = tokenInfo.email ?? '';

  // Preserve the existing refresh_token if Google didn't issue a new one
  const existing = await prisma.account.findUnique({ where: { label: accountLabel } });
  const refreshToken = tokens.refresh_token ?? existing?.refreshToken ?? null;

  if (!refreshToken) {
    throw new Error(
      'No refresh token available. Please disconnect then reconnect to grant offline access.'
    );
  }

  await prisma.account.upsert({
    where: { label: accountLabel },
    create: {
      label: accountLabel,
      email,
      accessToken: tokens.access_token,
      refreshToken,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    update: {
      email,
      accessToken: tokens.access_token,
      refreshToken,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  });

  return { email, label: accountLabel };
}

/** Sentinel error type so API routes can return a clean 401 with reconnect instructions */
export class AuthError extends Error {
  constructor(message: string, public readonly accountLabel: string) {
    super(message);
    this.name = 'AuthError';
  }
}
