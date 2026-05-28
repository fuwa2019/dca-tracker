import { useMemo, useState } from 'react';
import { RefreshCw, Database, AlertTriangle, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { PerformancePanel } from '@/components/IbkrPerformancePanel';
import { usePortfolioHistory, useSettings } from '@/hooks/usePortfolio';
import { usePerformanceCacheStatus, useRefreshPerformanceCache } from '@/hooks/usePerformanceCache';
import { availableRanges, type HistoryPoint, type RangeKey } from '@/lib/calc/history';
import { signedPct, changeColor } from '@/lib/format';
import { getSelectedBenchmark } from '@/lib/settings';
import { cn } from '@/lib/utils';

export function PerformancePage() {
  const [range, setRange] = useState<RangeKey>('ALL');
  const [showBenchmark, setShowBenchmark] = useState(true);
  const { data: settings } = useSettings();
  const selectedBenchmark = getSelectedBenchmark(settings);

  const portfolioHistory = usePortfolioHistory(selectedBenchmark);
  const cacheStatus = usePerformanceCacheStatus(selectedBenchmark);
  const refreshCache = useRefreshPerformanceCache(selectedBenchmark);

  // Auto-refresh removed: dirty status is shown to the user who decides when to refresh.

  const history: HistoryPoint[] = useMemo(() => {
    const rows = portfolioHistory.data?.series ?? [];
    return rows.map((p) => ({
      date: p.date,
      invested: Number(p.invested) || 0,
      costBasis: Number(p.cost_basis) || 0,
      navUser: Number(p.nav_user) || 0,
      navSpy: Number(p.nav_spy) || 0,
      returnPctUser: Number(p.return_pct_user) || 0,
      returnPctSpy: Number(p.return_pct_spy) || 0,
      pnlUser: Number(p.pnl_user) || 0,
      pnlSpy: Number(p.pnl_spy) || 0,
      txns: p.txns ?? [],
    }));
  }, [portfolioHistory.data]);

  const ranges = useMemo(() => availableRanges(history), [history]);
  const effectiveRange = ranges.includes(range) ? range : (ranges[ranges.length - 1] ?? 'ALL');

  const last = history[history.length - 1];
  const portfolioReturn = last?.returnPctUser ?? 0;
  const benchmarkReturn = last?.returnPctSpy ?? 0;
  const excess = Number.isFinite((1 + portfolioReturn) / (1 + benchmarkReturn) - 1)
    ? (1 + portfolioReturn) / (1 + benchmarkReturn) - 1
    : 0;

  const dirty = !!cacheStatus.data?.dirty;
  const hasCache = !!cacheStatus.data?.exists || history.length > 0;
  const cacheError = cacheStatus.data?.error;
  const generatedAt = cacheStatus.data?.updated_at ?? cacheStatus.data?.generated_at ?? portfolioHistory.data?.generated_at;
  const tradingCalendar = portfolioHistory.data?.trading_calendar ?? portfolioHistory.data?.benchmark ?? selectedBenchmark;
  const usesTradingDays = portfolioHistory.data?.excluded_non_trading_days ?? portfolioHistory.data?.date_basis === 'benchmark_price_dates';
  const reportLead = history.length > 0
    ? `从 ${history[0].date} 到 ${last?.date}，组合累计 ${signedPct(portfolioReturn)}，相对 ${selectedBenchmark} ${signedPct(excess)}。`
    : '录入交易并补齐日线价格后，这里会生成一份可分享、可审计的业绩报告。';

  return (
    <div className="container max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Performance Report
          </div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">交易业绩是否跑赢 {selectedBenchmark}？</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{reportLead}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              {usesTradingDays ? `${tradingCalendar} 交易日` : '日历日'}
            </span>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
              交易口径 TWR
            </span>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
              复权价总回报 proxy
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cacheError ? (
            <StatusBadge tone="bad" dot>
              缓存错误
            </StatusBadge>
          ) : refreshCache.isPending ? (
            <StatusBadge tone="info" dot>
              刷新中
            </StatusBadge>
          ) : !hasCache ? (
            <StatusBadge tone="warn" dot>
              未生成缓存
            </StatusBadge>
          ) : dirty ? (
            <StatusBadge tone="warn" dot>
              待刷新
            </StatusBadge>
          ) : (
            <StatusBadge tone="ok" dot>
              缓存最新
            </StatusBadge>
          )}
          {generatedAt && (
            <span className="text-[11px] text-muted-foreground tnum">
              更新于 {formatDateTime(generatedAt)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshCache.mutate()}
            disabled={refreshCache.isPending}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshCache.isPending && 'animate-spin')} />
            刷新缓存
          </Button>
        </div>
      </div>

      {cacheError && (
        <Card className="flex items-start gap-3 border-loss/30 bg-loss/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-loss">缓存刷新失败</div>
            <p className="mt-1 text-xs text-muted-foreground break-words">{cacheError}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              检查交易是否完整，必要时到「数据健康」补齐日线价格再重试。
            </p>
          </div>
        </Card>
      )}

      {refreshCache.isError && (
        <Card className="flex items-start gap-3 border-loss/30 bg-loss/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-loss">缓存刷新失败</div>
            <p className="mt-1 text-xs text-muted-foreground break-words">
              {(refreshCache.error as Error)?.message ?? '请稍后重试'}
            </p>
          </div>
        </Card>
      )}

      <div className={cn('grid gap-3', showBenchmark ? 'sm:grid-cols-3' : 'sm:grid-cols-1')}>
        <StatCard
          label="组合累计表现"
          value={signedPct(portfolioReturn)}
          tone={portfolioReturn >= 0 ? 'gain' : 'loss'}
          sub={history.length > 0 ? `${history[0].date} 至 ${last?.date}` : '暂无数据'}
        />
        {showBenchmark && (
          <StatCard
            label={`${selectedBenchmark} 基准 · 累计`}
            value={signedPct(benchmarkReturn)}
            tone={benchmarkReturn >= 0 ? 'gain' : 'loss'}
            sub="同时间区间"
          />
        )}
        {showBenchmark && (
          <StatCard
            label={`超额 vs ${selectedBenchmark}`}
            value={signedPct(excess)}
            className={changeColor(excess)}
            sub={`组合 / ${selectedBenchmark} 同期`}
          />
        )}
      </div>

      <PerformancePanel
        history={history}
        range={effectiveRange}
        onRangeChange={setRange}
        availableRanges={ranges}
        showBenchmark={showBenchmark}
        onShowBenchmarkChange={setShowBenchmark}
        benchmarkLabel={selectedBenchmark}
        loading={portfolioHistory.isLoading}
      />

      {!hasCache && !cacheStatus.isLoading && (
        <Card className="border-warn/30 bg-warn/5 p-4 text-sm">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">还没有业绩缓存</div>
              <p className="mt-1 text-xs text-muted-foreground">
                录入第一笔交易，并到「数据健康」补齐 {selectedBenchmark}/持仓的历史日线价格，再点上方「刷新缓存」即可生成曲线。
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}
