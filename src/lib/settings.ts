import type { SettingsRow } from '@/lib/database.types';
import { normalizeSymbol } from '@/lib/symbols';

export const DEFAULT_WATCHLIST = ['VOO', 'QQQM', 'SMH'];
export const DEFAULT_BENCHMARK = 'SPY';
export const DEFAULT_BENCHMARKS = [DEFAULT_BENCHMARK];

export function normalizeTickers(values: Iterable<string>, fallback: string[] = []): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const ticker = normalizeSymbol(raw);
    if (!ticker || out.includes(ticker)) continue;
    out.push(ticker);
  }
  return out.length > 0 ? out : fallback;
}

export function splitTickers(value: string, fallback: string[] = []): string[] {
  return normalizeTickers(value.split(/[\s,，]+/), fallback);
}

export function getBenchmarks(settings: SettingsRow | null | undefined): string[] {
  return normalizeTickers(settings?.benchmarks ?? [], DEFAULT_BENCHMARKS);
}

export function getSelectedBenchmark(settings: SettingsRow | null | undefined): string {
  const benchmarks = getBenchmarks(settings);
  const selected = normalizeSymbol(settings?.selected_benchmark ?? '');
  return selected && benchmarks.includes(selected) ? selected : benchmarks[0] ?? DEFAULT_BENCHMARK;
}

export function getWatchlist(settings: SettingsRow | null | undefined): string[] {
  return normalizeTickers(settings?.watchlist ?? [], DEFAULT_WATCHLIST);
}
