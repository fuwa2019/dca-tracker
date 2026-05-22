import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import { aggregatePositions } from '@/lib/calc/position';

type TxnRow = Database['public']['Tables']['transactions']['Row'];
type CashRow = Database['public']['Tables']['cashflows']['Row'];
type SettingsRow = Database['public']['Tables']['settings']['Row'];
type PortfolioHistoryRpc = Database['public']['Functions']['portfolio_history']['Returns'];
type SharedHistoryRpc = Database['public']['Functions']['shared_history']['Returns'];
type PortfolioHistory = Exclude<PortfolioHistoryRpc, { error: string }>;
type SharedHistory = Exclude<SharedHistoryRpc, { error: string }>;

export function useTransactions() {
  return useQuery<TxnRow[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
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
      const { data, error } = await supabase.from('settings').select('*').maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function usePortfolioHistory() {
  return useQuery<PortfolioHistory | null>({
    queryKey: ['portfolio_history'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portfolio_history');
      if (!error && data && !('error' in data)) return data as PortfolioHistory;

      const { data: links } = await supabase
        .from('share_links')
        .select('token')
        .eq('revoked', false)
        .order('created_at', { ascending: false })
        .limit(1);
      const token = links?.[0]?.token;
      if (!token) {
        if (error) throw error;
        return null;
      }

      const fallback = await supabase.rpc('shared_history', { p_token: token });
      if (fallback.error) throw fallback.error;
      const shared = fallback.data as SharedHistory;
      if (!shared || 'error' in shared) return null;
      return {
        generated_at: shared.generated_at,
        series: shared.series.map((p) => ({
          date: p.date,
          invested: 0,
          cost_basis: 0,
          nav_user: 0,
          nav_spy: 0,
          return_pct_user: p.return_pct_user,
          return_pct_spy: p.return_pct_spy,
          pnl_user: 0,
          pnl_spy: 0,
          txns: [],
        })),
      };
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });
}

export function usePositions() {
  const txns = useTransactions();
  const positions = txns.data ? aggregatePositions(txns.data).filter((p) => p.shares > 1e-9) : [];
  return { ...txns, positions };
}

export function useTotalInvested() {
  const cashflows = useCashflows();
  const total =
    cashflows.data?.reduce((s, c) => s + (Number(c.usd_amount) || 0), 0) ?? 0;
  return { ...cashflows, total };
}

/**
 * Cash USD currently sitting in Schwab — i.e. money you deposited but haven't
 * deployed into stock yet. Must be included in NAV so XIRR / TWR / charts don't
 * report a fake loss when you've deposited more than you've bought.
 *
 *   cash = Σ cashflow.usd_amount − Σ buy_notional + Σ sell_notional
 */
export function useCashBalance() {
  const cashflows = useCashflows();
  const txns = useTransactions();
  const depositedUsd = cashflows.data?.reduce((s, c) => s + (Number(c.usd_amount) || 0), 0) ?? 0;
  let buyUsd = 0;
  let sellUsd = 0;
  for (const t of txns.data ?? []) {
    const notional = Number(t.shares) * Number(t.price);
    if (t.side === 'buy') buyUsd += notional;
    else sellUsd += notional;
  }
  const cash = depositedUsd - buyUsd + sellUsd;
  return { cash, depositedUsd, buyUsd, sellUsd, isLoading: cashflows.isLoading || txns.isLoading };
}

export function useExchangeLoss() {
  const cashflows = useCashflows();
  let totalLoss = 0;
  let totalCny = 0;
  let totalUsdActual = 0;
  let totalUsdIdeal = 0;
  for (const c of cashflows.data ?? []) {
    const cny = Number(c.cny_amount) || 0;
    const feesCny = Number(c.fees_cny) || 0;
    const usd = Number(c.usd_amount) || 0;
    const rate = Number(c.target_rate) || 0;
    if (rate > 0) {
      const ideal = (cny + feesCny) / rate;
      totalUsdIdeal += ideal;
      totalLoss += ideal - usd;
    }
    totalCny += cny + feesCny;
    totalUsdActual += usd;
  }
  return {
    ...cashflows,
    totalLoss,
    totalCny,
    totalUsdActual,
    totalUsdIdeal,
    lossPct: totalUsdIdeal > 0 ? totalLoss / totalUsdIdeal : 0,
  };
}
