import { useEffect, useMemo, useRef, useState } from 'react';
import { Scale } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { useTransactions, useSettings } from '@/hooks/usePortfolio';
import { useQuotes } from '@/hooks/useQuotes';
import { aggregatePositions } from '@/lib/calc/position';
import { rebalance } from '@/lib/calc/rebalance';
import { usd, signedPct, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

export function RebalancePage() {
  const { data: txns = [] } = useTransactions();
  const { data: settings } = useSettings();
  const positions = useMemo(
    () => aggregatePositions(txns).filter((p) => p.shares > 1e-9),
    [txns],
  );

  const watchlist = settings?.watchlist ?? ['VOO', 'QQQM', 'SMH'];
  const symbols = useMemo(
    () => [...new Set([...positions.map((p) => p.ticker), ...watchlist])],
    [positions, watchlist],
  );
  const { data: quotes = [] } = useQuotes(symbols);
  const quoteByTicker = useMemo(() => new Map(quotes.map((q) => [q.ticker, q])), [quotes]);
  const priceMap = useMemo(() => new Map(quotes.map((q) => [q.ticker, q.price])), [quotes]);
  const missingPrices = useMemo(
    () => {
      const allTickers = [...new Set([...positions.map((p) => p.ticker), ...watchlist])];
      return allTickers.filter((t) => {
        const q = quoteByTicker.get(t);
        return !q || q.price == null;
      });
    },
    [positions, watchlist, quoteByTicker],
  );

  const [newCash, setNewCash] = useState('3000');
  const [weights, setWeights] = useState<Record<string, string>>(() => defaultWeights(watchlist));
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setWeights(defaultWeights(watchlist));
  }, [watchlist]);

  const weightSum = Object.values(weights).reduce((s, v) => s + (Number(v) || 0), 0);
  const cash = Number(newCash) || 0;
  const weightSumOk = Math.abs(weightSum - 100) <= 0.5;
  const missingPricesText = missingPrices.join(', ');
  const showMissingPriceEmpty = weightSumOk && cash > 0 && missingPrices.length > 0;

  const holdings = useMemo(
    () =>
      positions.map((p) => {
        const price = priceMap.get(p.ticker) ?? null;
        return {
          ticker: p.ticker,
          marketValue: price != null ? p.shares * price : 0,
          price: price ?? 0,
        };
      }),
    [positions, priceMap],
  );

  const result = useMemo(() => {
    if (!weightSumOk) return null;
    if (cash <= 0) return null;
    if (missingPrices.length > 0) return null;
    const tw: Record<string, number> = {};
    for (const [k, v] of Object.entries(weights)) tw[k] = (Number(v) || 0) / 100;
    return rebalance({ holdings, targetWeights: tw, newCashUsd: cash });
  }, [holdings, weights, cash, weightSumOk, missingPrices]);

  return (
    <div className="container max-w-4xl px-4 py-5 sm:px-6 sm:py-6 space-y-5">
      <p className="text-xs text-muted-foreground">
        输入新资金 + 目标权重 → 自动算出每只 ETF 该买多少（仅买入，避免卖出触税）。支持 0.0001 股精度。
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">输入</CardTitle>
          <CardDescription className="text-xs">权重总和需 = 100%</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cash">新资金 (USD)</Label>
            <Input
              id="cash"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={newCash}
              onChange={(e) => setNewCash(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground uppercase tracking-wider">目标权重</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium tnum',
                  weightSumOk ? 'bg-gain-soft' : 'bg-loss-soft',
                )}
              >
                合计 {weightSum.toFixed(1)}%
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.entries(weights).map(([t, v]) => (
                <div key={t} className="flex items-center gap-2">
                  <span className="w-14 text-sm font-medium">{t}</span>
                  <Input
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    value={v}
                    onChange={(e) => {
                      dirtyRef.current = true;
                      setWeights((w) => ({ ...w, [t]: e.target.value }));
                    }}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  dirtyRef.current = false;
                  setWeights(defaultWeights(watchlist));
                }}
              >
                还原默认
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  dirtyRef.current = true;
                  const equal = (100 / watchlist.length).toFixed(1);
                  const next: Record<string, string> = {};
                  for (const t of watchlist) next[t] = equal;
                  setWeights(next);
                }}
              >
                等权填充
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {result ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-semibold">建议买入</div>
            <div className="text-[11px] text-muted-foreground">
              注入 {usd.format(cash)} · 现金剩余看每行右下
            </div>
          </div>
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-elevated/50 text-muted-foreground">
                  <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider">代码</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider">当前 → 目标</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider">偏离</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider">买入股数</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider">分配 USD</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider">余额</th>
                </tr>
              </thead>
              <tbody>
                {result.map((r) => {
                  const deviation = r.currentWeight - r.targetWeight;
                  const buyUsd = r.buyShares * (priceMap.get(r.ticker) ?? 0);
                  return (
                    <tr key={r.ticker} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-semibold">{r.ticker}</td>
                      <td className="px-4 py-3 text-right tnum text-muted-foreground">
                        {pct(r.currentWeight)} <span className="opacity-60">→</span> {pct(r.targetWeight)}
                      </td>
                      <td className={cn('px-4 py-3 text-right tnum', deviation > 0 ? 'text-warn' : 'text-muted-foreground')}>
                        {signedPct(deviation, 1)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tnum">{r.buyShares.toFixed(4)}</td>
                      <td className="px-4 py-3 text-right tnum">{usd.format(buyUsd)}</td>
                      <td className="px-4 py-3 text-right tnum text-muted-foreground">{usd.format(r.leftoverUsd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {result.map((r) => {
              const deviation = r.currentWeight - r.targetWeight;
              const buyUsd = r.buyShares * (priceMap.get(r.ticker) ?? 0);
              return (
                <div key={r.ticker} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <div className="font-semibold">{r.ticker}</div>
                    <div className="text-sm font-medium tnum">{r.buyShares.toFixed(4)} 股</div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-muted-foreground tnum">
                    <span>
                      当前 {pct(r.currentWeight)} → 目标 {pct(r.targetWeight)} ({signedPct(deviation, 1)})
                    </span>
                    <span>{usd.format(buyUsd)} · 余 {usd.format(r.leftoverUsd)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : showMissingPriceEmpty ? (
        <EmptyState
          icon={Scale}
          title="行情缺失，暂不能生成建议"
          description={`缺失 ${missingPricesText} 等现价，避免按 0 价格计算。请稍后刷新或检查 Worker。`}
        />
      ) : !weightSumOk ? (
        <EmptyState
          icon={Scale}
          title="权重未到 100%"
          description={`当前合计 ${weightSum.toFixed(1)}% — 调整每只 ETF 的目标占比，让总和等于 100%。`}
        />
      ) : cash <= 0 ? (
        <EmptyState icon={Scale} title="还没有可分配资金" description="填一笔 USD 新资金即可看到建议买入。" />
      ) : null}
    </div>
  );
}

function defaultWeights(watchlist: string[]): Record<string, string> {
  const set = new Set(watchlist.map((t) => t.toUpperCase()));
  const out: Record<string, string> = {};
  if (set.size === 3 && set.has('VOO') && set.has('QQQM') && set.has('SMH')) {
    for (const t of watchlist) {
      const u = t.toUpperCase();
      out[t] = u === 'VOO' ? '50' : '25';
    }
    return out;
  }
  const equal = watchlist.length > 0 ? (100 / watchlist.length).toFixed(1) : '';
  for (const t of watchlist) out[t] = equal;
  return out;
}
