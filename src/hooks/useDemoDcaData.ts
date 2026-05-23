import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchHistory, type HistorySeries } from '@/lib/quote';
import { useAuth } from '@/hooks/useAuth';

const DEMO_NOTE = '[DCA_TEST_10Y_60_QQQ]';
const LEGACY_DEMO_NOTE = '[DCA_TEST_10Y_60_VOO]';
const DEMO_TICKER = 'QQQ';
const DEMO_MONTHLY_USD = 60;
const DEMO_RATE = 7.2;

function isMissingRpc(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || /function .* does not exist|could not find .* function/i.test(error.message ?? '');
}

/**
 * Seeds 10 years of monthly QQQ DCA test data so the performance chart can be
 * eyeballed against IBKR-style references. Tagged with a sentinel `note` so the
 * "clear" action only deletes rows we created here.
 */
export function useDemoDcaData() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  async function clearDemoRows() {
    if (!user) throw new Error('请先登录');
    const tx = await supabase
      .from('transactions')
      .delete()
      .eq('user_id', user.id)
      .in('note', [DEMO_NOTE, LEGACY_DEMO_NOTE]);
    if (tx.error) throw tx.error;
    const cf = await supabase
      .from('cashflows')
      .delete()
      .eq('user_id', user.id)
      .in('note', [DEMO_NOTE, LEGACY_DEMO_NOTE]);
    if (cf.error) throw cf.error;
  }

  const clearMutation = useMutation({
    mutationFn: clearDemoRows,
    onSuccess: async () => {
      setMessage('测试数据已清除');
      await invalidatePortfolioQueries(qc);
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : '清除失败'),
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('请先登录');
      setMessage(null);
      await clearDemoRows();

      const history = await fetchHistory([DEMO_TICKER, 'SPY'], '10y');
      const prices = seriesToPriceMap(history, DEMO_TICKER);
      const tradeRows = buildMonthlyDemoTrades(prices);
      if (tradeRows.length === 0) throw new Error('没有拿到 QQQ 历史价格');

      const cashflows = tradeRows.map((row) => ({
        user_id: user.id,
        cny_out_date: row.date,
        cny_amount: Number((DEMO_MONTHLY_USD * DEMO_RATE).toFixed(2)),
        usd_in_date: row.date,
        usd_amount: DEMO_MONTHLY_USD,
        target_rate: DEMO_RATE,
        fees_cny: 0,
        fees_usd: 0,
        note: DEMO_NOTE,
      }));
      const transactions = tradeRows.map((row) => ({
        user_id: user.id,
        trade_date: row.date,
        ticker: DEMO_TICKER,
        side: 'buy' as const,
        price: row.close,
        shares: Number((DEMO_MONTHLY_USD / row.close).toFixed(6)),
        kind: 'dca' as const,
        note: DEMO_NOTE,
      }));

      const cf = await supabase.from('cashflows').insert(cashflows);
      if (cf.error) throw cf.error;
      const tx = await supabase.from('transactions').insert(transactions);
      if (tx.error) throw tx.error;
      return tradeRows.length;
    },
    onSuccess: async (count) => {
      setMessage(`已生成 ${count} 期`);
      await invalidatePortfolioQueries(qc);
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : '生成失败'),
  });

  return {
    seed: () => seedMutation.mutate(),
    clear: () => clearMutation.mutate(),
    seeding: seedMutation.isPending,
    clearing: clearMutation.isPending,
    busy: seedMutation.isPending || clearMutation.isPending,
    message,
  };
}

async function invalidatePortfolioQueries(qc: ReturnType<typeof useQueryClient>) {
  await refreshPortfolioHistoryCache();
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['transactions'] }),
    qc.invalidateQueries({ queryKey: ['cashflows'] }),
    qc.invalidateQueries({ queryKey: ['portfolio_history'] }),
    qc.invalidateQueries({ queryKey: ['daily_prices'] }),
    qc.invalidateQueries({ queryKey: ['performance_cache_status'] }),
  ]);
}

async function refreshPortfolioHistoryCache() {
  const performance = await supabase.rpc('refresh_performance_history_cache');
  if (!performance.error) return;
  if (!isMissingRpc(performance.error)) {
    // eslint-disable-next-line no-console
    console.warn('[history-cache] refresh failed', performance.error.message);
    return;
  }
  const { error } = await supabase.rpc('refresh_portfolio_history_cache');
  if (!error || isMissingRpc(error)) return;
  // eslint-disable-next-line no-console
  console.warn('[history-cache] refresh failed', error.message);
}

function seriesToPriceMap(series: HistorySeries[], ticker: string) {
  const row = series.find((s) => s.ticker.toUpperCase() === ticker);
  return new Map((row?.points ?? []).map((p) => [p.date, p.close]));
}

function buildMonthlyDemoTrades(prices: Map<string, number>) {
  const months = buildMonthlyStarts();
  const dates = [...prices.keys()].sort();
  return months.flatMap((monthStart) => {
    const month = monthStart.slice(0, 7);
    const tradeDate = dates.find((date) => date >= monthStart && date.startsWith(month));
    const close = tradeDate ? prices.get(tradeDate) : null;
    return tradeDate && close ? [{ date: tradeDate, close }] : [];
  });
}

function buildMonthlyStarts() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear() - 10, now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const out: string[] = [];
  for (let d = start; d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
