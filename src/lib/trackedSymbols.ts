import { supabase } from '@/lib/supabase';
import { fetchHistory, fetchHistoryPage, type HistoryProgress, type HistorySeries } from '@/lib/quote';
import { normalizeSymbol, normalizeSymbols } from '@/lib/symbols';
import { LOCAL_MODE } from '@/lib/localMode';

export type TrackedSymbolSource = 'dashboard' | 'settings' | 'transaction' | 'manual';

export interface AddTrackedSymbolInput {
  symbol: string;
  name?: string | null;
  assetType?: string | null;
  source: TrackedSymbolSource;
  firstTradeDate?: string | null;
}

export interface BackfillTarget {
  symbol: string;
  requiredStart?: string | null;
  requiredEnd?: string | null;
}

export interface BackfillRunProgress extends HistoryProgress {
  hasMore: boolean;
  nextCursor: string | null;
}

export async function registerTrackedSymbol(input: AddTrackedSymbolInput) {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) throw new Error('symbol must not be empty');
  const { data, error } = await supabase.rpc('add_tracked_symbol', {
    p_symbol: symbol,
    p_name: input.name ?? null,
    p_asset_type: input.assetType ?? null,
    p_source: input.source,
    p_first_trade_date: input.firstTradeDate ?? null,
  });
  if (error) throw error;
  return data;
}

export async function registerTrackedSymbols(symbols: Iterable<string>, source: TrackedSymbolSource) {
  const normalized = normalizeSymbols(symbols);
  if (LOCAL_MODE) return normalized; // offline build never tracks symbols server-side
  await Promise.all(normalized.map((symbol) => registerTrackedSymbol({ symbol, source })));
  return normalized;
}

export async function addTrackedSymbol(input: AddTrackedSymbolInput) {
  const symbol = normalizeSymbol(input.symbol);
  const tracked = await registerTrackedSymbol({ ...input, symbol });
  const series = await fetchHistory([symbol], '1y', {
    persist: 'sync',
    startDate: input.firstTradeDate ?? oneYearAgoIso(),
  });
  return { symbol, tracked, series };
}

export async function backfillTrackedSymbols(
  symbols: Iterable<string>,
  rangeOrOptions: string | {
    defaultStartDate?: string | null;
    requiredEnd?: string | null;
    limit?: number;
    onProgress?: (progress: BackfillRunProgress) => void;
  } = '1y',
) {
  const normalized = normalizeSymbols(symbols);
  if (normalized.length === 0) return [];
  if (typeof rangeOrOptions === 'string') {
    return backfillTrackedTargets(
      normalized.map((symbol) => ({ symbol, requiredStart: oneYearAgoIso() })),
      { range: rangeOrOptions, limit: 10 },
    );
  }
  return backfillTrackedTargets(
    normalized.map((symbol) => ({
      symbol,
      requiredStart: rangeOrOptions.defaultStartDate ?? oneYearAgoIso(),
      requiredEnd: rangeOrOptions.requiredEnd ?? null,
    })),
    {
      range: '1y',
      limit: rangeOrOptions.limit,
      onProgress: rangeOrOptions.onProgress,
    },
  );
}

export async function backfillTrackedTargets(
  targets: BackfillTarget[],
  options: {
    range?: string;
    limit?: number;
    onProgress?: (progress: BackfillRunProgress) => void;
  } = {},
): Promise<HistorySeries[]> {
  const normalized = targets
    .map((target) => ({
      symbol: normalizeSymbol(target.symbol),
      requiredStart: target.requiredStart ?? null,
      requiredEnd: target.requiredEnd ?? null,
    }))
    .filter((target) => target.symbol);
  if (normalized.length === 0) return [];

  const symbols = normalized.map((target) => target.symbol);
  const startDates = Object.fromEntries(normalized.map((target) => [target.symbol, target.requiredStart]));
  const endDates = Object.fromEntries(normalized.map((target) => [target.symbol, target.requiredEnd]));
  const series: HistorySeries[] = [];
  let cursor: string | number | null = loadBackfillCursor(symbols, startDates);
  for (;;) {
    const page = await fetchHistoryPage(symbols, options.range ?? '1y', {
      persist: 'sync',
      startDates,
      endDates,
      cursor,
      limit: options.limit ?? 10,
    });
    series.push(...page.series);
    const progress = {
      ...(page.progress ?? {
        total: symbols.length,
        completed: symbols.length,
        remaining: 0,
        currentTicker: null,
        limit: options.limit ?? 10,
      }),
      hasMore: !!page.hasMore,
      nextCursor: page.nextCursor ?? null,
    };
    options.onProgress?.(progress);
    if (!page.hasMore || !page.nextCursor) {
      clearBackfillCursor(symbols, startDates);
      return series;
    }
    cursor = page.nextCursor;
    saveBackfillCursor(symbols, startDates, cursor);
  }
}

function oneYearAgoIso() {
  return new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
}

function backfillCursorKey(symbols: string[], startDates: Record<string, string | null | undefined>) {
  const fingerprint = symbols.map((symbol) => `${symbol}:${startDates[symbol] ?? ''}`).join('|');
  return `dca:history-backfill-cursor:${fingerprint}`;
}

function loadBackfillCursor(symbols: string[], startDates: Record<string, string | null | undefined>) {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(backfillCursorKey(symbols, startDates));
}

function saveBackfillCursor(symbols: string[], startDates: Record<string, string | null | undefined>, cursor: string | number | null) {
  if (typeof localStorage === 'undefined' || cursor == null) return;
  localStorage.setItem(backfillCursorKey(symbols, startDates), String(cursor));
}

function clearBackfillCursor(symbols: string[], startDates: Record<string, string | null | undefined>) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(backfillCursorKey(symbols, startDates));
}
