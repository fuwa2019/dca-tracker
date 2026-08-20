import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Database,
  FileUp,
  Plus,
  RefreshCw,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { HoldingsList } from '@/components/HoldingsList';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { signedPct, signedUsd, usd, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LEDGER_IMPORT_V2, LOCAL_MODE } from '@/lib/localMode';
import type { DashboardModel } from './model';
import type { HistoryPoint } from '@/lib/calc/history';

/** Ranges the overview offers, matching the performance page's vocabulary. */
const OVERVIEW_RANGES = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const;
type OverviewRange = (typeof OVERVIEW_RANGES)[number];

const RANGE_LABELS: Record<OverviewRange, string> = {
  '1M': '近 1 个月',
  '3M': '近 3 个月',
  '6M': '近 6 个月',
  YTD: '今年以来',
  '1Y': '近 1 年',
  ALL: '全部区间',
};

/** Trailing window of a daily series. Pure — the caller owns the state. */
function sliceByRange(points: ReadonlyArray<HistoryPoint>, range: OverviewRange): HistoryPoint[] {
  if (points.length === 0 || range === 'ALL') return [...points];
  const last = points[points.length - 1];
  const end = new Date(`${last.date}T00:00:00Z`);
  const start = new Date(end);
  if (range === 'YTD') start.setUTCMonth(0, 1);
  else if (range === '1M') start.setUTCMonth(start.getUTCMonth() - 1);
  else if (range === '3M') start.setUTCMonth(start.getUTCMonth() - 3);
  else if (range === '6M') start.setUTCMonth(start.getUTCMonth() - 6);
  else start.setUTCFullYear(start.getUTCFullYear() - 1);
  const from = start.toISOString().slice(0, 10);
  const sliced = points.filter((point) => point.date >= from);
  return sliced.length > 1 ? sliced : [...points];
}

export function WorkbenchDashboard({ model }: { model: DashboardModel }) {
  const {
    loading,
    positions,
    selectedBenchmark,
    quoteByTicker,
    quotesLoading,
    quotesError,
    quotesNone,
    quotesPartial,
    cacheDirty,
    history,
    accountValueHistory,
    aggregates,
    dayChangePct,
    totalReturnPct,
    target,
    monthsToTarget,
    xirr,
    portfolioCumulative,
    excessVsBenchmark,
    isEmpty,
    costBasisMode,
  } = model;

  const [range, setRange] = useState<OverviewRange>('1Y');

  const rangedSource = useMemo(() => {
    const source = accountValueHistory.length > 1 ? accountValueHistory : history;
    return sliceByRange(source, range);
  }, [accountValueHistory, history, range]);

  // The hero change follows the selected range, the way the reference reads
  // "-47.25% past year" instead of a fixed day-over-day number.
  const rangeChange = useMemo(() => {
    const first = rangedSource.find((point) => Number.isFinite(point.navUser));
    const last = [...rangedSource].reverse().find((point) => Number.isFinite(point.navUser));
    if (!first || !last) return { amount: 0, pct: Number.NaN };
    const amount = last.navUser - first.navUser;
    return { amount, pct: first.navUser > 0 ? amount / first.navUser : Number.NaN };
  }, [rangedSource]);

  const chartRows = useMemo(() => {
    const source = rangedSource;
    const step = Math.max(1, Math.ceil(source.length / 120));
    const rows = source
      .filter((point) => Number.isFinite(point.navUser))
      .filter((_, index) => index % step === 0)
      .map((point) => ({ date: point.date, value: point.navUser }));
    const last = source[source.length - 1];
    if (last && rows[rows.length - 1]?.date !== last.date) {
      rows.push({ date: last.date, value: last.navUser });
    }
    return rows;
  }, [rangedSource]);

  const dataState = quotesError || quotesNone
    ? { tone: 'bad' as const, label: '行情不可用', detail: '当前值可能沿用成本或缓存' }
    : quotesPartial
      ? { tone: 'warn' as const, label: '行情不完整', detail: '部分持仓缺少最新价格' }
      : quotesLoading
        ? { tone: 'info' as const, label: '正在取价', detail: '等待行情源返回' }
        : { tone: 'ok' as const, label: '数据可用', detail: '持仓与现金已载入' };

  if (loading) return <DashboardLoading />;

  if (isEmpty) {
    return (
      <div className="workbench-page">
        <PageIntro
          eyebrow="Overview"
          title="先建立一份可核对的账本"
          description="导入完整历史或录入第一笔交易。确认前只做本地预览，不会直接写入数据。"
        />
        <section className="workbench-empty" aria-labelledby="empty-title">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <WalletCards className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="empty-title" className="text-base font-semibold">组合还是空的</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              推荐先使用统一导入预览；它会识别 Schwab、IBKR 和 TradingView 文件，并逐行标出导入、重复、忽略或阻止。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/transactions"><FileUp className="h-4 w-4" />开始导入</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/transactions"><Plus className="h-4 w-4" />手工录入</Link>
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const targetProgress = target > 0 ? Math.min(100, Math.max(0, (aggregates.nav / target) * 100)) : 0;
  const dateRange = history.length > 0
    ? `${history[0].date} 至 ${history[history.length - 1].date}`
    : '尚未生成历史曲线';

  return (
    <div className="workbench-page">
      {/* Reference overview: one hero number, a full-bleed curve, then sections. */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <HeroValue value={aggregates.nav} />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className={changeColor(rangeChange.amount)}>{signedUsd(rangeChange.amount)}</span>
            <span className={changeColor(rangeChange.amount)}>
              {Number.isFinite(rangeChange.pct) ? signedPct(rangeChange.pct) : '—'}
            </span>
            <span className="text-muted-foreground">{RANGE_LABELS[range]}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/health"><RefreshCw className="h-4 w-4" />数据健康</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/transactions"><FileUp className="h-4 w-4" />导入或录入</Link>
          </Button>
        </div>
      </header>

      <section className="mt-3 min-w-0" aria-labelledby="value-chart-title">
        <h2 id="value-chart-title" className="sr-only">账户价值曲线</h2>
        {chartRows.length > 1 ? (
          <div className="h-56 min-w-0 sm:h-72" role="img" aria-label={`账户价值曲线，${dateRange}`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartRows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="overview-value-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Tooltip
                  cursor={{ stroke: 'hsl(var(--crosshair))', strokeDasharray: '3 3' }}
                  content={({ active, payload }) => active && payload?.[0]?.payload ? (
                    <div className="workbench-tooltip">
                      <div className="text-muted-foreground">{payload[0].payload.date}</div>
                      <div className="font-num mt-0.5 font-semibold">{usd.format(payload[0].payload.value)}</div>
                    </div>
                  ) : null}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                  fill="url(#overview-value-fill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="workbench-chart-empty">历史价格不足，完成数据修复后生成曲线。</div>
        )}

        <div className="mt-3 flex justify-center">
          <SegmentedControl
            value={range}
            onChange={setRange}
            name="overview-range"
            ariaLabel="选择区间"
            size="sm"
            options={OVERVIEW_RANGES.map((value) => ({ value, label: value }))}
          />
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>累计 TWR <strong className={changeColor(portfolioCumulative)}>{signedPct(portfolioCumulative)}</strong></span>
          <span>超额 vs {selectedBenchmark} <strong className={changeColor(excessVsBenchmark)}>{signedPct(excessVsBenchmark)}</strong></span>
          <span>年化 XIRR <strong className={changeColor(xirr)}>{xirr === null ? '—' : signedPct(xirr)}</strong></span>
          <Link className="workbench-link" to="/performance">查看完整绩效 <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
      </section>

      <div className="workbench-grid">
        <section className="min-w-0" aria-labelledby="holdings-title">
        <PanelHeader title="当前持仓" id="holdings-title" detail={`${positions.length} 个标的 · 成本口径 ${costBasisMode === 'fifo' ? 'FIFO' : 'AVG'}`} action={<Link className="workbench-link" to="/exposure">查看穿透敞口 <ArrowUpRight className="h-3.5 w-3.5" /></Link>} />
          <div className="mt-3">
          <HoldingsList positions={positions} quoteByTicker={quoteByTicker} totalMarketValue={aggregates.stockMv} basis={costBasisMode} />
          </div>
        </section>

        <aside aria-label="账本与操作" className="space-y-4">
          <section className="workbench-panel" aria-labelledby="summary-title">
            <PanelHeader title="组合摘要" id="summary-title" detail="当前口径" />
            <dl className="mt-4 space-y-3">
              <SummaryRow label="今日盈亏" value={signedUsd(aggregates.dayPL)} detail={Number.isFinite(dayChangePct) ? signedPct(dayChangePct) : '—'} tone={aggregates.dayPL} />
              <SummaryRow label="总收益" value={signedUsd(aggregates.totalPL)} detail={Number.isFinite(totalReturnPct) ? signedPct(totalReturnPct) : '—'} tone={aggregates.totalPL} />
              <SummaryRow label="现金余额" value={usd.format(aggregates.cash)} detail={`${aggregates.nav > 0 ? ((aggregates.cash / aggregates.nav) * 100).toFixed(1) : '0.0'}% 净值`} />
            </dl>
          </section>

          <section className="workbench-panel" aria-labelledby="status-title">
            <PanelHeader title="账本状态" id="status-title" detail="写入前可追溯" />
            <div className="mt-4 space-y-3">
              <StateRow icon={dataState.tone === 'ok' ? CheckCircle2 : Activity} label="行情与持仓" value={dataState.label} detail={dataState.detail} tone={dataState.tone} />
              <StateRow icon={cacheDirty ? RefreshCw : CheckCircle2} label="绩效缓存" value={cacheDirty ? '待刷新' : '已同步'} detail={cacheDirty ? '交易或现金事件发生了变化' : '当前结果可继续查看'} tone={cacheDirty ? 'warn' : 'ok'} />
              <StateRow icon={Database} label="导入模型" value={LEDGER_IMPORT_V2 ? '统一账本 V2' : '兼容模式'} detail={LEDGER_IMPORT_V2 ? 'Schwab · IBKR · TradingView' : '建议切换统一预览'} tone={LEDGER_IMPORT_V2 ? 'ok' : 'warn'} />
            </div>
          </section>

          <section className="workbench-panel" aria-labelledby="target-title">
            <PanelHeader title="目标进度" id="target-title" detail="仅用于长期跟踪" />
            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <div className="font-num text-2xl font-semibold">{targetProgress.toFixed(1)}%</div>
                <div className="mt-1 text-xs text-muted-foreground">{usd.format(aggregates.nav)} / {usd.format(target)}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div className="font-num text-base text-foreground">{formatMonths(monthsToTarget)}</div>
                <div>按当前目标参数</div>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-elevated">
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${targetProgress}%` }} />
            </div>
          </section>
        </aside>
      </div>

      <section className="workbench-next" aria-labelledby="next-title">
        <div>
          <div className="workbench-eyebrow">Next check</div>
          <h2 id="next-title" className="mt-1 text-base font-semibold">保持账本可解释</h2>
          <p className="mt-1 text-sm text-muted-foreground">导入新文件后先看逐行状态和对账结果，再刷新绩效缓存。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/transactions"><FileUp className="h-4 w-4" />统一导入</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/health"><Database className="h-4 w-4" />检查数据</Link></Button>
        </div>
      </section>

      {LOCAL_MODE && <div className="text-xs text-muted-foreground">本地演示数据 · 仅写入浏览器内存</div>}
    </div>
  );
}

/** Hero figure: the cents step back so the headline number reads first. */
function HeroValue({ value }: { value: number }) {
  const text = usd.format(value);
  const [whole, cents] = text.split('.');
  return (
    <div className="font-num text-[34px] font-semibold leading-none tracking-tight sm:text-[40px]">
      {whole}
      {cents !== undefined && <span className="text-muted-foreground">.{cents}</span>}
    </div>
  );
}

function SummaryRow({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <div className={cn('font-num text-[15px] font-semibold', tone === undefined ? '' : changeColor(tone))}>{value}</div>
        <div className="mt-0.5 font-num text-[11px] text-muted-foreground">{detail}</div>
      </dd>
    </div>
  );
}

/**
 * The shell's tab row carries page identity now, so a route opens with its
 * explanatory line and its actions, not with a banner.
 */
function PageIntro({ description, action }: { eyebrow?: string; title?: string; description: string; action?: ReactNode }) {
  return (
    <header className="workbench-intro">
      <p className="workbench-lede">{description}</p>
      {action}
    </header>
  );
}

function PanelHeader({ title, id, detail, action }: { title: string; id?: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        {id ? <h2 id={id} className="text-sm font-semibold">{title}</h2> : <h2 className="text-sm font-semibold">{title}</h2>}
        {detail && <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function StateRow({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: 'ok' | 'warn' | 'bad' | 'info' }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'ok' ? 'text-gain' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-loss' : 'text-brand'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
          <span>{label}</span>
          <StatusBadge tone={tone} dot>{value}</StatusBadge>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function formatMonths(months: number | null) {
  if (months === null || !Number.isFinite(months)) return '待设置月定投';
  if (months < 12) return `${Math.max(0, Math.ceil(months))} 个月`;
  const years = Math.floor(months / 12);
  const remainder = Math.ceil(months % 12);
  return remainder === 0 ? `${years} 年` : `${years} 年 ${remainder} 个月`;
}

function DashboardLoading() {
  return (
    <div className="workbench-page" aria-label="正在加载总览" aria-busy="true">
      <div className="h-8 w-32 animate-pulse rounded bg-surface-elevated" />
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse bg-surface" />)}
      </div>
      <div className="h-80 animate-pulse rounded-lg border border-border bg-surface" />
    </div>
  );
}
