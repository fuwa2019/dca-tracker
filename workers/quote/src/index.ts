/**
 * DCA Quote Worker
 * --------------------------------
 * GET /api/quote?symbols=VOO,QQQM,SMH
 *   → { quotes: [{ ticker, price, prevClose, change, changePct, marketState }] }
 *
 * GET /api/chart?symbol=VOO&range=1y&interval=1d&prepost=0
 *   → Yahoo v8/chart payload (passthrough)
 *
 * GET /api/search?q=VOO
 *   → { results: [{ symbol, name, exchange, type }] }
 *
 * GET /api/history?symbols=VOO,QQQM,SMH,SPY&range=5y
 *   -> { series: [{ ticker, points: [{date, close, adjustedClose}] }] }
 *      and upserts daily_prices
 *
 * CRON `15 22 * * 1-5` (UTC) — backfills latest trading day's close into daily_prices.
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

const QUOTE_TTL = 60;        // 1 min; front-end only polls while an app tab is open
const CHART_TTL = 60 * 60;   // 1 h
const HISTORY_TTL = 60 * 60; // 1 h (per symbol+range bucket)
const SEARCH_TTL = 60 * 60 * 24;

/** Default fallback watchlist for the scheduled cron when settings rows are unavailable. */
const DEFAULT_CRON_TICKERS = ['VOO', 'QQQM', 'SMH', 'SPY'];

interface QuoteOut {
  ticker: string;
  price: number | null;
  displayPrice: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  regularPrice: number | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketChangePct: number | null;
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketChangePct: number | null;
  session: 'pre_market' | 'regular' | 'after_hours' | 'overnight' | 'closed' | 'unknown';
  sessionLabel: string;
  isExtended: boolean;
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
      if (url.pathname === '/api/search') {
        return withCors(await handleSearch(url, env), corsHeaders);
      }
      if (url.pathname === '/api/history') {
        return withCors(await handleHistory(url, env, ctx), corsHeaders);
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

  /**
   * Scheduled trigger — runs after US market close (UTC 22:15 = ET 17:15 EST / 18:15 EDT).
   * Pulls the union of every user's watchlist + configured benchmarks, fetches recent closes, and upserts
   * into daily_prices. Idempotent thanks to PK (ticker, trade_date).
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('[cron] missing Supabase secrets, skipping daily price sync');
      return;
    }
    ctx.waitUntil(runDailyPriceSync(env));
  },
};

async function runDailyPriceSync(env: Env): Promise<void> {
  const tickers = await collectCronTickers(env);
  console.log(`[cron] daily price sync for ${tickers.length} tickers: ${tickers.join(',')}`);
  for (const ticker of tickers) {
    try {
      const series = await fetchYahooHistory(ticker, '5d');
      if (series.points.length === 0) {
        console.warn(`[cron] no points for ${ticker}`);
        continue;
      }
      await upsertDailyPrices(env, series.ticker, series.points);
      console.log(`[cron] upserted ${series.points.length} rows for ${ticker}`);
    } catch (err) {
      console.error(`[cron] failed ${ticker}:`, err);
    }
  }
  await refreshDuePerformanceCaches(env);
}

async function collectCronTickers(env: Env): Promise<string[]> {
  try {
    const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/settings?select=watchlist,benchmarks,selected_benchmark`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    });
    if (!r.ok) throw new Error(`settings ${r.status}`);
    const rows = (await r.json()) as Array<{ watchlist?: string[]; benchmarks?: string[]; selected_benchmark?: string }>;
    const set = new Set<string>();
    for (const row of rows) {
      for (const t of row.watchlist ?? []) set.add(t.toUpperCase());
      for (const t of row.benchmarks ?? []) set.add(t.toUpperCase());
      if (row.selected_benchmark) set.add(row.selected_benchmark.toUpperCase());
    }
    set.add('SPY'); // default benchmark fallback
    return [...set];
  } catch (err) {
    console.warn('[cron] settings fetch failed, falling back to DEFAULT_CRON_TICKERS', err);
    return [...DEFAULT_CRON_TICKERS];
  }
}

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
  const prepost = url.searchParams.get('prepost') === '1' || url.searchParams.get('includePrePost') === 'true';
  if (!symbol) return json({ error: 'missing_symbol' }, 400);

  const cacheKey = `chart:${symbol}:${range}:${interval}:${prepost ? 'prepost' : 'regular'}`;
  const cached = await env.QUOTE_CACHE.get(cacheKey, 'json');
  if (cached) return json({ ...cached, cache: 'hit' });

  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=${prepost ? 'true' : 'false'}&events=div%2Csplit`;
  const r = await fetch(upstream, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) return json({ error: 'upstream_error', status: r.status }, 502);
  const data = (await r.json()) as unknown;

  await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: CHART_TTL });
  return json(data);
}

async function handleSearch(url: URL, env: Env): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return json({ results: [] });
  const cacheKey = `search:${q.toUpperCase()}`;
  const cached = await env.QUOTE_CACHE.get(cacheKey, 'json');
  if (cached) return json({ results: cached, cache: 'hit' });
  const upstream = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true`;
  const r = await fetch(upstream, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) return json({ error: 'upstream_error', status: r.status }, 502);
  const data = (await r.json()) as YahooSearch;
  const results = (data.quotes ?? [])
    .map((row) => ({
      symbol: (row.symbol ?? '').trim().toUpperCase(),
      name: row.shortname ?? row.longname ?? row.symbol ?? '',
      exchange: row.exchange ?? null,
      type: row.quoteType ?? null,
    }))
    .filter((row) => row.symbol)
    .slice(0, 8);
  await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: SEARCH_TTL });
  return json({ results, cache: 'miss' });
}

interface HistoryPoint {
  date: string; // YYYY-MM-DD
  close: number;
  adjustedClose?: number;
}
interface HistorySeries {
  ticker: string;
  points: HistoryPoint[];
}

async function handleHistory(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = url.searchParams.get('symbols') ?? '';
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 10);
  const range = url.searchParams.get('range') ?? '5y';
  const persist = url.searchParams.get('persist') ?? '';
  if (symbols.length === 0) return json({ error: 'missing_symbols' }, 400);
  if (persist === 'sync' && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    return json({
      error: 'supabase_config_missing',
      message: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for persist=sync',
    }, 500);
  }

  const cacheKey = `history:${symbols.join(',')}:${range}`;
  const cached = await env.QUOTE_CACHE.get(cacheKey, 'json') as unknown;
  if (isHistorySeriesArray(cached)) {
    if (persist !== 'sync') return json({ series: cached, cache: 'hit' });

    try {
      await Promise.all(
        cached
          .filter((s) => s.points.length > 0)
          .map((s) => upsertDailyPrices(env, s.ticker, s.points)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: 'daily_prices_upsert_failed', message: msg }, 500);
    }
    return json({ series: cached, cache: 'hit', persisted: true });
  }
  if (cached) {
    console.warn('[history] ignoring invalid cached history payload');
  }

  const series = await Promise.all(
    symbols.map((s) => fetchYahooHistory(s, range).catch((e) => {
      console.warn(`[history] ${s} failed:`, e);
      return { ticker: s, points: [] as HistoryPoint[] };
    })),
  );

  const successful = series.filter((s) => s.points.length > 0);
  if (successful.length > 0) {
    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(series), { expirationTtl: HISTORY_TTL });
    if (persist === 'sync') {
      try {
        await Promise.all(successful.map((s) => upsertDailyPrices(env, s.ticker, s.points)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: 'daily_prices_upsert_failed', message: msg }, 500);
      }
      return json({ series, cache: 'miss', persisted: true });
    }
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.waitUntil(
        Promise.all(successful.map((s) => upsertDailyPrices(env, s.ticker, s.points)))
          .catch((e) => console.warn('[history] daily_prices upsert failed:', e)),
      );
    }
  }

  return json({ series, cache: 'miss' });
}

function isHistorySeriesArray(value: unknown): value is HistorySeries[] {
  return Array.isArray(value) && value.every(isHistorySeries);
}

function isHistorySeries(value: unknown): value is HistorySeries {
  if (!value || typeof value !== 'object') return false;
  const row = value as { ticker?: unknown; points?: unknown };
  return typeof row.ticker === 'string' && Array.isArray(row.points) && row.points.every(isHistoryPoint);
}

function isHistoryPoint(value: unknown): value is HistoryPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as { date?: unknown; close?: unknown; adjustedClose?: unknown };
  return (
    typeof point.date === 'string'
    && typeof point.close === 'number'
    && Number.isFinite(point.close)
    && (
      point.adjustedClose === undefined
      || (typeof point.adjustedClose === 'number' && Number.isFinite(point.adjustedClose))
    )
  );
}

async function fetchYahooHistory(symbol: string, range: string): Promise<HistorySeries> {
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false&events=div%2Csplit`;
  const r = await fetch(upstream, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  const data = (await r.json()) as YahooV8Chart;
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const adjustedCloses = result?.indicators?.adjclose?.[0]?.adjclose ?? [];

  const points: HistoryPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const c = closes[i];
    const adjusted = adjustedCloses[i];
    if (typeof ts !== 'number' || typeof c !== 'number' || !Number.isFinite(c)) continue;
    // Yahoo timestamps are at the trading-day open in ET; converting to UTC and
    // slicing YYYY-MM-DD gives the correct calendar date as long as the open
    // is past midnight UTC (which is always true since ET = UTC-4 / -5).
    points.push({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: c,
      adjustedClose: typeof adjusted === 'number' && Number.isFinite(adjusted) ? adjusted : c,
    });
  }
  return { ticker: symbol, points };
}

async function upsertDailyPrices(env: Env, ticker: string, points: HistoryPoint[]): Promise<void> {
  if (points.length === 0) return;
  const rows = points.map((p) => ({
    ticker,
    trade_date: p.date,
    close: p.close,
    adjusted_close: p.adjustedClose ?? p.close,
    source: 'yahoo',
    updated_at: new Date().toISOString(),
  }));
  // Supabase RPC batch upsert. PostgREST limits payload, so chunk if >1000 rows.
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/rpc/upsert_daily_prices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      body: JSON.stringify({ p_rows: slice }),
    });
    if (!r.ok) throw new Error(`supabase upsert_daily_prices rpc ${r.status}: ${await r.text()}`);
  }
}

async function refreshDuePerformanceCaches(env: Env): Promise<void> {
  try {
    const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/rpc/refresh_due_performance_caches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      body: JSON.stringify({ p_limit: 25 }),
    });
    if (!r.ok) throw new Error(`refresh_due_performance_caches ${r.status}: ${await r.text()}`);
    console.log('[cron] refreshed performance caches:', await r.text());
  } catch (err) {
    console.warn('[cron] performance cache refresh failed:', err);
  }
}

async function fetchV7Quotes(symbols: string[]): Promise<QuoteOut[]> {
  const upstream = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  const r = await fetch(upstream, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`v7 ${r.status}`);
  const data = (await r.json()) as YahooV7Quote;
  return (data.quoteResponse?.result ?? []).map((row) => {
    const regularPrice = numOrNull(row.regularMarketPrice);
    const prevClose = numOrNull(row.regularMarketPreviousClose);
    const preMarketPrice = numOrNull(row.preMarketPrice);
    const postMarketPrice = numOrNull(row.postMarketPrice);
    const marketState = row.marketState ?? null;
    const session = sessionFromMarketState(marketState);
    const extendedPrice = session === 'pre_market' ? preMarketPrice : session === 'after_hours' ? postMarketPrice : null;
    const displayPrice = extendedPrice ?? regularPrice;
    const change = session === 'pre_market'
      ? numOrNull(row.preMarketChange) ?? diff(displayPrice, prevClose)
      : session === 'after_hours'
        ? numOrNull(row.postMarketChange) ?? diff(displayPrice, regularPrice ?? prevClose)
        : numOrNull(row.regularMarketChange);
    const changePct = session === 'pre_market'
      ? pctFromV7(row.preMarketChangePercent) ?? ratio(change, prevClose)
      : session === 'after_hours'
        ? pctFromV7(row.postMarketChangePercent) ?? ratio(change, regularPrice ?? prevClose)
        : pctFromV7(row.regularMarketChangePercent);
    return {
      ticker: (row.symbol ?? '').trim().toUpperCase(),
      price: displayPrice,
      displayPrice,
      prevClose,
      change,
      changePct,
      regularPrice,
      preMarketPrice,
      preMarketChange: numOrNull(row.preMarketChange),
      preMarketChangePct: pctFromV7(row.preMarketChangePercent),
      postMarketPrice,
      postMarketChange: numOrNull(row.postMarketChange),
      postMarketChangePct: pctFromV7(row.postMarketChangePercent),
      session,
      sessionLabel: sessionLabel(session),
      isExtended: session === 'pre_market' || session === 'after_hours' || session === 'overnight',
      marketState,
      source: 'yahoo-v7' as const,
      cachedAt: new Date().toISOString(),
    };
  });
}

async function fetchV8Quote(symbol: string): Promise<QuoteOut | null> {
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`;
  const r = await fetch(upstream, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const data = (await r.json()) as YahooV8Chart;
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = meta.regularMarketPrice ?? null;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const session = sessionFromMarketState(meta.marketState ?? null);
  const change = price !== null && prev !== null ? price - prev : null;
  const changePct = price !== null && prev !== null && prev !== 0 ? (price - prev) / prev : null;
  return {
    ticker: symbol.trim().toUpperCase(),
    price: numOrNull(price),
    displayPrice: numOrNull(price),
    prevClose: numOrNull(prev),
    change: numOrNull(change),
    changePct: numOrNull(changePct),
    regularPrice: numOrNull(meta.regularMarketPrice),
    preMarketPrice: null,
    preMarketChange: null,
    preMarketChangePct: null,
    postMarketPrice: null,
    postMarketChange: null,
    postMarketChangePct: null,
    session,
    sessionLabel: sessionLabel(session),
    isExtended: session === 'pre_market' || session === 'after_hours' || session === 'overnight',
    marketState: meta.marketState ?? null,
    source: 'yahoo-v8',
    cachedAt: new Date().toISOString(),
  };
}

function diff(a: number | null, b: number | null): number | null {
  return a !== null && b !== null ? a - b : null;
}

function ratio(change: number | null, base: number | null): number | null {
  return change !== null && base !== null && base !== 0 ? change / base : null;
}

function sessionFromMarketState(state: string | null): QuoteOut['session'] {
  const s = (state ?? '').toUpperCase();
  if (s === 'PRE' || s === 'PREPRE') return 'pre_market';
  if (s === 'REGULAR') return 'regular';
  if (s === 'POST' || s === 'POSTPOST') return 'after_hours';
  if (s === 'OVERNIGHT') return 'overnight';
  if (s === 'CLOSED') return 'closed';
  return 'unknown';
}

function sessionLabel(session: QuoteOut['session']): string {
  if (session === 'pre_market') return '盘前';
  if (session === 'regular') return '盘中';
  if (session === 'after_hours') return '盘后';
  if (session === 'overnight') return '夜盘';
  if (session === 'closed') return '收盘';
  return '行情';
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Yahoo v7 returns changePct as a percentage (e.g. 0.39 = 0.39%). Divide by 100. */
function pctFromV7(v: unknown): number | null {
  const n = numOrNull(v);
  return n !== null ? n / 100 : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function buildCors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = isOriginAllowed(origin, allowed) ? origin : allowed[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Allow exact match OR wildcard `*` segments. Examples:
 *    "https://dca-tracker.pages.dev" → exact only
 *    "https://*.dca-tracker.pages.dev" → matches any subdomain (CF Pages preview deploys)
 *    "https://*.pages.dev" → matches every Pages site (broader; use sparingly)
 */
function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (!origin) return false;
  for (const rule of allowed) {
    if (rule === origin) return true;
    if (!rule.includes('*')) continue;
    // Escape regex specials, then turn '*' into '[^.]+' (one DNS label).
    const pattern = '^' + rule.split('*').map(escapeRegex).join('[^.]+') + '$';
    if (new RegExp(pattern).test(origin)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      preMarketPrice?: number;
      preMarketChange?: number;
      preMarketChangePercent?: number;
      postMarketPrice?: number;
      postMarketChange?: number;
      postMarketChangePercent?: number;
      marketState?: string;
    }>;
  };
}

interface YahooSearch {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    quoteType?: string;
  }>;
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
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
        adjclose?: Array<{
          adjclose?: Array<number | null>;
        }>;
      };
    }>;
  };
}
