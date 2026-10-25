'use client';

import { useState, useEffect } from 'react';

type TokenStatus = {
  expiresAt: string | null;
  daysRemaining: number | null;
  status: 'valid' | 'warning' | 'urgent' | 'expired' | 'unknown';
};

export default function CanvasTokenBanner() {
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    fetch('/api/settings/canvas-token-status')
      .then((r) => r.json())
      .then(setTokenStatus)
      .catch(() => {});
  }, []);

  if (!tokenStatus || tokenStatus.status === 'unknown') return null;

  const { status, daysRemaining } = tokenStatus;

  const config = {
    valid: {
      color: '#5BB98C',
      bg: 'rgba(91,185,140,0.06)',
      border: 'rgba(91,185,140,0.2)',
      text: `Token valid · ${daysRemaining} days remaining`,
      flash: false,
    },
    warning: {
      color: '#E0A458',
      bg: 'rgba(224,164,88,0.06)',
      border: 'rgba(224,164,88,0.2)',
      text: `Token expires in ${daysRemaining} days`,
      flash: false,
    },
    urgent: {
      color: '#D4645C',
      bg: 'rgba(212,100,92,0.06)',
      border: 'rgba(212,100,92,0.2)',
      text: `Token expires in ${daysRemaining} days — renew soon`,
      flash: false,
    },
    expired: {
      color: '#D4645C',
      bg: 'rgba(212,100,92,0.08)',
      border: 'rgba(212,100,92,0.3)',
      text: 'Token expired — renew now',
      flash: true,
    },
  }[status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 24px',
        background: config.bg,
        borderBottom: `1px solid ${config.border}`,
        position: 'relative',
      }}
    >
      {/* Status dot */}
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: config.color,
          flexShrink: 0,
          animation: config.flash ? 'blink 1s step-end infinite' : 'none',
        }}
      />

      {/* Message */}
      <span
        style={{
          fontSize: 11,
          color: config.color,
          fontFamily: 'var(--font-jetbrains-mono)',
        }}
      >
        {config.text}
      </span>

      {/* Info icon + tooltip */}
      <div style={{ position: 'relative', marginLeft: 4 }}>
        <button
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: '#9B9BAB',
            fontSize: 11,
            lineHeight: 1,
            fontFamily: 'var(--font-jetbrains-mono)',
          }}
        >
          ?
        </button>

        {showTooltip && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 6,
              background: '#FFFFFF',
              border: '1px solid #E8E4DF',
              borderRadius: 8,
              padding: '10px 12px',
              width: 260,
              zIndex: 50,
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#6B6B7B',
                lineHeight: 1.6,
                fontFamily: 'var(--font-jetbrains-mono)',
              }}
            >
              <div style={{ color: '#1A1A1A', marginBottom: 4, fontWeight: 500 }}>
                How to renew your Canvas token:
              </div>
              1. Go to bCourses → Account → Settings
              <br />
              2. Scroll to &quot;Approved Integrations&quot;
              <br />
              3. Click &quot;New Access Token&quot;
              <br />
              4. Paste the new token in{' '}
              <span style={{ color: '#7EB8D6' }}>.env.local</span> as{' '}
              <span style={{ color: '#7EB8D6' }}>CANVAS_API_TOKEN</span>
              <br />
              5. Update{' '}
              <span style={{ color: '#7EB8D6' }}>CANVAS_TOKEN_EXPIRES</span> with
              the new expiry date
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
