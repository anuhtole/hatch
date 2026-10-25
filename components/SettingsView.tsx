'use client';

import { useState, useEffect } from 'react';

type Account = {
  label: string;
  email: string;
  tokenExpiry: string | null;
};

type Health = {
  connected: boolean;
  reason?: string;
  email?: string;
  lastVerified?: string;
};

export default function SettingsView() {
  const [account, setAccount] = useState<Account | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const connected = sessionStorage.getItem('aria_oauth_connected');
    const oauthError = sessionStorage.getItem('aria_oauth_error');
    if (connected) {
      setSuccessMsg('Berkeley email connected successfully.');
      sessionStorage.removeItem('aria_oauth_connected');
    }
    if (oauthError) {
      sessionStorage.removeItem('aria_oauth_error');
    }
    fetchAccount();
    fetchHealth();
  }, []);

  async function fetchAccount() {
    try {
      const res = await fetch('/api/settings/accounts');
      const data = await res.json();
      const berkeley = (data.accounts ?? []).find((a: Account) => a.label === 'berkeley');
      setAccount(berkeley ?? null);
    } catch {}
  }

  // Health is computed server-side by trying an actual refresh against
  // Google. Far more accurate than reading access-token TTL — which
  // always expires within an hour even on a healthy connection.
  async function fetchHealth() {
    try {
      const res = await fetch('/api/auth/google/health?account=berkeley');
      const data: Health = await res.json();
      setHealth(data);
    } catch {
      setHealth(null);
    }
  }

  /**
   * Open Google OAuth in a popup so the main tab keeps its JS context
   * (and any in-progress chat stream) alive. The callback page posts a
   * message back to the opener and closes itself.
   */
  function connectGoogle(accountLabel: string) {
    setErrorMsg(null);
    const url = `/api/auth/google?account=${encodeURIComponent(accountLabel)}&popup=1`;
    const w = 500;
    const h = 700;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const features = `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
    const popup = window.open(url, 'aria-oauth-google', features);

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      // Popup blocked — fall back to a full-page redirect after warning the user.
      setErrorMsg('Popup was blocked. Continuing in this tab — your chat may be interrupted.');
      window.location.href = `/api/auth/google?account=${encodeURIComponent(accountLabel)}`;
      return;
    }

    setConnecting(true);
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(pollId);
      setConnecting(false);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.provider !== 'google') return;
      if (data.type === 'oauth-success') {
        settled = true;
        setSuccessMsg('Berkeley email connected successfully.');
        fetchAccount();
        fetchHealth();
        cleanup();
      } else if (data.type === 'oauth-error') {
        settled = true;
        setErrorMsg(`Connection failed: ${data.error ?? 'unknown error'}`);
        cleanup();
      }
    };

    window.addEventListener('message', onMessage);

    // Poll for popup.closed so we detect cancel (user closed without finishing).
    const pollId = window.setInterval(() => {
      if (popup.closed) {
        if (!settled) {
          // Refetch in case the success message was missed (e.g. cross-origin
          // window.opener restriction), and clear connecting state.
          fetchAccount();
        }
        cleanup();
      }
    }, 500);
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch('/api/auth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'berkeley' }),
      });
      setAccount(null);
    } catch {}
    setDisconnecting(false);
  }

  // Health drives the status pill once /api/auth/google/health returns.
  // While health is still loading, fall back to "connected if account
  // exists" so the pill never falsely flashes "Token expired" purely
  // because the access token's 1-hour TTL has elapsed.
  const connected = !!account;
  const statusOk = health ? health.connected : connected;
  const needsReconnect = health ? !health.connected && connected : false;

  const gmailPillClass = statusOk ? 'sb-pill ok' : needsReconnect ? 'sb-pill warn' : 'sb-pill';
  const gmailPillText = statusOk ? 'Connected' : needsReconnect ? 'Reconnect required' : 'Not connected';

  return (
    <div className="sb-surface">
      <div className="sb-surface-head">
        <h1 className="sb-surface-title">Settings</h1>
        <div className="sb-surface-sub">Connections &amp; preferences</div>
      </div>

      {successMsg && <div className="sb-banner ok">{successMsg}</div>}
      {errorMsg && <div className="sb-banner error">{errorMsg}</div>}

      <div className="sb-set-body">
        {/* Gmail — Berkeley */}
        <section className="sb-set-sec">
          <h2 className="sb-set-heading">Gmail — Berkeley</h2>
          <div className="sb-set-row">
            <div className="sb-set-row-main">
              <div className="sb-set-row-title">
                {connected ? account!.email || 'Berkeley account' : 'Not connected'}
              </div>
              <div className={gmailPillClass}>
                <span className="sb-pill-dot" />
                {gmailPillText}
              </div>
            </div>
            <div className="sb-set-actions">
              {connected ? (
                <>
                  <button
                    type="button"
                    className="sb-btn"
                    onClick={() => connectGoogle('berkeley')}
                    disabled={connecting}
                  >
                    {connecting ? 'Connecting…' : 'Reconnect'}
                  </button>
                  <button
                    type="button"
                    className="sb-btn danger"
                    onClick={disconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="sb-btn primary"
                  onClick={() => connectGoogle('berkeley')}
                  disabled={connecting}
                >
                  {connecting ? 'Connecting…' : 'Connect Berkeley Email'}
                </button>
              )}
            </div>
          </div>
          <p className="sb-set-note">
            Scopes: Gmail read/send/modify · Calendar read/write · Drive read
          </p>
        </section>

        {/* Canvas LMS */}
        <section className="sb-set-sec">
          <h2 className="sb-set-heading">Canvas LMS (bCourses)</h2>
          <div className="sb-set-row">
            <div className="sb-set-row-main">
              <div className="sb-set-row-title">Token configured</div>
              <div className="sb-pill ok">
                <span className="sb-pill-dot" />
                Active via .env.local
              </div>
            </div>
          </div>
          <p className="sb-set-note" style={{ marginTop: 10 }}>
            To update your Canvas API token, edit <code>.env.local</code>:
          </p>
          <pre className="sb-set-code">{`CANVAS_API_TOKEN=your-token-here
CANVAS_TOKEN_EXPIRES=YYYY-MM-DD`}</pre>
          <p className="sb-set-note">
            Generate at bCourses → Account → Settings → Approved Integrations → New Access Token.
          </p>
        </section>

        {/* Privacy */}
        <section className="sb-set-sec">
          <h2 className="sb-set-heading">Privacy</h2>
          <p className="sb-set-privacy">
            All credentials are stored locally in your SQLite database. API keys are only
            used server-side and never exposed to the client.
          </p>
        </section>
      </div>
    </div>
  );
}
