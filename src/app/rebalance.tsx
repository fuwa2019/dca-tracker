import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useTransactions, useSettings } from '@/hooks/usePortfolio';
import { useQuotes } from '@/hooks/useQuotes';
import { aggregatePositions } from '@/lib/calc/position';
import { rebalance } from '@/lib/calc/rebalance';
import { usd, signedPct, pct } from '@/lib/format';

export function RebalancePage() {
  const { data: txns = [] } = useTransactions();
  const { data: settings } = useSettings();
  const positions = useMemo(() => aggregatePositions(txns).filter((p) => p.shares > 1e-9), [txns]);

  const watchlist = settings?.watchlist ?? ['VOO', 'QQQM', 'SMH'];
  const symbols = useMemo(() => [...new Set([...positions.map((p) => p.ticker), ...watchlist])], [positions, watchlist]);
  const { data: quotes = [] } = useQuotes(symbols);
  const priceMap = useMemo(() => new Map(quotes.map((q) => [q.ticker, q.price ?? 0])), [quotes]);

  const [newCash, setNewCash] = useState('3000');
  const [weights, setWeights] = useState<Record<string, string>>(() => defaultWeights(watchlist));
  const dirtyRef = useRef(false);
  // Rebuild defaults when watchlist arrives async — but only if user hasn't edited
  useEffect(() => {
    if (dirtyRef.current) return;
    setWeights(defaultWeights(watchlist));
  }, [watchlist]);

  const weightSum = Object.values(weights).reduce((s, v) => s + (Number(v) || 0), 0);
  const cash = Number(newCash) || 0;

  const holdings = useMemo(
    () => positions.map((p) => ({ ticker: p.ticker, marketValue: p.shares * (priceMap.get(p.ticker) ?? 0), price: priceMap.get(p.ticker) ?? 0 })),
    [positions, priceMap],
  );

  const result = useMemo(() => {
    if (Math.abs(weightSum - 100) > 0.5) return null;
    if (cash <= 0) return null;
    const tw: Record<string, number> = {};
    for (const [k, v] of Object.entries(weights)) tw[k] = (Number(v) || 0) / 100;
    return rebalance({ holdings, targetWeights: tw, newCashUsd: cash });
  }, [holdings, weights, cash, weightSum]);

  return (
    <div className="container max-w-4xl py-6 space-y-5">
      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-semibold tracking-tight"
      >
        再平衡计算器
      </motion.h1>
      <p className="text-sm text-muted-foreground">
        输入新资金 + 目标权重，自动算出每只 ETF 该买多少（不卖出，避免触发税）。
      </p>

      <Card>
        <CardHeader>
          <CardTitle>输入</CardTitle>
          <CardDescription>权重总和需 = 100%</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cash">新资金 (USD)</Label>
            <Input id="cash" type="number" step="0.01" inputMode="decimal" value={newCash} onChange={(e) => setNewCash(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>目标权重</span>
              <span className={`tnum ${Math.abs(weightSum - 100) > 0.5 ? 'text-danger' : 'text-success'}`}>
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

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>建议买入</CardTitle>
            <CardDescription>支持 0.0001 股精度（Schwab 碎股）· 剩余 USD 列出供参考</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {result.map((r) => (
                <motion.div
                  key={r.ticker}
                  layout
                  className="flex flex-wrap items-center gap-3 rounded-lg border bg-card/60 px-3 py-3"
                >
                  <div className="w-14 font-semibold">{r.ticker}</div>
                  <div className="flex-1 min-w-[140px] text-xs text-muted-foreground tnum">
                    当前 {pct(r.currentWeight)} → 目标 {pct(r.targetWeight)}
                  </div>
                  <div className="text-right text-xs tnum text-muted-foreground">
                    买 <span className="font-medium text-foreground">{r.buyShares.toFixed(4)} 股</span> ≈ {usd.format(r.buyShares * (priceMap.get(r.ticker) ?? 0))}
                  </div>
                  <div className="w-24 text-right text-xs tnum">
                    分配 {usd.format(r.buyUsd)}
                  </div>
                  <div className="w-full text-right text-[10px] text-muted-foreground tnum">
                    剩余 {usd.format(r.leftoverUsd)} · 调后 {signedPct(r.resultingWeight - r.targetWeight, 1)} 偏离
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Project-recommended default weights.
 *  If the watchlist exactly matches VOO/QQQM/SMH (any order), use 50/25/25.
 *  Otherwise fall back to equal-weight. */
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
