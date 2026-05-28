import { isoDateInNewYork, isNyseHoliday } from '@/lib/nyse-calendar';
import {
  apiLimitConfigFromEnv,
  rateLimited,
  splitIntoBatches,
  type ApiEndpoint,
} from '@/lib/apiRateLimit';

export interface Quote {
  ticker: string;
  price: number | null;
  displayPrice?: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  regularPrice?: number | null;
  preMarketPrice?: number | null;
  preMarketChange?: number | null;
  preMarketChangePct?: number | null;
  postMarketPrice?: number | null;
  postMarketChange?: number | null;
  postMarketChangePct?: number | null;
  session?: UsMarketSessionKey | 'unknown';
  sessionLabel?: string;
  isExtended?: boolean;
  marketState: string | null;
  source: string;
  cachedAt: string;
}

export interface HistorySeries {
  ticker: string;
  points: Array<{ date: string; close: number; adjustedClose?: number }>;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange?: string | null;
  type?: string | null;
}

const WORKER_BASE = import.meta.env.VITE_QUOTE_WORKER_URL?.replace(/\/$/, '') ?? '';
const API_LIMIT_CONFIG = apiLimitConfigFromEnv(import.meta.env);
const quoteInflight = new Map<string, Promise<Quote[]>>();

export type UsMarketSessionKey = 'pre_market' | 'regular' | 'after_hours' | 'overnight' | 'closed';

export interface UsMarketSession {
  key: UsMarketSessionKey;
  label: string;
  detail: string;
  isTrading: boolean;
  isRegular: boolean;
}

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  if (!WORKER_BASE) {
    if (import.meta.env.DEV) console.warn('[quote] VITE_QUOTE_WORKER_URL missing — quotes unavailable');
    return [];
  }
  const normalized = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  if (normalized.length === 0) return [];
  const key = normalized.join(',');
  const existing = quoteInflight.get(key);
  if (existing) return existing;

  const request = fetchQuoteBatches(normalized).finally(() => quoteInflight.delete(key));
  quoteInflight.set(key, request);
  return request;
}

async function fetchQuoteBatches(symbols: string[]): Promise<Quote[]> {
  const batches = splitIntoBatches(symbols, API_LIMIT_CONFIG.maxSymbolsPerQuoteRequest);
  const results: Quote[] = [];
  for (const batch of batches) {
    results.push(...await limitedFetchJson<{ quotes: Quote[] }>('quote', quoteUrl(batch)).then((data) => data.quotes ?? []));
  }
  return results;
}

function quoteUrl(symbols: string[]) {
  return `${WORKER_BASE}/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
}

async function limitedFetchJson<T>(endpoint: ApiEndpoint, url: string): Promise<T> {
  try {
    const r = await rateLimited(endpoint, () => fetch(url), API_LIMIT_CONFIG);
    if (!r.ok) throw new Error(`${endpoint} http ${r.status}`);
    return (await r.json()) as T;
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[quote] fetch failed:', err);
    throw err;
  }
}

export async function fetchCurrentExchangeRate(): Promise<number | null> {
  const [quote] = await fetchQuotes(['USDCNY=X']);
  return quote?.price ?? quote?.displayPrice ?? quote?.regularPrice ?? null;
}

export async function fetchChart(symbol: string, range = '1y', interval = '1d') {
  if (!WORKER_BASE) return null;
  const includePrePost = range === '1d' || interval.endsWith('m');
  const url = `${WORKER_BASE}/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}&prepost=${includePrePost ? '1' : '0'}`;
  const r = await rateLimited('chart', () => fetch(url), API_LIMIT_CONFIG);
  if (!r.ok) throw new Error(`chart http ${r.status}`);
  return r.json();
}

export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  if (!WORKER_BASE) return [];
  const q = query.trim();
  if (q.length < 1) return [];
  const r = await rateLimited('search', () => fetch(`${WORKER_BASE}/api/search?q=${encodeURIComponent(q)}`), API_LIMIT_CONFIG);
  if (!r.ok) throw new Error(`search http ${r.status}`);
  const data = (await r.json()) as { results?: SymbolSearchResult[] };
  return data.results ?? [];
}

export async function fetchHistory(
  symbols: string[],
  range = '10y',
  options?: { persist?: 'sync' },
): Promise<HistorySeries[]> {
  if (!WORKER_BASE) return [];
  if (symbols.length === 0) return [];
  const params = new URLSearchParams({ symbols: symbols.join(','), range });
  if (options?.persist === 'sync') params.set('persist', 'sync');
  const url = `${WORKER_BASE}/api/history?${params.toString()}`;
  const r = await rateLimited('history', () => fetch(url), API_LIMIT_CONFIG);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const msg = (body as { message?: string }).message ?? `http ${r.status}`;
    throw new Error(msg);
  }
  const data = (await r.json()) as { series?: HistorySeries[] };
  return data.series ?? [];
}

function getEtClockParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const rawHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const hour = rawHour === 24 ? 0 : rawHour;
  return { weekday, minutes: hour * 60 + m };
}

/** US stock-session heuristic in New York time. It includes common extended-hours windows. */
export function getUsMarketSession(now = new Date()): UsMarketSession {
  const { weekday, minutes } = getEtClockParts(now);
  const etDate = isoDateInNewYork(now);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isHoliday = isNyseHoliday(etDate);
  const isWeekday = !isWeekend;
  const isSundayNight = weekday === 'Sun' && minutes >= 20 * 60;
  const isOvernightMorning = isWeekday && !isHoliday && minutes < 4 * 60;
  const isWeeknight = isWeekday && !isHoliday && weekday !== 'Fri' && minutes >= 20 * 60;

  if (isWeekend && !isSundayNight) {
    return { key: 'closed', label: '休市', detail: '周末休市', isTrading: false, isRegular: false };
  }
  if (isHoliday) {
    return { key: 'closed', label: '休市', detail: 'NYSE 节假日休市', isTrading: false, isRegular: false };
  }
  if (isSundayNight || isOvernightMorning || isWeeknight) {
    return { key: 'overnight', label: '夜盘', detail: '20:00-04:00 ET', isTrading: true, isRegular: false };
  }
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
    return { key: 'pre_market', label: '早盘', detail: '04:00-09:30 ET', isTrading: true, isRegular: false };
  }
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return { key: 'regular', label: '盘中', detail: '09:30-16:00 ET', isTrading: true, isRegular: true };
  }
  if (minutes >= 16 * 60 && minutes < 20 * 60) {
    return { key: 'after_hours', label: '盘后', detail: '16:00-20:00 ET', isTrading: true, isRegular: false };
  }
  return { key: 'closed', label: '休市', detail: '非交易时段', isTrading: false, isRegular: false };
}

/** Heuristic: is the US market currently open (regular hours)? Uses ET (NYC) wall-clock. */
export function isUsMarketOpen(now = new Date()): boolean {
  return getUsMarketSession(now).isRegular;
}

export function isUsMarketDataActive(now = new Date()): boolean {
  return getUsMarketSession(now).isTrading;
}
