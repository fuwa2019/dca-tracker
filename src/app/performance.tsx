import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle, CalendarDays } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { PerformancePanel } from '@/components/IbkrPerformancePanel';
import { MonthlyPerformanceCalendar } from '@/components/MonthlyPerformanceCalendar';
import { NavBridgeCard } from '@/components/NavBridgeCard';
import { UnreconciledBadge } from '@/components/UnreconciledBadge';
import { useLedger } from '@/hooks/useLedger';
import { usePerformanceCacheStatus, useRefreshPerformanceCache } from '@/hooks/usePerformanceCache';
import { availableRanges, sliceByRange, type RangeKey } from '@/lib/calc/history';
import { summarizeLedgerWindow } from '@/lib/calc/portfolioLedger';
import { signedPct, changeColor } from '@/lib/format';

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
  const benchmarkReturn = summary.benchmarkReturn;
  const excess = summary.excessReturn;

  const cacheError = cacheStatus.data?.error;
  const shareCheck = checks.find((check) => check.id === 'share_cache');
  const reportLead = history.length > 0
    ? `从 ${history[0].date} 到 ${last?.date}，组合时间加权收益 ${fmtPct(twr)}，相对 ${benchmark} ${fmtPct(excess)}；按金额加权的年化 XIRR ${fmtPct(summary.xirr)}。`
    : '录入入金与交易后，这里会生成一份可审计的业绩报告。';

  return (
    <div className="workbench-page space-y-5">
      <header className="workbench-intro">
        <div className="max-w-3xl">
          <p className="workbench-lede">{reportLead}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              {benchmark} 交易日
            </span>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
              TWR 按券商入金 / 出金切分
            </span>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
              持仓按收盘价 · 基准按复权价
            </span>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refreshCache.mutate()}
            disabled={refreshCache.isPending || history.length === 0}
            title="重算分享页读取的百分比缓存"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshCache.isPending ? 'animate-spin' : ''}`} />
            {refreshCache.isPending ? '刷新中' : '刷新分享缓存'}
          </Button>
        </div>
      </header>

      {(cacheError || refreshCache.isError) && (
        <Card className="flex items-start gap-3 border-loss/30 bg-loss/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-loss">分享缓存刷新失败</div>
            <p className="mt-1 text-xs text-muted-foreground break-words">
              {cacheError ?? (refreshCache.error as Error)?.message ?? '请稍后重试'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">本页数字直接来自账本，不受影响。</p>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="时间加权收益 TWR · 成立以来"
          value={fmtPct(twr)}
          tone={(twr ?? 0) >= 0 ? 'gain' : 'loss'}
          sub={history.length > 0 ? `${history[0].date} 至 ${last?.date}` : '暂无数据'}
        />
        <StatCard
          label="年化 XIRR · 成立以来"
          value={fmtPct(summary.xirr)}
          tone={(summary.xirr ?? 0) >= 0 ? 'gain' : 'loss'}
          sub="按入金 / 出金金额与时间加权"
        />
        {showBenchmark && (
          <StatCard
            label={`${benchmark} 基准 · 同期`}
            value={fmtPct(benchmarkReturn)}
            tone={(benchmarkReturn ?? 0) >= 0 ? 'gain' : 'loss'}
            sub="复权价总回报"
          />
        )}
        {showBenchmark && (
          <StatCard
            label={`超额 vs ${benchmark}`}
            value={fmtPct(excess)}
            className={changeColor(excess ?? 0)}
            sub={`(1 + TWR) / (1 + ${benchmark}) − 1`}
          />
        )}
      </div>

      <NavBridgeCard bridge={ledger.loading ? null : bridge} />

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
    </div>
  );
}

function fmtPct(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : signedPct(value);
}
