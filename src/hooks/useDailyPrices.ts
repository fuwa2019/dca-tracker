import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const WORKER_BASE = import.meta.env.VITE_QUOTE_WORKER_URL?.replace(/\/$/, '') ?? '';

export type PriceMap = Map<string, Map<string, number>>; // ticker → date → close

interface DailyPriceRow {
  ticker: string;
  trade_date: string;
  close: number;
}

async function readFromSupabase(symbols: string[], earliestDate: string): Promise<PriceMap> {
  const { data, error } = await supabase
    .from('daily_prices')
    .select('ticker,trade_date,close')
    .in('ticker', symbols)
    .gte('trade_date', earliestDate)
    .order('trade_date', { ascending: true });
  if (error) throw error;
  const map: PriceMap = new Map();
  for (const row of (data as DailyPriceRow[]) ?? []) {
    let m = map.get(row.ticker);
    if (!m) {
      m = new Map();
      map.set(row.ticker, m);
    }
    m.set(row.trade_date, Number(row.close));
  }
  return map;
}

/** Returns true if every symbol has at least one row at-or-before earliestDate
 *  (we don't require strict equality since the earliest day may be a non-trading day). */
function coverageOk(map: PriceMap, symbols: string[], earliestDate: string): boolean {
  for (const s of symbols) {
    const m = map.get(s);
    if (!m || m.size === 0) return false;
    // The earliest stored date for this ticker must be ≤ earliestDate + some leeway (7 days
    // for weekends/holidays at the edge).
    const firstDate = [...m.keys()][0];
    if (firstDate > addDays(earliestDate, 7)) return false;
  }
  return true;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Pick a Yahoo `range` slug that covers earliestDate → today with some margin. */
function pickRange(earliestDate: string): string {
  const earliest = new Date(earliestDate + 'T00:00:00Z').getTime();
  const now = Date.now();
  const days = (now - earliest) / 86_400_000;
  if (days <= 30) return '3mo';
  if (days <= 90) return '6mo';
  if (days <= 200) return '1y';
  if (days <= 500) return '2y';
  if (days <= 1500) return '5y';
  return '10y';
}

async function backfillViaWorker(symbols: string[], earliestDate: string): Promise<void> {
  if (!WORKER_BASE) return;
  const range = pickRange(earliestDate);
  const url = `${WORKER_BASE}/api/history?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`worker /api/history ${r.status}`);
  // Response body discarded — worker's ctx.waitUntil writes to Supabase asynchronously,
  // so we don't get the data here; we just re-query Supabase next.
  await r.json().catch(() => null);
  // Give the waitUntil a moment to land before re-querying.
  await new Promise((resolve) => setTimeout(resolve, 800));
}

/**
 * Returns daily close prices for the requested symbols starting from earliestDate.
 * Reads from Supabase first; if any symbol's coverage falls short, triggers a
 * one-shot backfill via the quote worker, then re-reads.
 */
export function useDailyPrices(symbols: string[], earliestDate: string | null) {
  const uniqSorted = [...new Set(symbols.map((s) => s.toUpperCase()))].sort();
  const enabled = uniqSorted.length > 0 && !!earliestDate;
  return useQuery<PriceMap>({
    queryKey: ['daily_prices', uniqSorted.join(','), earliestDate],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const ed = earliestDate as string;
      let map = await readFromSupabase(uniqSorted, ed);
      if (!coverageOk(map, uniqSorted, ed)) {
        await backfillViaWorker(uniqSorted, ed);
        map = await readFromSupabase(uniqSorted, ed);
      }
      return map;
    },
  });
}
