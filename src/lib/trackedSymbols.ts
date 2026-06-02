import { supabase } from '@/lib/supabase';
import { fetchHistory } from '@/lib/quote';
import { normalizeSymbol, normalizeSymbols } from '@/lib/symbols';

export type TrackedSymbolSource = 'dashboard' | 'settings' | 'transaction' | 'manual';

export interface AddTrackedSymbolInput {
  symbol: string;
  name?: string | null;
  assetType?: string | null;
  source: TrackedSymbolSource;
  firstTradeDate?: string | null;
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
  await Promise.all(normalized.map((symbol) => registerTrackedSymbol({ symbol, source })));
  return normalized;
}

export async function addTrackedSymbol(input: AddTrackedSymbolInput) {
  const symbol = normalizeSymbol(input.symbol);
  const tracked = await registerTrackedSymbol({ ...input, symbol });
  const series = await fetchHistory([symbol], 'max', { persist: 'sync' });
  return { symbol, tracked, series };
}

export async function backfillTrackedSymbols(symbols: Iterable<string>, range = '10y') {
  const normalized = normalizeSymbols(symbols);
  if (normalized.length === 0) return [];
  return fetchHistory(normalized, range, { persist: 'sync' });
}
