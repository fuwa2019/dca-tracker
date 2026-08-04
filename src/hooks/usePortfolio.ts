import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database, PerformanceHistory, PortfolioHistory, SharedHistory } from '@/lib/database.types';
import { aggregatePositions } from '@/lib/calc/position';
import { calculateBrokerCashBalance } from '@/lib/calc/cashBalance';
import { totalTradeFunding } from '@/lib/calc/history';
import { normalizeSymbol } from '@/lib/symbols';
import { LOCAL_MODE } from '@/lib/localMode';
import { summarizeCashflows } from '@/lib/calc/cashflows';
import {
  localCashflows,
  localPortfolioHistory,
  localSettings,
  localTransactions,
} from '@/lib/localData';

type TxnRow = Database['public']['Tables']['transactions']['Row'];
type CashRow = Database['public']['Tables']['cashflows']['Row'];
type SettingsRow = Database['public']['Tables']['settings']['Row'];

export function useTransactions() {
  return useQuery<TxnRow[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      if (LOCAL_MODE) {
        return [...localTransactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.created_at.localeCompare(a.created_at));
      }
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('trade_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCashflows() {
  return useQuery<CashRow[]>({
    queryKey: ['cashflows'],
    queryFn: async () => {
      if (LOCAL_MODE) return [...localCashflows].sort((a, b) => b.cny_out_date.localeCompare(a.cny_out_date));
      const { data, error } = await supabase
        .from('cashflows')
        .select('*')
        .order('cny_out_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSettings() {
  return useQuery<SettingsRow | null>({
    queryKey: ['settings'],
    queryFn: async () => {
      if (LOCAL_MODE) return localSettings;
      const { data, error } = await supabase.from('settings').select('*').maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function usePortfolioHistory(benchmark?: string) {
  const normalizedBenchmark = normalizeSymbol(benchmark ?? '') || undefined;
  return useQuery<PortfolioHistory | null>({
    queryKey: ['portfolio_history', normalizedBenchmark ?? 'default'],
    queryFn: async () => {
      if (LOCAL_MODE) return localPortfolioHistory;
      const performance = await rpcPerformanceHistory(normalizedBenchmark);
      if (!performance.error && performance.data && !('error' in performance.data)) {
        return normalizeHistory(performance.data as PerformanceHistory);
      }

      const legacy = await supabase.rpc('portfolio_history');
      if (!legacy.error && legacy.data && !('error' in legacy.data)) {
        return normalizeHistory(legacy.data as PortfolioHistory);
      }

      const { data: links } = await supabase
        .from('share_links')
        .select('token')
        .eq('revoked', false)
        .order('created_at', { ascending: false })
        .limit(1);
      const token = links?.[0]?.token;
      if (!token) {
        if (performance.error && !isMissingRpc(performance.error)) throw performance.error;
        if (legacy.error && !isMissingRpc(legacy.error)) throw legacy.error;
        return null;
      }

      const sharedPerformance = await supabase.rpc('shared_performance_history', { p_token: token });
      if (!sharedPerformance.error && sharedPerformance.data && !('error' in sharedPerformance.data)) {
        return normalizeHistory(sharedPerformance.data as SharedHistory);
      }

      const sharedLegacy = await supabase.rpc('shared_history', { p_token: token });
      if (sharedLegacy.error && !isMissingRpc(sharedLegacy.error)) throw sharedLegacy.error;
      const shared = sharedLegacy.data as SharedHistory | { error: string } | null;
      if (!shared || 'error' in shared) return null;
      return normalizeHistory(shared);
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });
}

async function rpcPerformanceHistory(benchmark?: string) {
  if (benchmark) {
    const withBenchmark = await supabase.rpc('performance_history', { p_benchmark: benchmark });
    if (!withBenchmark.error || !isMissingRpc(withBenchmark.error)) return withBenchmark;
  }
  return supabase.rpc('performance_history');
}

function normalizeHistory(history: PerformanceHistory | PortfolioHistory | SharedHistory): PortfolioHistory {
  return {
    generated_at: history.generated_at,
    benchmark: history.benchmark,
    method: history.method,
    price_basis: history.price_basis,
    flow_basis: history.flow_basis,
    date_basis: history.date_basis,
    trading_calendar: history.trading_calendar,
    trading_date_timezone: history.trading_date_timezone,
    excluded_non_trading_days: history.excluded_non_trading_days,
    dirty: history.dirty,
    series: (history.series ?? []).map((p) => {
      const row = p as PortfolioHistory['series'][number];
      return {
        date: p.date,
        trading_date: row.trading_date ?? p.date,
        as_of_timestamp: row.as_of_timestamp ?? null,
        is_provisional: !!row.is_provisional,
        invested: Number(row.invested) || 0,
        cost_basis: Number(row.cost_basis) || 0,
        nav_user: Number(row.nav_user) || 0,
        nav_spy: Number(row.nav_spy) || 0,
        return_pct_user: Number(p.return_pct_user) || 0,
        return_pct_spy: Number(p.return_pct_spy) || 0,
        pnl_user: Number(row.pnl_user) || 0,
        pnl_spy: Number(row.pnl_spy) || 0,
        txns: Array.isArray(row.txns) ? row.txns : [],
      };
    }),
  };
}

function isMissingRpc(error: { code?: string; message?: string; status?: number }) {
  return error.code === 'PGRST202' || error.code === '404' || /function .* does not exist|could not find .* function/i.test(error.message ?? '');
}

export function usePositions() {
  const txns = useTransactions();
  const positions = txns.data ? aggregatePositions(txns.data).filter((p) => p.shares > 1e-9) : [];
  return { ...txns, positions };
}

export function useTotalInvested() {
  const cashflows = useCashflows();
  const txns = useTransactions();
  const brokerDeposits = (cashflows.data ?? []).filter((row) => row.cashflow_kind === 'broker_deposit');
  const total = brokerDeposits.length > 0
    ? summarizeCashflows(brokerDeposits).totalUsdActual
    : totalTradeFunding(txns.data ?? []);
  return {
    ...txns,
    total,
    isLoading: txns.isLoading || cashflows.isLoading,
    isError: txns.isError || cashflows.isError,
  };
}

/**
 * Only adjusted broker deposits participate in account cash. Manual FX rows
 * remain available for exchange-loss reporting without being counted twice.
 */
export function useCashBalance() {
  const cashflows = useCashflows();
  const txns = useTransactions();
  const brokerDeposits = (cashflows.data ?? []).filter((row) => row.cashflow_kind === 'broker_deposit');
  const cash = brokerDeposits.length > 0
    ? calculateBrokerCashBalance(brokerDeposits, txns.data ?? [])
    : 0;
  return {
    cash,
    depositedUsd: summarizeCashflows(brokerDeposits).totalUsdActual,
    isLoading: cashflows.isLoading || txns.isLoading,
    isError: cashflows.isError || txns.isError,
  };
}

export function useExchangeLoss() {
  const cashflows = useCashflows();
  const summary = summarizeCashflows(cashflows.data ?? []);
  return {
    ...cashflows,
    ...summary,
  };
}
