import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import { aggregatePositions } from '@/lib/calc/position';

type TxnRow = Database['public']['Tables']['transactions']['Row'];
type CashRow = Database['public']['Tables']['cashflows']['Row'];
type SettingsRow = Database['public']['Tables']['settings']['Row'];

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

export function useExchangeLoss() {
  const cashflows = useCashflows();
  let totalLoss = 0;
  let totalCny = 0;
  let totalUsdActual = 0;
  let totalUsdIdeal = 0;
  for (const c of cashflows.data ?? []) {
    const cny = Number(c.cny_amount) || 0;
    const usd = Number(c.usd_amount) || 0;
    const rate = Number(c.target_rate) || 0;
    if (rate > 0) {
      const ideal = cny / rate;
      totalUsdIdeal += ideal;
      totalLoss += ideal - usd;
    }
    totalCny += cny;
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
