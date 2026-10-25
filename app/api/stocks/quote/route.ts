import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_SYMBOLS = ['XLK', 'SCHG', 'MSFT', 'SPY'];
const FINNHUB_KEY = process.env.FINNHUB_API_KEY ?? '';

type QuoteData = {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
};

// ── Finnhub ──────────────────────────────────────────────────────────────────

async function finnhubQuote(symbol: string): Promise<QuoteData | null> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.c) return null;
    return { symbol, price: d.c, change: d.d, changePct: d.dp, high: d.h, low: d.l, open: d.o, prevClose: d.pc };
  } catch { return null; }
}

async function finnhubCandles(symbol: string, range: string): Promise<{ t: number; c: number }[]> {
  const now = Math.floor(Date.now() / 1000);
  const rangeMap: Record<string, { from: number; resolution: string }> = {
    '1D': { from: now - 86400,        resolution: '15' },
    '1W': { from: now - 7 * 86400,    resolution: '60' },
    '1M': { from: now - 30 * 86400,   resolution: 'D'  },
    '3M': { from: now - 90 * 86400,   resolution: 'D'  },
    '1Y': { from: now - 365 * 86400,  resolution: 'W'  },
  };
  const { from, resolution } = rangeMap[range] ?? rangeMap['1W'];
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${now}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return [];
    const d = await res.json();
    if (d.s !== 'ok' || !d.t) return [];
    return d.t.map((t: number, i: number) => ({ t, c: d.c[i] }));
  } catch { return []; }
}

// ── Yahoo Finance fallback ───────────────────────────────────────────────────

const YAHOO_RANGE_MAP: Record<string, { range: string; interval: string }> = {
  '1D': { range: '1d',  interval: '5m'  },
  '1W': { range: '5d',  interval: '60m' },
  '1M': { range: '1mo', interval: '1d'  },
  '3M': { range: '3mo', interval: '1d'  },
  '1Y': { range: '1y',  interval: '1wk' },
};

async function yahooQuoteAndCandles(
  symbol: string,
  range: string
): Promise<{ quote: QuoteData | null; candles: { t: number; c: number }[] }> {
  const { range: r, interval } = YAHOO_RANGE_MAP[range] ?? YAHOO_RANGE_MAP['1W'];
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${r}&interval=${interval}&includePrePost=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { quote: null, candles: [] };
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return { quote: null, candles: [] };

    const meta = result.meta ?? {};
    const price: number = meta.regularMarketPrice ?? 0;
    const prevClose: number = meta.previousClose ?? meta.chartPreviousClose ?? 0;
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    const high: number = meta.regularMarketDayHigh ?? 0;
    const low: number = meta.regularMarketDayLow ?? 0;
    const open: number = meta.regularMarketOpen ?? 0;

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const candles = timestamps
      .map((t, i) => ({ t, c: closes[i] }))
      .filter((p) => p.c != null && !isNaN(p.c));

    return {
      quote: { symbol, price, change, changePct, high, low, open, prevClose },
      candles,
    };
  } catch {
    return { quote: null, candles: [] };
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbolParam = searchParams.get('symbols');
  const range = searchParams.get('range') ?? '1W';
  const symbols = symbolParam
    ? symbolParam.split(',').map((s) => s.trim().toUpperCase())
    : DEFAULT_SYMBOLS;

  const useFinnhub = FINNHUB_KEY.length > 0;

  const results = await Promise.all(
    symbols.map(async (sym) => {
      if (useFinnhub) {
        const [quote, candles] = await Promise.all([finnhubQuote(sym), finnhubCandles(sym, range)]);
        return {
          ...(quote ?? { symbol: sym, price: 0, change: 0, changePct: 0, high: 0, low: 0, open: 0, prevClose: 0 }),
          candles,
        };
      } else {
        const { quote, candles } = await yahooQuoteAndCandles(sym, range);
        return {
          ...(quote ?? { symbol: sym, price: 0, change: 0, changePct: 0, high: 0, low: 0, open: 0, prevClose: 0 }),
          candles,
        };
      }
    })
  );

  return NextResponse.json({ quotes: results });
}
