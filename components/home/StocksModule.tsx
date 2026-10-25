'use client';

import { useState, useEffect } from 'react';
import { useStableData } from '@/lib/swr-config';
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import CollapsibleModule from './CollapsibleModule';

type Quote = {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  open?: number;
  prevClose?: number;
  high?: number;
  low?: number;
  candles: { t: number; c: number }[];
};

const RANGES = ['1D', '1W', '1M', '3M', '1Y'] as const;
type Range = (typeof RANGES)[number];

const SYMBOLS = ['XLK', 'SCHG', 'MSFT', 'SPY'];

function Sparkline({ data, positive }: { data: { t: number; c: number }[]; positive: boolean }) {
  if (!data || data.length < 2) {
    return <div style={{ width: 64, height: 28, background: 'rgba(255,235,210,0.06)', borderRadius: 4 }} />;
  }
  const color = positive ? '#8FC89A' : '#D88878';
  const fill = positive ? 'rgba(143,200,154,0.12)' : 'rgba(216,136,120,0.12)';
  return (
    <ResponsiveContainer width={64} height={28}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={`sg-${positive ? 'g' : 'r'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis domain={['dataMin', 'dataMax']} hide />
        <Area
          type="monotone"
          dataKey="c"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#sg-${positive ? 'g' : 'r'})`}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          contentStyle={{ display: 'none' }}
          cursor={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SlideOver({ quote, range, onRangeChange, onClose }: {
  quote: Quote;
  range: Range;
  onRangeChange: (r: Range) => void;
  onClose: () => void;
}) {
  const positive = quote.changePct >= 0;
  const color = positive ? '#8FC89A' : '#D88878';

  return (
    <>
      <div className="slideover-overlay" onClick={onClose} />
      <div className="slideover-panel" style={{ width: 440 }}>
        <div style={{ padding: 28 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 11, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 4 }}>STOCK</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#FBF5EC', fontFamily: 'var(--font-display)' }}>{quote.symbol}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#FBF5EC', marginTop: 4 }}>
                ${quote.price.toFixed(2)}
              </div>
              <div style={{ fontSize: 13, color, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                {positive ? '▲' : '▼'} {Math.abs(quote.changePct).toFixed(2)}%
                <span style={{ color: '#766D62' }}>({positive ? '+' : ''}{quote.change.toFixed(2)})</span>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'rgba(255,235,210,0.08)', color: '#A89E91', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >×</button>
          </div>

          {/* Range tabs */}
          <div className="pill-tabs" style={{ marginBottom: 20 }}>
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => onRangeChange(r)}
                className={`pill-tab${range === r ? ' active' : ''}`}
                style={{ padding: '5px 14px', fontSize: 12 }}
              >{r}</button>
            ))}
          </div>

          {/* Chart */}
          {quote.candles.length > 1 ? (
            <div style={{ height: 160, marginBottom: 20 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={quote.candles} margin={{ top: 4, right: 0, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="detail-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis domain={['dataMin - 1', 'dataMax + 1']} hide />
                  <Tooltip
                    contentStyle={{ background: '#1A1A1A', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#fff' }}
                    formatter={(v: unknown) => [`$${(v as number).toFixed(2)}`, '']}
                    labelFormatter={(t: unknown) => new Date((t as number) * 1000).toLocaleDateString()}
                  />
                  <Area type="monotone" dataKey="c" stroke={color} strokeWidth={2} fill="url(#detail-grad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ height: 160, background: 'rgba(255,235,210,0.04)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <span style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)' }}>No data</span>
            </div>
          )}

          {/* Key stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Open', val: `$${quote.open?.toFixed(2) ?? '—'}` },
              { label: 'Prev Close', val: `$${quote.prevClose?.toFixed(2) ?? '—'}` },
              { label: 'Day High', val: `$${quote.high?.toFixed(2) ?? '—'}` },
              { label: 'Day Low', val: `$${quote.low?.toFixed(2) ?? '—'}` },
            ].map(({ label, val }) => (
              <div key={label} style={{ background: 'rgba(255,235,210,0.05)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#FBF5EC' }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default function StocksModule() {
  const [range, setRange] = useState<Range>('1W');
  const [selected, setSelected] = useState<Quote | null>(null);

  const { data: stocksData, isLoading: loading } = useStableData<{ quotes: Quote[] }>(
    `/api/stocks/quote?symbols=${SYMBOLS.join(',')}&range=${range}`
  );
  const quotes = stocksData?.quotes ?? [];

  function handleRangeChange(r: Range) {
    setRange(r);
    if (selected) {
      // Refetch for slide-over too
      fetch(`/api/stocks/quote?symbols=${selected.symbol}&range=${r}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.quotes?.[0]) setSelected(d.quotes[0]);
        }).catch(() => {});
    }
  }

  return (
    <CollapsibleModule title="Markets" index="03" live={true}>
      <div style={{ padding: '0 16px 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 44, borderRadius: 10 }} />
            ))}
          </div>
        ) : quotes.length === 0 ? (
          <div style={{ fontSize: 12, color: '#766D62', textAlign: 'center', padding: '12px 0', fontFamily: 'var(--font-jetbrains-mono)' }}>
            No market data available
          </div>
        ) : (
          <div className="thin-scroll" style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {quotes.map((q) => {
              const pos = q.changePct >= 0;
              const color = pos ? '#8FC89A' : '#D88878';
              return (
                <div
                  key={q.symbol}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 10px',
                    borderRadius: 10,
                    transition: 'background 150ms ease',
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,235,210,0.05)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ width: 48, flex: '0 0 48px' }}>
                    <a
                      href={`https://finance.yahoo.com/quote/${q.symbol}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#FBF5EC',
                        fontFamily: 'var(--font-jetbrains-mono)',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#7EB8D6'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#FBF5EC'; }}
                    >{q.symbol}</a>
                  </div>
                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setSelected(q)}>
                    <Sparkline data={q.candles} positive={pos} />
                  </div>
                  <div style={{ textAlign: 'right', flex: '0 0 auto', cursor: 'pointer' }} onClick={() => setSelected(q)}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#FBF5EC' }}>${q.price > 0 ? q.price.toFixed(2) : '—'}</div>
                    <div style={{ fontSize: 11, color, fontFamily: 'var(--font-jetbrains-mono)' }}>
                      {pos ? '+' : ''}{q.changePct.toFixed(2)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <SlideOver
          quote={selected}
          range={range}
          onRangeChange={handleRangeChange}
          onClose={() => setSelected(null)}
        />
      )}
    </CollapsibleModule>
  );
}
