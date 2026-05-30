import { isoDateInNewYork } from './nyseCalendar.js';

export type MarketDataProviderName = 'yahoo' | 'schwab';

export interface SchwabQuote {
  symbol?: string;
  quote?: {
    lastPrice?: number;
    mark?: number;
    closePrice?: number;
    netChange?: number;
    netPercentChange?: number;
    quoteTime?: number;
    realtime?: boolean;
    delayed?: boolean;
    delayMinutes?: number;
    securityStatus?: string;
  };
  quoteTime?: number;
  realtime?: boolean;
  delayed?: boolean;
  delayMinutes?: number;
  regular?: {
    regularMarketLastPrice?: number;
    regularMarketLastSize?: number;
    regularMarketNetChange?: number;
    regularMarketPercentChange?: number;
  };
  reference?: {
    symbol?: string;
    description?: string;
    exchange?: string;
    assetType?: string;
  };
}

export interface SchwabPriceHistoryResponse {
  symbol?: string;
  empty?: boolean;
  candles?: Array<{
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
    datetime?: number;
  }>;
}

export type QuoteSource = 'schwab' | 'yahoo';

export interface NormalizedQuote {
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
  source: QuoteSource;
  currency?: string;
  asOf?: string;
  fetchedAt: string;
  realtime?: boolean;
  delayMinutes?: number;
  fallback?: boolean;
  providerLabel?: string;
  cachedAt: string;
}

export interface HistoryPoint {
  date: string;
  close: number;
  adjustedClose?: number;
  asOfTimestamp?: string;
}

export interface HistorySeries {
  ticker: string;
  points: HistoryPoint[];
}

export interface MarketDataProvider {
  name: MarketDataProviderName;
  getQuotes(symbols: string[]): Promise<NormalizedQuote[]>;
  getPriceHistory(symbol: string, params?: URLSearchParams): Promise<HistorySeries>;
}

export interface SchwabEnv {
  SCHWAB_CLIENT_ID?: string;
  SCHWAB_CLIENT_SECRET?: string;
  SCHWAB_REDIRECT_URI?: string;
  SCHWAB_REFRESH_TOKEN?: string;
  MARKET_DATA_PROVIDER?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface TokenState {
  accessToken: string | null;
  expiresAt: number;
}

const SCHWAB_BASE = 'https://api.schwabapi.com';
const SCHWAB_AUTH_URL = `${SCHWAB_BASE}/v1/oauth/authorize`;
const SCHWAB_TOKEN_URL = `${SCHWAB_BASE}/v1/oauth/token`;
const SCHWAB_MARKET_PREFIX = `${SCHWAB_BASE}/marketdata/v1/`;
const SCHWAB_MIN_REQUEST_INTERVAL_MS = 500; // 120 requests/minute hard cap.

const BLOCKED_ENDPOINT_PATTERN = /(?:^|\/)(?:trader|accounts?|orders?|positions?|transactions?)(?:\/|$)/i;
let schwabTokenState: TokenState = { accessToken: null, expiresAt: 0 };
let lastSchwabRequestAt = 0;

export function marketDataProviderFromEnv(env: SchwabEnv): MarketDataProviderName {
  return env.MARKET_DATA_PROVIDER?.trim().toLowerCase() === 'schwab' ? 'schwab' : 'yahoo';
}

export function parseSymbolsParam(raw: string | null, max = 20): string[] {
  return [...new Set((raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean))]
    .slice(0, max);
}

export function buildSchwabAuthorizeUrl(env: SchwabEnv, state?: string): string {
  assertSchwabOAuthConfig(env);
  const params = new URLSearchParams({
    client_id: env.SCHWAB_CLIENT_ID!,
    redirect_uri: env.SCHWAB_REDIRECT_URI!,
    response_type: 'code',
  });
  if (state) params.set('state', state);
  return `${SCHWAB_AUTH_URL}?${params.toString()}`;
}

export async function exchangeSchwabAuthorizationCode(
  env: SchwabEnv,
  code: string,
  fetcher: typeof fetch = boundFetch,
): Promise<TokenResponse> {
  assertSchwabOAuthConfig(env);
  if (!code.trim()) throw new Error('missing_schwab_authorization_code');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.SCHWAB_REDIRECT_URI!,
  });
  const data = await requestSchwabToken(env, body, fetcher);
  rememberAccessToken(data);
  return data;
}

export async function refreshSchwabAccessToken(
  env: SchwabEnv,
  fetcher: typeof fetch = boundFetch,
): Promise<TokenResponse> {
  assertSchwabOAuthConfig(env);
  const refreshToken = env.SCHWAB_REFRESH_TOKEN?.trim();
  if (!refreshToken) {
    throw new Error('schwab_refresh_token_missing: set SCHWAB_REFRESH_TOKEN or complete OAuth authorization again');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const data = await requestSchwabToken(env, body, fetcher);
  rememberAccessToken(data);
  return data;
}

export function resetSchwabClientForTests() {
  schwabTokenState = { accessToken: null, expiresAt: 0 };
  lastSchwabRequestAt = 0;
}

export function sanitizeForLog(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/(client_secret=)[^&\s]+/gi, '$1[redacted]')
      .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
      .replace(/(refresh_token=)[^&\s]+/gi, '$1[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  }
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (/secret|token/i.test(key)) out[key] = '[redacted]';
    else out[key] = sanitizeForLog(val);
  }
  return out;
}

export function assertSchwabMarketDataUrl(input: string | URL): URL {
  const safeInput = typeof input === 'string' && input.startsWith('/')
    ? input.slice(1)
    : input;
  const url = typeof safeInput === 'string' ? new URL(safeInput, SCHWAB_MARKET_PREFIX) : safeInput;
  if (url.origin !== SCHWAB_BASE || !url.pathname.startsWith('/marketdata/v1/')) {
    throw new Error('blocked_schwab_endpoint: only /marketdata/v1/ endpoints are allowed');
  }
  if (BLOCKED_ENDPOINT_PATTERN.test(url.pathname)) {
    throw new Error('blocked_schwab_endpoint: account, order, position, and transaction endpoints are not allowed');
  }
  return url;
}

export class SchwabMarketDataClient implements MarketDataProvider {
  readonly name = 'schwab' as const;

  constructor(
    private readonly env: SchwabEnv,
    private readonly fetcher: typeof fetch = boundFetch,
    private readonly sleeper: (ms: number) => Promise<void> = sleep,
  ) {}

  async getQuotes(symbols: string[]): Promise<NormalizedQuote[]> {
    const normalized = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (normalized.length === 0) return [];
    const params = new URLSearchParams({ symbols: normalized.join(',') });
    const data = await this.requestMarketData<Record<string, SchwabQuote>>(`/quotes?${params.toString()}`);
    const quotes = Object.entries(data ?? {}).map(([symbol, row]) => normalizeSchwabQuote(symbol, row));
    quotes.sort((a, b) => normalized.indexOf(a.ticker) - normalized.indexOf(b.ticker));
    return quotes;
  }

  async getPriceHistory(symbol: string, params = new URLSearchParams()): Promise<HistorySeries> {
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) throw new Error('missing_symbol');
    const upstreamParams = schwabHistoryParams(ticker, params);
    const data = await this.requestMarketData<SchwabPriceHistoryResponse>(`/pricehistory?${upstreamParams.toString()}`);
    return schwabHistoryToSeries(ticker, data);
  }

  async requestMarketData<T>(path: string): Promise<T> {
    const url = assertSchwabMarketDataUrl(path);
    return this.requestWithAuth<T>(url, true);
  }

  private async requestWithAuth<T>(url: URL, allowRefreshRetry: boolean): Promise<T> {
    await throttleSchwabRequests(this.sleeper);
    const token = await this.getAccessToken();
    const response = await this.fetcher(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 && allowRefreshRetry) {
      await refreshSchwabAccessToken(this.env, this.fetcher);
      return this.requestWithAuth<T>(url, false);
    }
    if (response.status === 429) {
      await backoffOnce(response, this.sleeper);
      const retry = await this.fetcher(url.toString(), {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${await this.getAccessToken()}`,
        },
      });
      if (!retry.ok) throw await schwabHttpError(retry);
      return (await retry.json()) as T;
    }
    if (!response.ok) throw await schwabHttpError(response);
    return (await response.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    if (schwabTokenState.accessToken && Date.now() < schwabTokenState.expiresAt - 60_000) {
      return schwabTokenState.accessToken;
    }
    const refreshed = await refreshSchwabAccessToken(this.env, this.fetcher);
    return refreshed.access_token;
  }
}

export function normalizeSchwabQuote(symbol: string, row: SchwabQuote): NormalizedQuote {
  const ticker = (row.reference?.symbol ?? row.symbol ?? symbol).trim().toUpperCase();
  const price = numOrNull(row.quote?.lastPrice) ?? numOrNull(row.quote?.mark) ?? numOrNull(row.regular?.regularMarketLastPrice);
  const prevClose = numOrNull(row.quote?.closePrice);
  const change = numOrNull(row.quote?.netChange) ?? numOrNull(row.regular?.regularMarketNetChange) ?? diff(price, prevClose);
  const changePct = percentToRatio(row.quote?.netPercentChange ?? row.regular?.regularMarketPercentChange) ?? ratio(change, prevClose);
  const fetchedAt = new Date().toISOString();
  const realtime = boolOrUndefined(row.quote?.realtime ?? row.realtime);
  const delayed = boolOrUndefined(row.quote?.delayed ?? row.delayed);
  return {
    ticker,
    price,
    displayPrice: price,
    prevClose,
    change,
    changePct,
    regularPrice: numOrNull(row.regular?.regularMarketLastPrice) ?? price,
    preMarketPrice: null,
    preMarketChange: null,
    preMarketChangePct: null,
    postMarketPrice: null,
    postMarketChange: null,
    postMarketChangePct: null,
    session: 'unknown',
    sessionLabel: '行情',
    isExtended: false,
    marketState: row.quote?.securityStatus ?? null,
    source: 'schwab',
    asOf: epochMillisToIso(row.quote?.quoteTime ?? row.quoteTime),
    fetchedAt,
    realtime: realtime ?? (delayed === true ? false : undefined),
    delayMinutes: numOrUndefined(row.quote?.delayMinutes ?? row.delayMinutes),
    providerLabel: 'schwab',
    cachedAt: fetchedAt,
  };
}

export function schwabHistoryParams(symbol: string, params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams({ symbol });
  const passthrough = ['periodType', 'period', 'frequencyType', 'frequency', 'startDate', 'endDate', 'needExtendedHoursData', 'needPreviousClose'];
  for (const key of passthrough) {
    const value = params.get(key);
    if (value) out.set(key, value);
  }
  if (!out.has('periodType')) out.set('periodType', 'year');
  if (!out.has('period')) out.set('period', rangeToSchwabPeriod(params.get('range') ?? '10y'));
  if (!out.has('frequencyType')) out.set('frequencyType', 'daily');
  if (!out.has('frequency')) out.set('frequency', '1');
  if (!out.has('needExtendedHoursData')) out.set('needExtendedHoursData', 'false');
  return out;
}

export function schwabHistoryToSeries(symbol: string, data: SchwabPriceHistoryResponse): HistorySeries {
  const points = (data.candles ?? []).flatMap((candle) => {
    const close = numOrNull(candle.close);
    const datetime = numOrNull(candle.datetime);
    if (close === null || datetime === null) return [];
    const asOfTimestamp = new Date(datetime).toISOString();
    return [{
      date: isoDateInNewYork(new Date(datetime)),
      close,
      adjustedClose: close,
      asOfTimestamp,
    }];
  });
  return { ticker: (data.symbol ?? symbol).trim().toUpperCase(), points };
}

async function requestSchwabToken(
  env: SchwabEnv,
  body: URLSearchParams,
  fetcher: typeof fetch,
): Promise<TokenResponse> {
  const credentials = btoa(`${env.SCHWAB_CLIENT_ID!}:${env.SCHWAB_CLIENT_SECRET!}`);
  const response = await fetcher(SCHWAB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`schwab_token_error ${response.status}: ${sanitizeForLog(message)}`);
  }
  return (await response.json()) as TokenResponse;
}

function assertSchwabOAuthConfig(env: SchwabEnv) {
  if (!env.SCHWAB_CLIENT_ID?.trim()) throw new Error('SCHWAB_CLIENT_ID is required');
  if (!env.SCHWAB_CLIENT_SECRET?.trim()) throw new Error('SCHWAB_CLIENT_SECRET is required');
  if (!env.SCHWAB_REDIRECT_URI?.trim()) throw new Error('SCHWAB_REDIRECT_URI is required');
}

function rememberAccessToken(data: TokenResponse) {
  schwabTokenState = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(0, data.expires_in ?? 1800) * 1000,
  };
}

async function throttleSchwabRequests(sleeper: (ms: number) => Promise<void>) {
  const wait = lastSchwabRequestAt + SCHWAB_MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleeper(wait);
  lastSchwabRequestAt = Date.now();
}

async function backoffOnce(response: Response, sleeper: (ms: number) => Promise<void>) {
  const retryAfter = Number(response.headers.get('Retry-After'));
  const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000;
  await sleeper(Math.min(delay, 10_000));
}

async function schwabHttpError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => '');
  const status = response.status;
  if (status === 400) return new Error(`schwab_bad_request: ${sanitizeForLog(body)}`);
  if (status === 403) return new Error(`schwab_forbidden_market_data_only: ${sanitizeForLog(body)}`);
  if (status === 429) return new Error('schwab_rate_limited: retry later');
  return new Error(`schwab_http_${status}: ${sanitizeForLog(body)}`);
}

function rangeToSchwabPeriod(range: string): string {
  if (range === '3mo' || range === '6mo' || range === '1y') return '1';
  if (range === '2y') return '2';
  if (range === '5y') return '5';
  return '10';
}

function boolOrUndefined(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function numOrUndefined(v: unknown): number | undefined {
  const n = numOrNull(v);
  return n !== null ? n : undefined;
}

function epochMillisToIso(v: unknown): string | undefined {
  const n = numOrNull(v);
  if (n === null || n <= 0) return undefined;
  return new Date(n).toISOString();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function boundFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, init);
}

function diff(a: number | null, b: number | null): number | null {
  return a !== null && b !== null ? a - b : null;
}

function ratio(change: number | null, base: number | null): number | null {
  return change !== null && base !== null && base !== 0 ? change / base : null;
}

function percentToRatio(value: unknown): number | null {
  const n = numOrNull(value);
  return n === null ? null : n / 100;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
