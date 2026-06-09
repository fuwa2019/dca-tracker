/**
 * DCA Quote Worker
 * --------------------------------
 * GET /api/quote?symbols=VOO,QQQM,SMH
 * GET /api/market/quotes?symbols=VOO,QQQM,SMH
 *   → { quotes: [{ ticker, price, prevClose, change, changePct, marketState }] }
 *
 * GET /api/chart?symbol=VOO&range=1y&interval=1d&prepost=0
 *   → Yahoo v8/chart payload (passthrough)
 *
 * GET /api/search?q=VOO
 *   → { results: [{ symbol, name, exchange, type }] }
 *
 * GET /api/history?symbols=VOO,QQQM,SMH,SPY&range=5y
 * GET /api/market/price-history?symbol=VOO
 *   -> { series: [{ ticker, points: [{date, close, adjustedClose}] }] }
 *      and upserts daily_prices
 *
 * CRON `15 22 * * *`, `15 12 * * *` (UTC) — backfills closes, writes a
 * quote-based provisional close when the historical candle lags, then retries
 * so provisional rows reconcile to final history data.
 *
 * Source: Yahoo by default, or Schwab Market Data when MARKET_DATA_PROVIDER=schwab.
 * Browser can't call upstream providers directly; this Worker is the only proxy.
 */

import {
  buildSchwabAuthorizeUrl,
  currentSchwabRefreshToken,
  exchangeSchwabAuthorizationCode,
  marketDataProviderFromEnv,
  normalizeSymbol,
  parseSymbolsParam,
  refreshSchwabAccessToken,
  sanitizeForLog,
  SchwabMarketDataClient,
  type HistoryPoint,
  type HistorySeries,
  type NormalizedQuote,
} from './marketData';
import {
  isQuoteEligibleForProvisionalClose,
  isoDateInNewYork,
  isNyseTradingDay,
  lastCompletedNyseTradingDate,
} from './nyseCalendar.js';

export interface Env {
  QUOTE_CACHE: KVNamespace;
  ALLOWED_ORIGINS: string;
  /** Optional. If set, every successful /api/quote also upserts into Supabase
   *  `quote_snapshots` (so anonymous /share/[token] views have prices to compute returns). */
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MARKET_DATA_PROVIDER?: string;
  SCHWAB_CLIENT_ID?: string;
  SCHWAB_CLIENT_SECRET?: string;
  SCHWAB_REDIRECT_URI?: string;
  SCHWAB_REFRESH_TOKEN?: string;
  SCHWAB_TOKEN_STORE?: KVNamespace;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const QUOTE_TTL = 60;        // 1 min; front-end only polls while an app tab is open
const CHART_TTL = 60 * 60;   // 1 h
const HISTORY_TTL = 60 * 60; // 1 h (per symbol+range bucket)
const SEARCH_TTL = 60 * 60 * 24;
const HISTORY_MAX_PROVIDER_FETCHES_PER_INVOCATION = 10;
const HISTORY_MAX_REQUESTED_SYMBOLS = 1000;
const QUOTE_SNAPSHOT_ACTIVE_MAX_AGE_MS = QUOTE_TTL * 1000;

/** Default fallback watchlist for the scheduled cron when settings rows are unavailable. */
const DEFAULT_CRON_TICKERS = ['VOO', 'QQQM', 'SMH', 'SPY'];

type QuoteOut = NormalizedQuote;

interface DailyPriceReadItem {
  symbol: string;
  start_date: string;
  end_date: string;
}

interface DailyPriceReadRow {
  symbol?: string;
  ticker?: string;
  trade_date?: string;
  close?: number | string | null;
  adjusted_close?: number | string | null;
  source?: string | null;
  as_of_timestamp?: string | null;
  is_provisional?: boolean | null;
  updated_at?: string | null;
}

interface DailyPriceMissingRange {
  symbol?: string;
  start_date?: string;
  end_date?: string;
}

interface QuoteSnapshotRow {
  ticker?: string;
  price?: number | string | null;
  prev_close?: number | string | null;
  change?: number | string | null;
  change_pct?: number | string | null;
  market_state?: string | null;
  source?: string | null;
  as_of_timestamp?: string | null;
  updated_at?: string | null;
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
      if (url.pathname === '/api/market/quotes') {
        return withCors(await handleQuote(url, env, ctx), corsHeaders);
      }
      if (url.pathname === '/api/market/price-history') {
        return withCors(await handlePriceHistory(url, env), corsHeaders);
      }
      if (url.pathname === '/api/schwab/oauth/url') {
        return withCors(await handleSchwabAuthorizeUrl(url, env), corsHeaders);
      }
      if (url.pathname === '/api/schwab/oauth/callback') {
        return withCors(await handleSchwabCallback(url, env), corsHeaders);
      }
      if (url.pathname === '/api/schwab/oauth/refresh') {
        return withCors(await handleSchwabRefresh(env), corsHeaders);
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
      const msg = String(sanitizeForLog(err instanceof Error ? err.message : String(err)));
      return withCors(json({ error: 'worker_error', message: msg }, 500), corsHeaders);
    }
  },

  /**
   * Scheduled trigger — runs after US market close and again the next morning.
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
      const series = await fetchHistoryFromProvider(env, ticker, '5d');
      if (series.points.length === 0) {
        console.warn(`[cron] no points for ${ticker}`);
        await updateTrackedSymbolBackfill(env, ticker, 'missing');
        continue;
      }
      await upsertDailyPrices(env, series.ticker, series.points, historySourceForDailyPrices(env, series));
      console.log(`[cron] upserted ${series.points.length} rows for ${ticker}`);
    } catch (err) {
      console.error(`[cron] failed ${ticker}:`, err);
      await updateTrackedSymbolBackfill(env, ticker, backfillFailureStatus(err), errorMessage(err));
    }
  }
  try {
    const tradingDate = lastCompletedNyseTradingDate();
    const quotes = await fetchQuotesFromProvider(env, tickers);
    await upsertSnapshots(env, quotes);
    await upsertProvisionalDailyPrices(env, tradingDate, quotes);
  } catch (err) {
    console.warn('[cron] provisional close sync failed:', err);
  }
  await refreshDuePerformanceCaches(env);
}

async function collectCronTickers(env: Env): Promise<string[]> {
  try {
    const active = await fetch(`${env.SUPABASE_URL!}/rest/v1/rpc/active_monitor_universe`, {
      method: 'POST',
      headers: supabaseHeaders(env),
      body: JSON.stringify({ p_benchmark: null }),
    });
    if (!active.ok) throw new Error(`active_monitor_universe ${active.status}`);
    const rows = (await active.json()) as Array<{ symbol?: string }>;
    const symbols = parseSymbolsParam(rows.map((row) => row.symbol ?? '').join(','), 1000);
    if (symbols.length > 0) return symbols;
  } catch (err) {
    console.warn('[cron] active_monitor_universe fetch failed, falling back to tracked_symbols', err);
  }
  try {
    const tracked = await fetch(`${env.SUPABASE_URL!}/rest/v1/tracked_symbols?select=symbol&enabled=eq.true`, {
      headers: supabaseHeaders(env),
    });
    if (!tracked.ok) throw new Error(`tracked_symbols ${tracked.status}`);
    const trackedRows = (await tracked.json()) as Array<{ symbol?: string }>;
    const trackedSymbols = parseSymbolsParam(trackedRows.map((row) => row.symbol ?? '').join(','), 1000);
    if (trackedSymbols.length > 0) return trackedSymbols;
  } catch (err) {
    console.warn('[cron] tracked_symbols fetch failed, falling back to settings', err);
  }
  try {
    const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/settings?select=watchlist,benchmarks,selected_benchmark`, {
      headers: supabaseHeaders(env),
    });
    if (!r.ok) throw new Error(`settings ${r.status}`);
    const rows = (await r.json()) as Array<{ watchlist?: string[]; benchmarks?: string[]; selected_benchmark?: string }>;
    const set = new Set<string>();
    for (const row of rows) {
      for (const t of row.watchlist ?? []) set.add(normalizeSymbol(t));
      for (const t of row.benchmarks ?? []) set.add(normalizeSymbol(t));
      if (row.selected_benchmark) set.add(normalizeSymbol(row.selected_benchmark));
    }
    set.add('SPY'); // default benchmark fallback
    return [...set];
  } catch (err) {
    console.warn('[cron] settings fetch failed, falling back to DEFAULT_CRON_TICKERS', err);
    return [...DEFAULT_CRON_TICKERS];
  }
}

async function handleQuote(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const symbols = parseSymbolsParam(url.searchParams.get('symbols'), 20);

  if (symbols.length === 0) {
    return json({ error: 'missing_symbols' }, 400);
  }
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    ctx.waitUntil(registerTrackedSymbols(env, symbols, 'quote').catch((e) => console.warn('[quote] symbol registration failed:', e)));
  }

  const provider = marketDataProviderFromEnv(env);
  const snapshots = hasSupabase(env)
    ? await readQuoteSnapshots(env, symbols).catch((e) => {
      console.warn('[quote] quote_snapshots read failed:', sanitizeForLog(e));
      return [] as QuoteOut[];
    })
    : [];
  if (snapshotsCoverClosedMarket(symbols, snapshots)) {
    return json({ quotes: orderQuotes(symbols, snapshots), cache: 'snapshot' });
  }

  const cacheKey = `quote:${provider}:${symbols.join(',')}`;
  const cached = await env.QUOTE_CACHE.get(cacheKey, 'json');
  if (cached) {
    return json({ quotes: cached, cache: 'hit' });
  }

  const refreshSymbols = symbolsNeedingQuoteRefresh(symbols, snapshots);
  if (refreshSymbols.length === 0 && snapshots.length > 0) {
    return json({ quotes: orderQuotes(symbols, snapshots), cache: 'snapshot' });
  }

  let providerQuotes: QuoteOut[] = [];
  try {
    providerQuotes = await fetchQuotesFromProvider(env, refreshSymbols.length > 0 ? refreshSymbols : symbols);
  } catch (err) {
    if (snapshots.length > 0) {
      console.warn('[quote] provider fetch failed, returning quote_snapshots:', sanitizeForLog(err));
      return json({ quotes: orderQuotes(symbols, snapshots), cache: 'snapshot-fallback' });
    }
    throw err;
  }
  const quotes = mergeQuotes(symbols, snapshots, providerQuotes);

  if (quotes.length > 0) {
    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(quotes), { expirationTtl: QUOTE_TTL });
    // Fire-and-forget snapshot to Supabase so anonymous /share/[token] pages
    // can compute return_pct without needing direct Yahoo access.
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && providerQuotes.length > 0) {
      ctx.waitUntil(upsertSnapshots(env, providerQuotes).catch((e) => console.warn('snapshot upsert failed:', e)));
    }
  }

  return json({ quotes, cache: 'miss' });
}

async function fetchQuotesFromProvider(env: Env, symbols: string[]): Promise<QuoteOut[]> {
  const provider = marketDataProviderFromEnv(env);
  let quotes: QuoteOut[] = [];
  if (provider === 'schwab') {
    try {
      quotes = await new SchwabMarketDataClient(env).getQuotes(symbols);
    } catch (err) {
      console.warn('[quote] Schwab quote fetch failed, falling back to Yahoo:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
      quotes = await fetchYahooQuotes(symbols, true);
    }
    const missing = symbols.filter((s) => !quotes.find((q) => q.ticker === s && q.price !== null));
    if (missing.length > 0) {
      const fallback = await fetchYahooQuotes(missing, true);
      const byTicker = new Map(quotes.map((q) => [q.ticker, q]));
      for (const q of fallback) byTicker.set(q.ticker, q);
      quotes = symbols.flatMap((s) => {
        const q = byTicker.get(s);
        return q ? [q] : [];
      });
    }
  } else {
    quotes = await fetchYahooQuotes(symbols, false);
  }
  return quotes;
}

async function fetchYahooQuotes(symbols: string[], fallback: boolean): Promise<QuoteOut[]> {
  let quotes: QuoteOut[] = [];
  // Primary: v7 quote endpoint (returns multiple symbols in one shot)
  try {
    quotes = await fetchV7Quotes(symbols, fallback);
  } catch {
    quotes = [];
  }

  // Fallback per-symbol via v8 chart (more resilient when v7 is throttled)
  const missing = symbols.filter((s) => !quotes.find((q) => q.ticker === s));
  if (missing.length > 0) {
    const fallbackQuotes = await Promise.all(missing.map((s) => fetchV8Quote(s, fallback).catch(() => null)));
    for (const q of fallbackQuotes) if (q) quotes.push(q);
  }
  return quotes;
}

async function readQuoteSnapshots(env: Env, symbols: string[]): Promise<QuoteOut[]> {
  if (!hasSupabase(env) || symbols.length === 0) return [];
  const inFilter = `in.(${symbols.map(encodePostgrestInValue).join(',')})`;
  const fields = 'ticker,price,prev_close,change,change_pct,market_state,source,as_of_timestamp,updated_at';
  const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/quote_snapshots?select=${fields}&ticker=${encodeURIComponent(inFilter)}`, {
    headers: supabaseHeaders(env),
  });
  if (!r.ok) throw new Error(`quote_snapshots ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as QuoteSnapshotRow[];
  return rows.flatMap(snapshotRowToQuote);
}

function snapshotRowToQuote(row: QuoteSnapshotRow): QuoteOut[] {
  const ticker = normalizeSymbol(row.ticker ?? '');
  const price = numOrNull(row.price);
  if (!ticker || price === null) return [];
  const source = row.source?.trim().toLowerCase() === 'schwab' ? 'schwab' : 'yahoo';
  const fetchedAt = row.updated_at ?? new Date().toISOString();
  return [{
    ticker,
    price,
    displayPrice: price,
    prevClose: numOrNull(row.prev_close),
    change: numOrNull(row.change),
    changePct: numOrNull(row.change_pct),
    regularPrice: price,
    preMarketPrice: null,
    preMarketChange: null,
    preMarketChangePct: null,
    postMarketPrice: null,
    postMarketChange: null,
    postMarketChangePct: null,
    session: sessionFromMarketState(row.market_state ?? null),
    sessionLabel: sessionLabel(sessionFromMarketState(row.market_state ?? null)),
    isExtended: false,
    marketState: row.market_state ?? null,
    source,
    asOf: row.as_of_timestamp ?? row.updated_at ?? undefined,
    fetchedAt,
    fallback: false,
    providerLabel: `${source}-snapshot`,
    cachedAt: fetchedAt,
  }];
}

function snapshotsCoverClosedMarket(symbols: string[], quotes: QuoteOut[], now = new Date()): boolean {
  if (isUsMarketDataActive(now)) return false;
  const completedDate = lastCompletedNyseTradingDate(now);
  return symbols.every((symbol) => {
    const quote = quotes.find((q) => q.ticker === symbol && q.price !== null);
    return !!quote && quoteDateInNewYork(quote) >= completedDate;
  });
}

function symbolsNeedingQuoteRefresh(symbols: string[], snapshots: QuoteOut[], now = new Date()): string[] {
  const active = isUsMarketDataActive(now);
  const completedDate = lastCompletedNyseTradingDate(now);
  return symbols.filter((symbol) => {
    const quote = snapshots.find((q) => q.ticker === symbol && q.price !== null);
    if (!quote) return true;
    if (active) return quoteAgeMs(quote, now) > QUOTE_SNAPSHOT_ACTIVE_MAX_AGE_MS;
    return quoteDateInNewYork(quote) < completedDate;
  });
}

function mergeQuotes(symbols: string[], snapshots: QuoteOut[], providerQuotes: QuoteOut[]): QuoteOut[] {
  const byTicker = new Map<string, QuoteOut>();
  for (const quote of snapshots) byTicker.set(quote.ticker, quote);
  for (const quote of providerQuotes) byTicker.set(quote.ticker, quote);
  return symbols.flatMap((symbol) => {
    const quote = byTicker.get(symbol);
    return quote ? [quote] : [];
  });
}

function orderQuotes(symbols: string[], quotes: QuoteOut[]): QuoteOut[] {
  const byTicker = new Map(quotes.map((q) => [q.ticker, q]));
  return symbols.flatMap((symbol) => {
    const quote = byTicker.get(symbol);
    return quote ? [quote] : [];
  });
}

function quoteDateInNewYork(quote: QuoteOut): string {
  const raw = quote.asOf ?? quote.fetchedAt ?? quote.cachedAt;
  const parsed = raw ? new Date(raw) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? isoDateInNewYork(parsed) : '0000-00-00';
}

function quoteAgeMs(quote: QuoteOut, now: Date): number {
  const raw = quote.fetchedAt ?? quote.cachedAt ?? quote.asOf;
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? now.getTime() - parsed : Number.POSITIVE_INFINITY;
}

function isUsMarketDataActive(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = byType.weekday ?? '';
  const rawHour = Number(byType.hour ?? '0');
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(byType.minute ?? '0');
  const date = `${byType.year}-${byType.month}-${byType.day}`;
  const minutes = hour * 60 + minute;
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isHoliday = !isNyseTradingDay(date);
  const isSundayNight = weekday === 'Sun' && minutes >= 20 * 60;
  const isOvernightMorning = !isWeekend && !isHoliday && minutes < 4 * 60;
  const isWeeknight = !isWeekend && !isHoliday && weekday !== 'Fri' && minutes >= 20 * 60;
  const isExtendedOrRegular = !isWeekend && !isHoliday && minutes >= 4 * 60 && minutes < 20 * 60;
  return isSundayNight || isOvernightMorning || isWeeknight || isExtendedOrRegular;
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
      as_of_timestamp: q.asOf ?? q.fetchedAt,
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
  const symbol = normalizeSymbol(url.searchParams.get('symbol') ?? '');
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
      symbol: normalizeSymbol(row.symbol ?? ''),
      name: row.shortname ?? row.longname ?? row.symbol ?? '',
      exchange: row.exchange ?? null,
      type: row.quoteType ?? null,
    }))
    .filter((row) => row.symbol)
    .slice(0, 8);
  await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: SEARCH_TTL });
  return json({ results, cache: 'miss' });
}

async function handleHistory(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const allSymbols = parseSymbolsParam(url.searchParams.get('symbols'), HISTORY_MAX_REQUESTED_SYMBOLS);
  const range = url.searchParams.get('range') ?? '5y';
  const persist = url.searchParams.get('persist') ?? '';
  const provider = marketDataProviderFromEnv(env);
  const cursor = clampInt(url.searchParams.get('cursor'), 0, allSymbols.length);
  const requestedLimit = clampInt(url.searchParams.get('limit'), HISTORY_MAX_PROVIDER_FETCHES_PER_INVOCATION, HISTORY_MAX_PROVIDER_FETCHES_PER_INVOCATION);
  const limit = Math.max(1, Math.min(requestedLimit, HISTORY_MAX_PROVIDER_FETCHES_PER_INVOCATION));
  const symbols = allSymbols.slice(cursor, cursor + limit);
  const nextCursor = Math.min(cursor + symbols.length, allSymbols.length);
  const progress = {
    total: allSymbols.length,
    completed: nextCursor,
    remaining: Math.max(0, allSymbols.length - nextCursor),
    currentTicker: symbols[symbols.length - 1] ?? null,
    limit,
  };
  if (allSymbols.length === 0) return json({ error: 'missing_symbols' }, 400);
  if (symbols.length === 0) {
    return json({ series: [], progress, hasMore: false, nextCursor: null });
  }
  if (persist === 'sync' && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    return json({
      error: 'supabase_config_missing',
      message: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for persist=sync',
    }, 500);
  }
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    await registerTrackedSymbols(env, symbols, 'history');
  }

  const startDates = parseSymbolDateMap(url.searchParams.get('startDates'));
  const endDates = parseSymbolDateMap(url.searchParams.get('endDates'));
  const defaultStartDate = normalizeIsoDate(url.searchParams.get('startDate'));
  const defaultEndDate = normalizeIsoDate(url.searchParams.get('endDate'));
  const calendarSymbol = normalizeSymbol(url.searchParams.get('calendarSymbol') ?? '') || 'SPY';
  const cacheKey = historyCacheKey(provider, symbols, range, startDates, endDates, defaultStartDate, defaultEndDate);

  if (hasSupabase(env)) {
    const bounds = symbols.map((symbol) => historyBoundsForSymbol(symbol, range, startDates, endDates, defaultStartDate, defaultEndDate));
    try {
      const dbSeries = await readDailyPriceSeries(env, bounds);
      const missingRanges = await readDailyPriceMissingRanges(env, bounds, calendarSymbol);
      if (missingRanges.length === 0) {
        await Promise.all(dbSeries.map((item) => updateTrackedSymbolFromSeries(env, item)));
        return json({
          series: orderHistorySeries(symbols, dbSeries),
          cache: 'database',
          persisted: persist === 'sync' ? true : undefined,
          progress,
          hasMore: nextCursor < allSymbols.length,
          nextCursor: nextCursor < allSymbols.length ? String(nextCursor) : null,
        });
      }

      const providerSeries = await fetchMissingHistoryRanges(env, url.searchParams, range, missingRanges);
      const successful = providerSeries.filter((s) => s.points.length > 0);
      if (successful.length > 0) {
        await upsertDailyPriceSeriesBulk(env, successful);
        await upsertHistorySnapshotsWhenClosed(env, providerSeries);
      }

      const refreshed = await readDailyPriceSeries(env, bounds);
      const ordered = orderHistorySeries(symbols, refreshed);
      await Promise.all(ordered.map((item) => updateTrackedSymbolFromSeries(env, item)));
      await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(ordered), { expirationTtl: HISTORY_TTL });
      return json({
        series: ordered,
        cache: 'database-refresh',
        persisted: successful.length > 0 || persist === 'sync',
        progress,
        hasMore: nextCursor < allSymbols.length,
        nextCursor: nextCursor < allSymbols.length ? String(nextCursor) : null,
      });
    } catch (err) {
      console.warn('[history] daily_prices read-through failed, falling back to provider:', sanitizeForLog(err));
    }
  }

  const cached = await env.QUOTE_CACHE.get(cacheKey, 'json') as unknown;
  if (isHistorySeriesArray(cached)) {
    if (persist !== 'sync') return json({ series: cached, cache: 'hit' });

    try {
      await upsertDailyPriceSeriesBulk(env, cached.filter((s) => s.points.length > 0));
      await upsertHistorySnapshotsWhenClosed(env, cached);
      await Promise.all(cached.map((s) => updateTrackedSymbolFromSeries(env, s)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: 'daily_prices_upsert_failed', message: msg }, 500);
    }
    return json({ series: cached, cache: 'hit', persisted: true, progress, hasMore: nextCursor < allSymbols.length, nextCursor: nextCursor < allSymbols.length ? String(nextCursor) : null });
  }
  if (cached) {
    console.warn('[history] ignoring invalid cached history payload');
  }

  const failures = new Map<string, unknown>();
  const series: HistorySeries[] = [];
  for (const s of symbols) {
    const item = await fetchHistoryFromProvider(env, s, range, historyParamsForSymbol(url.searchParams, s, startDates, endDates, defaultStartDate, defaultEndDate)).catch((e) => {
      console.warn(`[history] ${s} failed:`, sanitizeForLog(e));
      failures.set(s, e);
      return { ticker: s, points: [] as HistoryPoint[] };
    });
    series.push(item);
  }
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    await Promise.all(series.map((item) => {
      const failure = failures.get(item.ticker);
      return failure
        ? updateTrackedSymbolBackfill(env, item.ticker, backfillFailureStatus(failure), errorMessage(failure))
        : updateTrackedSymbolFromSeries(env, item);
    }));
  }

  const successful = series.filter((s) => s.points.length > 0);
  if (successful.length > 0) {
    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(series), { expirationTtl: HISTORY_TTL });
    if (persist === 'sync') {
      try {
        await upsertDailyPriceSeriesBulk(env, successful);
        await upsertHistorySnapshotsWhenClosed(env, successful);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: 'daily_prices_upsert_failed', message: msg }, 500);
      }
      return json({ series, cache: 'miss', persisted: true, progress, hasMore: nextCursor < allSymbols.length, nextCursor: nextCursor < allSymbols.length ? String(nextCursor) : null });
    }
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.waitUntil(
        upsertDailyPriceSeriesBulk(env, successful)
          .then(() => upsertHistorySnapshotsWhenClosed(env, successful))
          .catch((e) => console.warn('[history] daily_prices upsert failed:', e)),
      );
    }
  }

  return json({ series, cache: 'miss', progress, hasMore: nextCursor < allSymbols.length, nextCursor: nextCursor < allSymbols.length ? String(nextCursor) : null });
}

async function handlePriceHistory(url: URL, env: Env): Promise<Response> {
  const symbol = normalizeSymbol(url.searchParams.get('symbol') ?? '');
  if (!symbol) return json({ error: 'missing_symbol' }, 400);
  const range = url.searchParams.get('range') ?? '10y';
  const cacheKey = `price-history:${marketDataProviderFromEnv(env)}:${symbol}:${url.searchParams.toString() || range}`;
  const cached = await env.QUOTE_CACHE.get(cacheKey, 'json') as unknown;
  if (isHistorySeries(cached)) return json({ series: cached, cache: 'hit' });
  const series = await fetchHistoryFromProvider(env, symbol, range, url.searchParams);
  await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(series), { expirationTtl: HISTORY_TTL * 6 });
  return json({ series, cache: 'miss' });
}

function handleSchwabAuthorizeUrl(url: URL, env: Env): Response {
  return json({ authorizationUrl: buildSchwabAuthorizeUrl(env, url.searchParams.get('state') ?? undefined) });
}

async function handleSchwabCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code') ?? '';
  const token = await exchangeSchwabAuthorizationCode(env, code);
  const body = [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<title>Schwab OAuth complete</title>',
    '<body>',
    '<h1>Schwab OAuth complete</h1>',
    '<p>Refresh token has been stored for the quote Worker. You can close this tab.</p>',
    '</body>',
  ].join('');
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handleSchwabRefresh(env: Env): Promise<Response> {
  const token = await refreshSchwabAccessToken(env);
  const storedRefreshToken = await currentSchwabRefreshToken(env);
  return json({
    ok: true,
    hasRefreshToken: !!token.refresh_token,
    refreshTokenStored: !!storedRefreshToken,
    expiresIn: token.expires_in ?? null,
  });
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
  const point = value as { date?: unknown; close?: unknown; adjustedClose?: unknown; asOfTimestamp?: unknown };
  return (
    typeof point.date === 'string'
    && typeof point.close === 'number'
    && Number.isFinite(point.close)
    && (
      point.adjustedClose === undefined
      || (typeof point.adjustedClose === 'number' && Number.isFinite(point.adjustedClose))
    )
    && (point.asOfTimestamp === undefined || typeof point.asOfTimestamp === 'string')
  );
}

function hasSupabase(env: Env): boolean {
  return !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY;
}

function historyBoundsForSymbol(
  symbol: string,
  range: string,
  startDates: Map<string, string>,
  endDates: Map<string, string>,
  defaultStartDate: string | null,
  defaultEndDate: string | null,
): DailyPriceReadItem {
  const endDate = endDates.get(symbol) ?? defaultEndDate ?? lastCompletedNyseTradingDate();
  const startDate = startDates.get(symbol) ?? defaultStartDate ?? startDateForRange(range, endDate);
  return {
    symbol,
    start_date: startDate <= endDate ? startDate : endDate,
    end_date: endDate,
  };
}

async function readDailyPriceSeries(env: Env, bounds: DailyPriceReadItem[]): Promise<HistorySeries[]> {
  if (bounds.length === 0) return [];
  const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/rpc/daily_price_readthrough`, {
    method: 'POST',
    headers: supabaseHeaders(env),
    body: JSON.stringify({ p_items: bounds }),
  });
  if (!r.ok) throw new Error(`daily_price_readthrough ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as DailyPriceReadRow[];
  const bySymbol = new Map<string, HistoryPoint[]>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol ?? row.ticker ?? '');
    const close = numOrNull(row.close);
    const date = normalizeIsoDate(row.trade_date ?? null);
    if (!symbol || close === null || !date) continue;
    const points = bySymbol.get(symbol) ?? [];
    points.push({
      date,
      close,
      adjustedClose: numOrNull(row.adjusted_close) ?? close,
      asOfTimestamp: row.as_of_timestamp ?? row.updated_at ?? undefined,
    });
    bySymbol.set(symbol, points);
  }
  return bounds.map((item) => ({
    ticker: item.symbol,
    points: (bySymbol.get(item.symbol) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

async function readDailyPriceMissingRanges(
  env: Env,
  bounds: DailyPriceReadItem[],
  calendarSymbol: string,
): Promise<DailyPriceReadItem[]> {
  if (bounds.length === 0) return [];
  const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/rpc/daily_price_missing_ranges`, {
    method: 'POST',
    headers: supabaseHeaders(env),
    body: JSON.stringify({ p_items: bounds, p_calendar_symbol: calendarSymbol }),
  });
  if (!r.ok) throw new Error(`daily_price_missing_ranges ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as DailyPriceMissingRange[];
  return rows.flatMap((row) => {
    const symbol = normalizeSymbol(row.symbol ?? '');
    const startDate = normalizeIsoDate(row.start_date ?? null);
    const endDate = normalizeIsoDate(row.end_date ?? null);
    return symbol && startDate && endDate ? [{ symbol, start_date: startDate, end_date: endDate }] : [];
  });
}

async function fetchMissingHistoryRanges(
  env: Env,
  baseParams: URLSearchParams,
  range: string,
  missingRanges: DailyPriceReadItem[],
): Promise<HistorySeries[]> {
  const merged = mergeMissingRangesBySymbol(missingRanges).slice(0, HISTORY_MAX_PROVIDER_FETCHES_PER_INVOCATION);
  const series: HistorySeries[] = [];
  for (const item of merged) {
    const params = new URLSearchParams(baseParams);
    params.set('startDate', item.start_date);
    params.set('startDateIso', item.start_date);
    params.set('startDateMillis', String(utcMillisForDate(item.start_date)));
    params.set('endDate', item.end_date);
    params.set('endDateIso', item.end_date);
    params.set('endDateMillis', String(utcMillisForDate(addDays(item.end_date, 1))));
    const result = await fetchHistoryFromProvider(env, item.symbol, range, params).catch((e) => {
      console.warn(`[history] ${item.symbol} missing range ${item.start_date}..${item.end_date} failed:`, sanitizeForLog(e));
      return { ticker: item.symbol, points: [] as HistoryPoint[] };
    });
    series.push(result);
  }
  return series;
}

function mergeMissingRangesBySymbol(ranges: DailyPriceReadItem[]): DailyPriceReadItem[] {
  const bySymbol = new Map<string, DailyPriceReadItem>();
  for (const range of ranges) {
    const current = bySymbol.get(range.symbol);
    if (!current) {
      bySymbol.set(range.symbol, { ...range });
      continue;
    }
    if (range.start_date < current.start_date) current.start_date = range.start_date;
    if (range.end_date > current.end_date) current.end_date = range.end_date;
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function orderHistorySeries(symbols: string[], series: HistorySeries[]): HistorySeries[] {
  const byTicker = new Map(series.map((item) => [item.ticker, item]));
  return symbols.map((symbol) => byTicker.get(symbol) ?? { ticker: symbol, points: [] });
}

async function fetchHistoryFromProvider(env: Env, symbol: string, range: string, params = new URLSearchParams()): Promise<HistorySeries> {
  if (marketDataProviderFromEnv(env) === 'schwab') {
    const historyParams = new URLSearchParams(params);
    if (!historyParams.has('range')) historyParams.set('range', range);
    try {
      const series = withHistoryProviderMetadata(
        await new SchwabMarketDataClient(env).getPriceHistory(symbol, historyParams),
        'schwab',
        false,
        'schwab',
      );
      if (series.points.length > 0) return series;
      console.warn(`[history] Schwab returned no points for ${normalizeSymbol(symbol)}, falling back to Yahoo`);
    } catch (err) {
      console.warn(
        `[history] Schwab price history failed for ${normalizeSymbol(symbol)}, falling back to Yahoo:`,
        sanitizeForLog(err instanceof Error ? err.message : String(err)),
      );
    }
    return fetchYahooHistory(symbol, range, params, true);
  }
  return fetchYahooHistory(symbol, range, params);
}

async function fetchYahooHistory(symbol: string, range: string, params = new URLSearchParams(), fallback = false): Promise<HistorySeries> {
  const startDate = normalizeIsoDate(params.get('startDate'));
  const endDate = normalizeIsoDate(params.get('endDate'));
  const upstreamParams = new URLSearchParams({
    interval: '1d',
    includePrePost: 'false',
    events: 'div,split',
  });
  if (startDate) {
    upstreamParams.set('period1', String(utcSecondsForDate(startDate)));
    upstreamParams.set('period2', String(utcSecondsForDate(addDays(endDate ?? isoDateInNewYork(new Date()), 1))));
  } else {
    upstreamParams.set('range', range);
  }
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${upstreamParams.toString()}`;
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
    const asOfTimestamp = new Date(ts * 1000).toISOString();
    const date = isoDateInNewYork(new Date(ts * 1000));
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    points.push({
      date,
      close: c,
      adjustedClose: typeof adjusted === 'number' && Number.isFinite(adjusted) ? adjusted : c,
      asOfTimestamp,
    });
  }
  return withHistoryProviderMetadata({ ticker: symbol, points }, 'yahoo', fallback, 'yahoo-v8');
}

function withHistoryProviderMetadata(
  series: HistorySeries,
  source: NonNullable<HistorySeries['source']>,
  fallback: boolean,
  providerLabel: string,
): HistorySeries {
  return {
    ...series,
    source,
    fallback,
    providerLabel,
  };
}

export function historyCacheKey(
  provider: ReturnType<typeof marketDataProviderFromEnv>,
  symbols: string[],
  range: string,
  startDates = new Map<string, string>(),
  endDates = new Map<string, string>(),
  defaultStartDate: string | null = null,
  defaultEndDate: string | null = null,
): string {
  const bounds = symbols.map((s) => `${s}:${startDates.get(s) ?? defaultStartDate ?? ''}:${endDates.get(s) ?? defaultEndDate ?? ''}`).join('|');
  return `history:${provider}:${symbols.join(',')}:${range}:${bounds}`;
}

export function dailyPriceSourceFromEnv(env: Env): ReturnType<typeof marketDataProviderFromEnv> {
  return marketDataProviderFromEnv(env);
}

export function historySourceForDailyPrices(env: Env, series: Pick<HistorySeries, 'source'>): ReturnType<typeof marketDataProviderFromEnv> {
  return series.source ?? dailyPriceSourceFromEnv(env);
}

export async function upsertDailyPrices(
  env: Env,
  ticker: string,
  points: HistoryPoint[],
  source: ReturnType<typeof marketDataProviderFromEnv> = dailyPriceSourceFromEnv(env),
): Promise<void> {
  if (points.length === 0) return;
  const rows = points.map((p) => ({
    ticker,
    trade_date: p.date,
    close: p.close,
    adjusted_close: p.adjustedClose ?? p.close,
    source,
    as_of_timestamp: p.asOfTimestamp ?? new Date().toISOString(),
    is_provisional: false,
    updated_at: new Date().toISOString(),
  }));
  await upsertDailyPriceRows(env, rows);
  await updateTrackedSymbolBackfill(env, ticker, 'ok', null, firstPointDate(points));
}

async function upsertDailyPriceSeriesBulk(env: Env, series: HistorySeries[]): Promise<void> {
  const updatedAt = new Date().toISOString();
  const rows = series.flatMap((item) => item.points.map((p) => ({
    ticker: item.ticker,
    trade_date: p.date,
    close: p.close,
    adjusted_close: p.adjustedClose ?? p.close,
    source: historySourceForDailyPrices(env, item),
    as_of_timestamp: p.asOfTimestamp ?? updatedAt,
    is_provisional: false,
    updated_at: updatedAt,
  })));
  await upsertDailyPriceRows(env, rows);
}

async function upsertHistorySnapshotsWhenClosed(env: Env, series: HistorySeries[], now = new Date()): Promise<void> {
  if (isUsMarketDataActive(now)) return;
  const snapshots = series.flatMap((item) => historySeriesToSnapshot(item, env, now));
  if (snapshots.length === 0) return;
  await upsertSnapshots(env, snapshots);
}

function historySeriesToSnapshot(series: HistorySeries, env: Env, now = new Date()): QuoteOut[] {
  const ordered = [...series.points]
    .filter((point) => point.close != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = ordered.at(-1);
  if (!latest) return [];
  const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
  const price = latest.adjustedClose ?? latest.close;
  const prevClose = previous ? previous.adjustedClose ?? previous.close : null;
  const change = prevClose != null ? price - prevClose : null;
  const changePct = ratio(change, prevClose);
  const fetchedAt = now.toISOString();
  return [{
    ticker: normalizeSymbol(series.ticker),
    price,
    displayPrice: price,
    prevClose,
    change,
    changePct,
    regularPrice: price,
    preMarketPrice: null,
    preMarketChange: null,
    preMarketChangePct: null,
    postMarketPrice: null,
    postMarketChange: null,
    postMarketChangePct: null,
    session: 'closed',
    sessionLabel: '收盘',
    isExtended: false,
    marketState: 'CLOSED',
    source: historySourceForDailyPrices(env, series),
    asOf: latest.asOfTimestamp ?? new Date(`${latest.date}T21:00:00.000Z`).toISOString(),
    fetchedAt,
    fallback: series.fallback,
    providerLabel: series.providerLabel,
    cachedAt: fetchedAt,
  }];
}

export function provisionalDailyPriceRows(
  tradingDate: string,
  quotes: QuoteOut[],
  updatedAt = new Date().toISOString(),
) {
  return quotes.flatMap((q) => {
    if (q.price === null || !isQuoteEligibleForProvisionalClose(q.asOf, tradingDate)) return [];
    return [{
      ticker: q.ticker,
      trade_date: tradingDate,
      close: q.price,
      adjusted_close: null,
      source: `${q.source}-quote-provisional`,
      as_of_timestamp: q.asOf,
      is_provisional: true,
      updated_at: updatedAt,
    }];
  });
}

export async function upsertProvisionalDailyPrices(env: Env, tradingDate: string, quotes: QuoteOut[]): Promise<void> {
  const rows = provisionalDailyPriceRows(tradingDate, quotes);
  if (rows.length === 0) {
    console.warn(`[cron] no close-eligible provisional quotes for ${tradingDate}`);
    return;
  }
  await upsertDailyPriceRows(env, rows);
  console.log(`[cron] upserted ${rows.length} provisional close rows for ${tradingDate}`);
}

async function upsertDailyPriceRows(env: Env, rows: Array<Record<string, unknown>>): Promise<void> {
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

function supabaseHeaders(env: Env): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
  };
}

async function registerTrackedSymbols(env: Env, symbols: string[], source: string): Promise<void> {
  const rows = parseSymbolsParam(symbols.join(','), 1000).map((symbol) => ({ symbol, source }));
  if (rows.length === 0) return;
  const r = await fetch(`${env.SUPABASE_URL!}/rest/v1/tracked_symbols?on_conflict=symbol`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(env),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`tracked_symbols upsert ${r.status}: ${await r.text()}`);
}

async function updateTrackedSymbolFromSeries(env: Env, series: HistorySeries): Promise<void> {
  await updateTrackedSymbolBackfill(
    env,
    series.ticker,
    series.points.length > 0 ? 'ok' : 'missing',
    null,
    firstPointDate(series.points),
  );
}

async function updateTrackedSymbolBackfill(
  env: Env,
  symbol: string,
  status: 'pending' | 'ok' | 'missing' | 'unsupported' | 'failed',
  error: string | null = null,
  firstTradeDate: string | null = null,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const payload: Record<string, unknown> = {
    backfill_status: status,
    backfill_error: error,
    last_backfill_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (firstTradeDate) {
    const register = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/add_tracked_symbol`, {
      method: 'POST',
      headers: supabaseHeaders(env),
      body: JSON.stringify({
        p_symbol: normalizeSymbol(symbol),
        p_source: 'history',
        p_first_trade_date: firstTradeDate,
      }),
    });
    if (!register.ok) throw new Error(`add_tracked_symbol rpc ${register.status}: ${await register.text()}`);
  }
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/tracked_symbols?symbol=eq.${encodeURIComponent(normalizeSymbol(symbol))}`, {
    method: 'PATCH',
    headers: {
      ...supabaseHeaders(env),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`tracked_symbols patch ${r.status}: ${await r.text()}`);
}

function firstPointDate(points: HistoryPoint[]): string | null {
  return points.reduce<string | null>((first, point) => !first || point.date < first ? point.date : first, null);
}

function clampInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(Math.floor(parsed), max));
}

function parseSymbolDateMap(raw: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of (raw ?? '').split(',')) {
    const [symbol, date] = item.split(':');
    const normalized = normalizeSymbol(symbol ?? '');
    const iso = normalizeIsoDate(date ?? '');
    if (normalized && iso) out.set(normalized, iso);
  }
  return out;
}

function historyParamsForSymbol(
  base: URLSearchParams,
  symbol: string,
  startDates: Map<string, string>,
  endDates: Map<string, string>,
  defaultStartDate: string | null,
  defaultEndDate: string | null,
): URLSearchParams {
  const params = new URLSearchParams(base);
  const startDate = startDates.get(symbol) ?? defaultStartDate;
  const endDate = endDates.get(symbol) ?? defaultEndDate;
  if (startDate) {
    params.set('startDate', startDate);
    params.set('startDateIso', startDate);
    params.set('startDateMillis', String(utcMillisForDate(startDate)));
  }
  if (endDate) {
    params.set('endDate', endDate);
    params.set('endDateIso', endDate);
    params.set('endDateMillis', String(utcMillisForDate(addDays(endDate, 1))));
  }
  return params;
}

function normalizeIsoDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function startDateForRange(range: string, endDate: string): string {
  const normalized = range.trim().toLowerCase();
  if (normalized === 'ytd') return `${endDate.slice(0, 4)}-01-01`;
  if (normalized === 'max' || normalized === 'all') return '1970-01-01';
  const match = normalized.match(/^(\d+)(d|mo|m|y)$/);
  if (!match) return addYears(endDate, -10);
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return addYears(endDate, -10);
  if (unit === 'd') return addDays(endDate, -amount);
  if (unit === 'mo' || unit === 'm') return addMonths(endDate, -amount);
  return addYears(endDate, -amount);
}

function utcMillisForDate(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcSecondsForDate(iso: string): number {
  return Math.floor(utcMillisForDate(iso) / 1000);
}

function addDays(iso: string, days: number): string {
  return new Date(utcMillisForDate(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + months, day));
  return d.toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year + years, month - 1, day));
  return d.toISOString().slice(0, 10);
}

function encodePostgrestInValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function errorMessage(error: unknown): string {
  return String(sanitizeForLog(error instanceof Error ? error.message : String(error))).slice(0, 500);
}

function backfillFailureStatus(error: unknown): 'unsupported' | 'failed' {
  return /unsupported|not supported|not found|404/i.test(errorMessage(error)) ? 'unsupported' : 'failed';
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

async function fetchV7Quotes(symbols: string[], fallback = false): Promise<QuoteOut[]> {
  const upstream = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  const r = await fetch(upstream, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`v7 ${r.status}`);
  const data = (await r.json()) as YahooV7Quote;
  return (data.quoteResponse?.result ?? []).map((row) => {
    const fetchedAt = new Date().toISOString();
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
      ticker: normalizeSymbol(row.symbol ?? ''),
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
      source: 'yahoo' as const,
      currency: row.currency,
      asOf: epochSecondsToIso(row.regularMarketTime),
      fetchedAt,
      fallback,
      providerLabel: 'yahoo-v7',
      cachedAt: fetchedAt,
    };
  });
}

async function fetchV8Quote(symbol: string, fallback = false): Promise<QuoteOut | null> {
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`;
  const r = await fetch(upstream, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const data = (await r.json()) as YahooV8Chart;
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const fetchedAt = new Date().toISOString();
  const price = meta.regularMarketPrice ?? null;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const session = sessionFromMarketState(meta.marketState ?? null);
  const change = price !== null && prev !== null ? price - prev : null;
  const changePct = price !== null && prev !== null && prev !== 0 ? (price - prev) / prev : null;
  return {
    ticker: normalizeSymbol(symbol),
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
    source: 'yahoo',
    currency: meta.currency,
    asOf: epochSecondsToIso(meta.regularMarketTime),
    fetchedAt,
    fallback,
    providerLabel: 'yahoo-v8',
    cachedAt: fetchedAt,
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

function epochSecondsToIso(v: unknown): string | undefined {
  const n = numOrNull(v);
  if (n === null || n <= 0) return undefined;
  return new Date(n * 1000).toISOString();
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
      regularMarketTime?: number;
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
      currency?: string;
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
        regularMarketTime?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        marketState?: string;
        currency?: string;
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
