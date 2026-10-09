import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { PerformancePanel } from '@/components/IbkrPerformancePanel';
import { MonthlyPerformanceCalendar } from '@/components/MonthlyPerformanceCalendar';
import { NavBridgeCard } from '@/components/NavBridgeCard';
import { UnreconciledBadge } from '@/components/UnreconciledBadge';
import { useLedger } from '@/hooks/useLedger';
import { usePerformanceCacheStatus, useRefreshPerformanceCache } from '@/hooks/usePerformanceCache';
import { availableRanges, sliceByRange, type RangeKey } from '@/lib/calc/history';
import { summarizeLedgerWindow } from '@/lib/calc/portfolioLedger';
import { signedPct } from '@/lib/format';
import { READ_ONLY_SHARE } from '@/lib/shareSession';

export function PerformancePage() {
  const [range, setRange] = useState<RangeKey>('ALL');
  const [showBenchmark, setShowBenchmark] = useState(true);
  const ledger = useLedger({ live: true });
  const benchmark = ledger.benchmark;
  const { history, summary, series, checks } = ledger;

  const cacheStatus = usePerformanceCacheStatus(benchmark);
  const refreshCache = useRefreshPerformanceCache(benchmark);

  const ranges = useMemo(() => availableRanges(history), [history]);
  const effectiveRange = ranges.includes(range) ? range : (ranges[ranges.length - 1] ?? 'ALL');
  const bridge = useMemo(() => {
    const windowPoints = sliceByRange(history, effectiveRange);
    return summarizeLedgerWindow(series, windowPoints[0]?.date ?? null);
  }, [history, series, effectiveRange]);

  const last = history[history.length - 1];
  const twr = summary.twr;
  const excess = summary.excessReturn;

  const cacheError = cacheStatus.data?.error;
  const shareCheck = checks.find((check) => check.id === 'share_cache');
  const reportLead = history.length > 0
    ? `从 ${history[0].date} 到 ${last?.date}，组合时间加权收益 ${fmtPct(twr)}，相对 ${benchmark} ${fmtPct(excess)}；按金额加权的年化 XIRR ${fmtPct(summary.xirr)}。`
    : '录入入金与交易后，这里会生成一份可审计的业绩报告。';

  if (ledger.coreError) {
    return (
      <div className="workbench-page">
        <Card className="p-4" role="status">
          <h2 className="text-sm font-semibold">账本读取失败</h2>
          <p className="mt-2 text-xs text-muted-foreground">交易、现金事件或设置未能载入。</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={ledger.retryCore}><RefreshCw className="h-3.5 w-3.5" />重试</Button>
        </Card>
      </div>
    );
  }

  if (ledger.coreLoading || !ledger.priceComplete) {
    const pending = ledger.loading;
    return (
      <div className="workbench-page space-y-4">
        <Card className="p-4" role="status">
          <h2 className="text-sm font-semibold">{ledger.coreLoading ? '正在读取账本' : ledger.pricesLoading ? '正在读取历史价格' : ledger.priceBackfillPending ? '正在补齐历史价格' : ledger.priceCalculating ? '正在计算业绩' : '历史价格不完整'}</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {pending ? '账本和价格准备完成后显示业绩；缺失的价格不会计入收益。' : ledger.priceError ? '价格请求失败，业绩暂不可用。' : '部分价格仍缺失，业绩暂不可用。'}
          </p>
          {!ledger.coreLoading && <p className="mt-1 text-xs text-muted-foreground">已载入 {ledger.ledger.trades.length} 笔交易，{ledger.ledger.cash.length} 条现金事件。</p>}
          {!pending && <Button variant="outline" size="sm" className="mt-3" onClick={ledger.retryPrices}><RefreshCw className="h-3.5 w-3.5" />重试价格</Button>}
          <Button asChild variant="outline" size="sm" className="mt-3 ml-2"><Link to="/health">数据健康</Link></Button>
        </Card>
        <PerformancePanel history={[]} range={range} onRangeChange={setRange} availableRanges={[]}
          showBenchmark={showBenchmark} onShowBenchmarkChange={setShowBenchmark}
          benchmarkLabel={benchmark} loading={pending} emptyMessage="业绩暂不可用"
          emptyDescription="历史价格未齐，暂不显示收益曲线。" />
      </div>
    );
  }

  return (
    <div className="workbench-page space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>每天的盈亏，长期的表现。</span>
        <UnreconciledBadge checks={checks} />
        {!ledger.loading && !series.complete && <StatusBadge tone="warn" dot>部分价格缺失</StatusBadge>}
      </div>

      {(cacheError || refreshCache.isError) && (
        <Card className="flex items-start gap-3 border-loss/30 bg-loss/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-loss">分享缓存刷新失败</div>
            <p className="mt-1 text-xs text-muted-foreground break-words">
              {cacheError ?? (refreshCache.error as Error)?.message ?? '请稍后重试'}
            </p>
          </div>
        </Card>
      )}

      <MonthlyPerformanceCalendar history={history} benchmark={benchmark} amountsFromHistory />

      <PerformancePanel
        history={history}
        range={effectiveRange}
        onRangeChange={setRange}
        availableRanges={ranges}
        showBenchmark={showBenchmark}
        onShowBenchmarkChange={setShowBenchmark}
        benchmarkLabel={benchmark}
        loading={ledger.loading}
      />
      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-ring">计算拆解与口径说明</summary>
        <div className="mt-4 space-y-4">
          <NavBridgeCard bridge={ledger.loading ? null : bridge} />
          <div className="workbench-intro">
            <div className="max-w-3xl">
              <p className="workbench-lede">{reportLead}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <UnreconciledBadge checks={checks} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ledger.loading ? (
                <StatusBadge tone="info" dot>读取账本</StatusBadge>
              ) : series.complete ? (
                <StatusBadge tone="ok" dot>账本估值完整</StatusBadge>
              ) : (
                <StatusBadge tone="warn" dot>部分价格缺失</StatusBadge>
              )}
              {shareCheck && (
                <StatusBadge tone={shareCheck.status === 'pass' ? 'ok' : 'warn'} dot>
                  分享页{shareCheck.status === 'pass' ? '口径一致' : '缓存待更新'}
                </StatusBadge>
              )}
              <Button asChild variant="outline" size="sm">
                <Link to="/health">
                  <RefreshCw className="h-3.5 w-3.5" />
                  数据健康
                </Link>
              </Button>
              {!READ_ONLY_SHARE && <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refreshCache.mutate()}
                disabled={refreshCache.isPending || history.length === 0}
                title="更新分享页数据"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshCache.isPending ? 'animate-spin' : ''}`} />
                {refreshCache.isPending ? '刷新中' : '刷新分享缓存'}
              </Button>}
            </div>
          </div>

        </div>
      </details>

    </div>
  );
}

function fmtPct(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : signedPct(value);
}
