'use client';

import { useState, useRef, useEffect } from 'react';

// Warm Dusk palette tokens
const D = {
  paper:   '#1C1822',
  card:    '#221E2A',
  line:    'rgba(255,235,210,0.07)',
  line2:   'rgba(255,235,210,0.13)',
  ink:     '#FBF5EC',
  body:    '#EADFD0',
  dim:     '#A89E91',
  mute:    '#766D62',
  accent:  '#7EB8D6',
  amber:   '#E8B87A',
  mono:    'JetBrains Mono, ui-monospace, Menlo, monospace',
};

type Props = {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  // DuskModule extras
  index?: string;        // e.g. "01"
  count?: number;        // item count shown in header
  live?: boolean;        // show live dot
  onExpand?: () => void; // ⤢ expand to full modal
  action?: React.ReactNode; // arbitrary action slot (refresh, etc.)
};

export default function CollapsibleModule({
  title,
  defaultOpen = true,
  children,
  index,
  count,
  live = false,
  onExpand,
  action,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number>(0);

  useEffect(() => {
    if (!bodyRef.current) return;
    if (open) setMaxH(bodyRef.current.scrollHeight + 200);
    else setMaxH(0);
  }, [open]);

  // Remeasure when children change
  useEffect(() => {
    if (open && bodyRef.current) setMaxH(bodyRef.current.scrollHeight + 200);
  });

  // Cyan live dot uses the cool-pulse keyframe + var(--accent-cool) from
  // globals.css so it matches the design-ref ambient palette.
  const liveCool = 'var(--accent-cool)';

  return (
    <div style={{
      // Modules now flow as a single continuous glass surface — the boxy
      // bottom border that used to divide each module is gone; the visual
      // boundary comes from the accordion-header background on hover/open.
      padding: '2px 6px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen((v) => !v)}
        className={`accordion-header ${open ? 'accordion-header-open' : ''}`}
        style={{
          display:        'flex',
          alignItems:     'center',
          padding:        '9px 10px',
          cursor:         'pointer',
          userSelect:     'none',
          gap:            8,
        }}
      >
        {/* Index */}
        {index && (
          <span style={{
            fontSize:      9,
            color:         D.mute,
            fontFamily:    D.mono,
            letterSpacing: '0.04em',
            flexShrink:    0,
          }}>{index}</span>
        )}

        {/* Title */}
        <span style={{
          fontSize:      10,
          fontWeight:    700,
          color:         D.dim,
          fontFamily:    D.mono,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          flex:          1,
        }}>{title}</span>

        {/* Count pill */}
        {count !== undefined && (
          <span style={{
            fontSize:      9,
            color:         D.mute,
            fontFamily:    D.mono,
            background:    'rgba(255,255,255,0.03)',
            border:        `1px solid ${D.line}`,
            borderRadius:  10,
            padding:       '1px 6px',
          }}>{count}</span>
        )}

        {/* Live dot — cool-cyan with the pulsing aura keyframe. */}
        {live && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span
              className="cool-pulse"
              style={{
                width:        5,
                height:       5,
                borderRadius: '50%',
                background:   liveCool,
                display:      'inline-block',
              }}
            />
            <span style={{ fontSize: 8, color: liveCool, fontFamily: D.mono, letterSpacing: '0.06em' }}>LIVE</span>
          </span>
        )}

        {/* Arbitrary action slot */}
        {action && (
          <div onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        )}

        {/* Expand icon ⤢ — uses .ambient-expand-btn for the hover-glow polish. */}
        {onExpand && (
          <button
            onClick={(e) => { e.stopPropagation(); onExpand(); }}
            className="ambient-expand-btn"
            style={{
              border:     '1px solid transparent',
              borderRadius: 6,
              background: 'transparent',
              cursor:     'pointer',
              padding:    3,
              color:      D.mute,
              display:    'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
            title="Expand"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9"/>
              <polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/>
              <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
        )}

        {/* Collapse chevron */}
        <span style={{
          display:    'flex',
          alignItems: 'center',
          color:      D.mute,
          flexShrink: 0,
          transition: 'transform 300ms ease',
          transform:  open ? 'rotate(0deg)' : 'rotate(-90deg)',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        style={{
          overflow:   'hidden',
          maxHeight:  open ? maxH : 0,
          opacity:    open ? 1 : 0,
          transition: 'max-height 300ms ease-out, opacity 250ms ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}
