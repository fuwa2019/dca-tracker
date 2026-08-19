import { useMemo, type ReactNode } from 'react';
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
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HoldingsList } from '@/components/HoldingsList';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { signedPct, signedUsd, usd, usd0, changeColor } from '@/lib/format';
import { LEDGER_IMPORT_V2, LOCAL_MODE } from '@/lib/localMode';
import type { DashboardModel } from './model';

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

  const chartRows = useMemo(() => {
    const source = accountValueHistory.length > 1 ? accountValueHistory : history;
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
  }, [accountValueHistory, history]);

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
      <PageIntro
        eyebrow="Overview"
        title="组合总览"
        description="先看账户状态，再进入绩效、账本或数据修复。"
        action={(
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/health"><RefreshCw className="h-4 w-4" />数据健康</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/transactions"><FileUp className="h-4 w-4" />导入或录入</Link>
            </Button>
          </div>
        )}
      />

      <section className="workbench-metrics" aria-label="组合摘要">
        <Metric label="账户净值" value={usd0.format(aggregates.nav)} detail="持仓市值 + 现金" />
        <Metric label="今日盈亏" value={signedUsd(aggregates.dayPL)} detail={Number.isFinite(dayChangePct) ? signedPct(dayChangePct) : '—'} tone={aggregates.dayPL} />
        <Metric label="总收益" value={signedUsd(aggregates.totalPL)} detail={Number.isFinite(totalReturnPct) ? signedPct(totalReturnPct) : '—'} tone={aggregates.totalPL} />
        <Metric label="现金余额" value={usd.format(aggregates.cash)} detail={`${aggregates.nav > 0 ? ((aggregates.cash / aggregates.nav) * 100).toFixed(1) : '0.0'}% 净值`} />
      </section>

      <div className="workbench-grid">
        <section className="workbench-panel min-w-0" aria-labelledby="value-chart-title">
          <PanelHeader
            title="账户价值"
            id="value-chart-title"
            detail={dateRange}
            action={<Link className="workbench-link" to="/performance">查看完整绩效 <ArrowUpRight className="h-3.5 w-3.5" /></Link>}
          />
          {chartRows.length > 1 ? (
            <div className="mt-5 h-64 min-w-0 sm:h-72" role="img" aria-label={`账户价值曲线，${dateRange}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 8, right: 8, bottom: 2, left: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={36} />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickLine={false} axisLine={false} width={52} tickFormatter={(value: number) => usd0.format(value)} />
                  <Tooltip
                    cursor={{ stroke: 'hsl(var(--chart-1))', strokeDasharray: '3 3' }}
                    content={({ active, payload }) => active && payload?.[0]?.payload ? (
                      <div className="workbench-tooltip">
                        <div className="text-muted-foreground">{payload[0].payload.date}</div>
                        <div className="font-num mt-0.5 font-semibold">{usd.format(payload[0].payload.value)}</div>
                      </div>
                    ) : null}
                  />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'hsl(var(--chart-1))' }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="workbench-chart-empty">历史价格不足，完成数据修复后生成曲线。</div>
          )}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>累计 TWR <strong className={changeColor(portfolioCumulative)}>{signedPct(portfolioCumulative)}</strong></span>
            <span>超额 vs {selectedBenchmark} <strong className={changeColor(excessVsBenchmark)}>{signedPct(excessVsBenchmark)}</strong></span>
            <span>年化 XIRR <strong className={changeColor(xirr)}>{xirr === null ? '—' : signedPct(xirr)}</strong></span>
          </div>
        </section>

        <aside aria-label="账本与操作" className="space-y-4">
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

      <section aria-labelledby="holdings-title">
        <PanelHeader title="当前持仓" id="holdings-title" detail={`${positions.length} 个标的 · 成本口径 ${costBasisMode === 'fifo' ? 'FIFO' : 'AVG'}`} action={<Link className="workbench-link" to="/exposure">查看穿透敞口 <ArrowUpRight className="h-3.5 w-3.5" /></Link>} />
        <div className="mt-3">
          <HoldingsList positions={positions} quoteByTicker={quoteByTicker} totalMarketValue={aggregates.stockMv} basis={costBasisMode} />
        </div>
      </section>

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

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="workbench-intro">
      <div>
        <div className="workbench-eyebrow">{eyebrow}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
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

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: number }) {
  return (
    <div className="workbench-metric">
      <div className="workbench-eyebrow">{label}</div>
      <div className={`font-num mt-2 text-xl font-semibold sm:text-2xl ${tone === undefined ? 'text-foreground' : changeColor(tone)}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
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
