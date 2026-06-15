import { useEffect, useMemo } from 'react';
import { useQuotes } from '@/hooks/useQuotes';
import { registerTrackedSymbols } from '@/lib/trackedSymbols';
import { useTransactions, useSettings, useCashBalance } from '@/hooks/usePortfolio';
import { aggregatePositions, type Position } from '@/lib/calc/position';
import type { Quote } from '@/lib/quote';
import { getSelectedBenchmark, getWatchlist } from '@/lib/settings';

/**
 * 轻量持仓模型:只算「持仓 + 行情 + 现金 + 行情状态」。
 *
 * 给 /exposure 这类只需要持仓市值的页面用,避免拉起整个 `useDashboardModel`
 * (后者还会算 XIRR、monthsToTarget、完整 TWR 历史并订阅 usePortfolioHistory,
 *  那些在穿透页一个都用不到)。
 *
 * 符号集刻意和 dashboard 保持一致(持仓 + 自选 + 基准),这样 useQuotes 的
 * queryKey 相同,可直接复用 dashboard 已缓存的行情,不产生额外网络请求。
 */
export interface PositionsModel {
  positions: Position[];
  quoteByTicker: Map<string, Quote>;
  cash: number;
  costBasisMode: 'avg' | 'fifo';
  quotesLoading: boolean;
  quotesError: boolean;
  quotesNone: boolean;
  quotesPartial: boolean;
  isEmpty: boolean;
}

export function usePositionsModel(): PositionsModel {
  const { data: txns = [] } = useTransactions();
  const { data: settings } = useSettings();
  const { cash } = useCashBalance();

  const selectedBenchmark = useMemo(() => getSelectedBenchmark(settings), [settings]);
  const watchlist = useMemo(() => getWatchlist(settings), [settings]);

  const positions = useMemo(
    () => aggregatePositions(txns).filter((p) => p.shares > 1e-9),
    [txns],
  );
  const symbols = useMemo(
    () => [...new Set([...positions.map((p) => p.ticker), ...watchlist, selectedBenchmark])],
    [positions, watchlist, selectedBenchmark],
  );

  const { data: quotes = [], isLoading: quotesLoading, isError: quotesError } = useQuotes(symbols);
  useEffect(() => {
    void registerTrackedSymbols(symbols, 'dashboard').catch((error) => {
      if (import.meta.env.DEV) console.warn('[tracked-symbols] exposure registration failed:', error);
    });
  }, [symbols]);

  const quoteByTicker = useMemo(() => new Map(quotes.map((q) => [q.ticker, q])), [quotes]);
  const quotesNone = !quotesLoading && quotes.length === 0 && positions.length > 0;
  const quotesPartial = !quotesLoading && positions.length > 0 && positions.some((p) => {
    const q = quoteByTicker.get(p.ticker);
    return !q || q.price == null;
  });

  const costBasisMode = (settings?.cost_basis_default as 'avg' | 'fifo') ?? 'avg';

  return {
    positions,
    quoteByTicker,
    cash,
    costBasisMode,
    quotesLoading,
    quotesError,
    quotesNone,
    quotesPartial,
    isEmpty: positions.length === 0,
  };
}
