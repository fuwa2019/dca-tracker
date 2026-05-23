export interface Quote {
  ticker: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  marketState: string | null;
  source: string;
  cachedAt: string;
}

export interface HistorySeries {
  ticker: string;
  points: Array<{ date: string; close: number; adjustedClose?: number }>;
}

const WORKER_BASE = import.meta.env.VITE_QUOTE_WORKER_URL?.replace(/\/$/, '') ?? '';

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
  if (symbols.length === 0) return [];
  const url = `${WORKER_BASE}/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`quote http ${r.status}`);
    const data = (await r.json()) as { quotes: Quote[] };
    const result = data.quotes ?? [];
    if (import.meta.env.DEV && result.length === 0) console.warn('[quote] Worker returned 0 quotes — Yahoo upstream may be failing');
    return result;
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[quote] fetch failed:', err);
    throw err;
  }
}

export async function fetchChart(symbol: string, range = '1y', interval = '1d') {
  if (!WORKER_BASE) return null;
  const url = `${WORKER_BASE}/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`chart http ${r.status}`);
  return r.json();
}

export async function fetchHistory(symbols: string[], range = '10y'): Promise<HistorySeries[]> {
  if (!WORKER_BASE) return [];
  if (symbols.length === 0) return [];
  const url = `${WORKER_BASE}/api/history?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`history http ${r.status}`);
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
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isWeekday = !isWeekend;
  const isSundayNight = weekday === 'Sun' && minutes >= 20 * 60;
  const isOvernightMorning = isWeekday && minutes < 4 * 60;
  const isWeeknight = isWeekday && weekday !== 'Fri' && minutes >= 20 * 60;

  if (isWeekend && !isSundayNight) {
    return { key: 'closed', label: '休市', detail: '周末休市', isTrading: false, isRegular: false };
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
