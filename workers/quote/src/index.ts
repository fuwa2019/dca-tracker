/**
 * DCA Quote Worker
 * --------------------------------
 * GET /api/quote?symbols=VOO,QQQM,SMH
 *   → { quotes: [{ ticker, price, prevClose, change, changePct, marketState }] }
 *
 * GET /api/chart?symbol=VOO&range=1y&interval=1d
 *   → Yahoo v8/chart payload (passthrough)
 *
 * Source: query1.finance.yahoo.com (unofficial; 15-20min delayed during market hours).
 * Browser can't call Yahoo directly (no CORS, requires UA), so this Worker is the only proxy.
 */

export interface Env {
  QUOTE_CACHE: KVNamespace;
  ALLOWED_ORIGINS: string;
  /** Optional. If set, every successful /api/quote also upserts into Supabase
   *  `quote_snapshots` (so anonymous /share/[token] views have prices to compute returns). */
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const QUOTE_TTL = 60 * 5;   // 5 min
const CHART_TTL = 60 * 60;  // 1 h

interface QuoteOut {
  ticker: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  marketState: string | null;
  source: 'yahoo-v7' | 'yahoo-v8';
  cachedAt: string;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const corsHeaders = buildCors(req, env);

    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      if (url.pathname === '/api/quote') {
        return withCors(await handleQuote(url, env, ctx), corsHeaders);
      }
      if (url.pathname === '/api/chart') {
        return withCors(await handleChart(url, env), corsHeaders);
      }
      if (url.pathname === '/' || url.pathname === '/health') {
        return withCors(json({ ok: true, service: 'dca-quote', ts: Date.now() }), corsHeaders);
      }
      return withCors(json({ error: 'not_found' }, 404), corsHeaders);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return withCors(json({ error: 'worker_error', message: msg }, 500), corsHeaders);
    }
  },
};

async function handleQuote(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = url.searchParams.get('symbols') ?? '';
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  if (symbols.length === 0) {
    return json({ error: 'missing_symbols' }, 400);
  }

  const cacheKey = `quote:${symbols.join(',')}`;
  const cached = await env.QUOTE_CACHE.get(cacheKey, 'json');
  if (cached) {
    return json({ quotes: cached, cache: 'hit' });
  }

  // Primary: v7 quote endpoint (returns multiple symbols in one shot)
  let quotes: QuoteOut[] = [];
  try {
    quotes = await fetchV7Quotes(symbols);
  } catch {
    quotes = [];
  }

  // Fallback per-symbol via v8 chart (more resilient when v7 is throttled)
  const missing = symbols.filter((s) => !quotes.find((q) => q.ticker === s));
  if (missing.length > 0) {
    const fallback = await Promise.all(missing.map((s) => fetchV8Quote(s).catch(() => null)));
    for (const q of fallback) if (q) quotes.push(q);
  }

  // Persist ordering matching request
  quotes.sort((a, b) => symbols.indexOf(a.ticker) - symbols.indexOf(b.ticker));

  if (quotes.length > 0) {
    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(quotes), { expirationTtl: QUOTE_TTL });
    // Fire-and-forget snapshot to Supabase so anonymous /share/[token] pages
    // can compute return_pct without needing direct Yahoo access.
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.waitUntil(upsertSnapshots(env, quotes).catch((e) => console.warn('snapshot upsert failed:', e)));
    }
  }

  return json({ quotes, cache: 'miss' });
}

async function upsertSnapshots(env: Env, quotes: QuoteOut[]): Promise<void> {
  const rows = quotes
    .filter((q) => q.price !== null)
    .map((q) => ({
      ticker: q.ticker,
      price: q.price,
      prev_close: q.prevClose,
      change: q.change,
      change_pct: q.changePct,
      market_state: q.marketState,
      source: q.source,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return;
  const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/quote_snapshots?on_conflict=ticker`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    throw new Error(`supabase upsert ${r.status}: ${await r.text()}`);
  }
}

async function handleChart(url: URL, env: Env): Promise<Response> {
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
  const range = url.searchParams.get('range') ?? '1y';
  const interval = url.searchParams.get('interval') ?? '1d';
  if (!symbol) return json({ error: 'missing_symbol' }, 400);

  const cacheKey = `chart:${symbol}:${range}:${interval}`;
  const cached = await env.QUOTE_CACHE.get(cacheKey, 'json');
  if (cached) return json({ ...cached, cache: 'hit' });

  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
  const r = await fetch(upstream, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) return json({ error: 'upstream_error', status: r.status }, 502);
  const data = (await r.json()) as unknown;

  await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: CHART_TTL });
  return json(data);
}

async function fetchV7Quotes(symbols: string[]): Promise<QuoteOut[]> {
  const upstream = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  const r = await fetch(upstream, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`v7 ${r.status}`);
  const data = (await r.json()) as YahooV7Quote;
  return (data.quoteResponse?.result ?? []).map((row) => ({
    ticker: row.symbol,
    price: numOrNull(row.regularMarketPrice),
    prevClose: numOrNull(row.regularMarketPreviousClose),
    change: numOrNull(row.regularMarketChange),
    changePct: numOrNull(row.regularMarketChangePercent),
    marketState: row.marketState ?? null,
    source: 'yahoo-v7' as const,
    cachedAt: new Date().toISOString(),
  }));
}

async function fetchV8Quote(symbol: string): Promise<QuoteOut | null> {
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const r = await fetch(upstream, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const data = (await r.json()) as YahooV8Chart;
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = meta.regularMarketPrice ?? null;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = price !== null && prev !== null ? price - prev : null;
  const changePct = price !== null && prev !== null && prev !== 0 ? (price - prev) / prev : null;
  return {
    ticker: symbol,
    price: numOrNull(price),
    prevClose: numOrNull(prev),
    change: numOrNull(change),
    changePct: numOrNull(changePct),
    marketState: meta.marketState ?? null,
    source: 'yahoo-v8',
    cachedAt: new Date().toISOString(),
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function buildCors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = allowed.includes(origin) ? origin : allowed[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function withCors(res: Response, headers: Record<string, string>): Response {
  const merged = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) merged.set(k, v);
  return new Response(res.body, { status: res.status, headers: merged });
}

// ---------- Yahoo response shapes (subset we use) ----------
interface YahooV7Quote {
  quoteResponse?: {
    result?: Array<{
      symbol: string;
      regularMarketPrice?: number;
      regularMarketPreviousClose?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      marketState?: string;
    }>;
  };
}

interface YahooV8Chart {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        marketState?: string;
      };
    }>;
  };
}
