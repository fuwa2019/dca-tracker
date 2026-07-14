import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  Briefcase,
  Database,
  Info,
  LineChart,
  Plus,
  TrendingDown,
  TrendingUp,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { HoldingsList } from '@/components/HoldingsList';
import { TargetProgressRing } from '@/components/TargetProgressRing';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { TxnForm } from '@/components/TxnForm';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { usd, usd0, signedUsd, signedPct, pct as fmtPct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import { unrealizedPL } from '@/lib/calc/position';
import { computeLookThrough, type EtfHoldingsData, type LookThroughStock } from '@/lib/calc/lookThrough';
import { LOCAL_MODE } from '@/lib/localMode';
import { availableRanges, sliceByRange, type RangeKey } from '@/lib/calc/history';
import etfHoldings from '@/data/etf-holdings.json';
import type { DashboardModel } from './model';
import { EmptyDashboard, EquitySpark, Kicker } from './shared';

const ease = [0.16, 1, 0.3, 1] as const;
const HOLDINGS = etfHoldings as unknown as EtfHoldingsData;

const SECTOR_BY_TICKER: Record<string, string> = {
  NVDA: 'AI 芯片',
  AMD: 'AI 芯片',
  AVGO: 'AI 芯片',
  TSM: '半导体',
  MU: '半导体',
  INTC: '半导体',
  ASML: '半导体',
  LRCX: '半导体',
  KLAC: '半导体',
  TXN: '半导体',
  AMAT: '半导体',
  QCOM: '半导体',
  MRVL: '半导体',
  ADI: '半导体',
  CDNS: '半导体软件',
  SNPS: '半导体软件',
  AAPL: '大型科技',
  MSFT: '大型科技',
  GOOGL: '大型科技',
  GOOG: '大型科技',
  META: '大型科技',
  ORCL: '企业软件',
  CSCO: '企业软件',
  PLTR: '企业软件',
  AMZN: '消费与互联网',
  TSLA: '消费与互联网',
  NFLX: '消费与互联网',
  'BRK.B': '金融',
  JPM: '金融',
  V: '金融',
  LLY: '医疗',
  JNJ: '医疗',
  XOM: '能源',
  WMT: '消费防御',
  COST: '消费防御',
  SGOV: '现金 / 国债',
};

const DISTRIBUTION_COLOR_BY_LABEL: Record<string, string> = {
  '半导体': '#22c55e',
  'AI 芯片': '#3b82f6',
  '半导体软件': '#06b6d4',
  '大型科技': '#ef476f',
  '企业软件': '#8b5cf6',
  '消费与互联网': '#f97316',
  '消费防御': '#eab308',
  '金融': '#14b8a6',
  '医疗': '#ec4899',
  '能源': '#a3a3a3',
  '现金 / 国债': '#7c3aed',
  '其他板块': '#f59e0b',
  '其他股票': '#64748b',
};

export function DashboardVariantA({ model }: { model: DashboardModel }) {
  const {
    positions, selectedBenchmark, quoteByTicker, quotesNone, quotesPartial, quotesError,
    cacheDirty, history, accountValueHistory, last, costBasisMode, aggregates, dayChangePct, totalReturnPct,
    target, annualRet, monthlyDca, monthsToTarget, xirr, portfolioCumulative,
    excessVsBenchmark, isEmpty,
  } = model;
  const [chartMode, setChartMode] = useState<'value' | 'return'>('value');
  const [chartRange, setChartRange] = useState<RangeKey>('ALL');

  const dateRange = last ? `${history[0].date} — ${last.date}` : '—';
  const ranges = useMemo(() => availableRanges(history), [history]);
  const effectiveRange = ranges.includes(chartRange) ? chartRange : (ranges[ranges.length - 1] ?? 'ALL');
  const chartHistory = useMemo(
    () => sliceByRange(chartMode === 'value' ? accountValueHistory : history, effectiveRange),
    [chartMode, accountValueHistory, history, effectiveRange],
  );
  const chartModeHint = chartMode === 'value'
    ? '目标资产美元规模：买入会抬高曲线；现金、SGOV 等短债不计为买入。'
    : '组合表现：剔除买入影响，适合和 SPY 比较。';
  const movers = useMemo(() => {
    const rows = positions
      .map((p) => {
        const q = quoteByTicker.get(p.ticker);
        const changePct = q?.changePct ?? null;
        const changeUsd = q?.change != null ? p.shares * q.change : null;
        return { ticker: p.ticker, changePct, changeUsd };
      })
      .filter((r) => r.changePct !== null && Number.isFinite(r.changePct));
    return {
      winners: rows.filter((r) => (r.changePct ?? 0) > 0).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 3),
      losers: rows.filter((r) => (r.changePct ?? 0) < 0).sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 3),
      hasQuotes: rows.length > 0,
    };
  }, [positions, quoteByTicker]);
  const lookThrough = useMemo(
    () =>
      computeLookThrough({
        holdings: positions.map((p) => {
          const q = quoteByTicker.get(p.ticker);
          const { marketValue } = unrealizedPL(p, q?.price ?? null, costBasisMode);
          return { ticker: p.ticker, value: marketValue };
        }),
        uninvestedCash: aggregates.cash,
        data: HOLDINGS,
        lines: [],
      }),
    [positions, quoteByTicker, costBasisMode, aggregates.cash],
  );
  const distribution = useMemo(() => {
    const bySector = new Map<string, number>();
    const add = (label: string, value: number) => {
      if (value <= 0) return;
      bySector.set(label, (bySector.get(label) ?? 0) + value);
    };
    for (const stock of lookThrough.stocks) {
      add(SECTOR_BY_TICKER[stock.ticker] ?? '其他股票', stock.value);
    }
    add('现金 / 国债', lookThrough.cashValue);
    // 这是板块视图，不把 ETF 未列出的剩余成分暴露为内部术语「未穿透」。
    // 它们的具体板块未知，因此诚实归入「其他板块」。
    add('其他板块', lookThrough.unclassifiedValue);
    return [...bySector.entries()]
      .map(([label, value]) => ({ label, value, color: DISTRIBUTION_COLOR_BY_LABEL[label] ?? '#64748b' }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [lookThrough.stocks, lookThrough.cashValue, lookThrough.unclassifiedValue]);
  const distributionTotal = useMemo(
    () => distribution.reduce((sum, row) => sum + row.value, 0),
    [distribution],
  );
  const lookThroughTop = useMemo(() => lookThrough.stocks.slice(0, 6), [lookThrough.stocks]);

  if (isEmpty) {
    return (
      <div className="container max-w-[1180px] px-4 py-6 sm:px-6">
        <EmptyDashboard />
      </div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
      className="container max-w-[1180px] overflow-x-hidden px-3 py-3 sm:px-6 sm:py-6 lg:px-8"
    >
      {/* Masthead */}
      <motion.header
        variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } }}
        className="flex flex-col items-start gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between sm:pb-4"
      >
        <Kicker index="01" en="Portfolio Report" zh="组合总览" />
        <div className="flex w-full flex-col items-start gap-2 text-left sm:w-auto sm:items-end sm:text-right">
          <div className="kicker">Period</div>
          <div className="font-num text-xs text-muted-foreground">{dateRange}</div>
          <DashboardActionBar cacheDirty={cacheDirty} quotesStale={quotesNone || quotesPartial || quotesError} />
        </div>
      </motion.header>

      {LOCAL_MODE && (
        <motion.div
          variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease } } }}
          className="mb-4 rounded-lg border border-brand/25 bg-brand/10 px-3 py-2 text-xs text-muted-foreground sm:mb-5"
        >
          <span className="font-medium text-brand">本地 Debug 版</span>
          <span className="ml-2 sm:hidden">10 年 QQQ demo · 本地内存</span>
          <span className="ml-2 hidden sm:inline">免邮箱登录，使用内置 10 年 QQQ 派生 demo 数据；交易只写入浏览器内存，不连接 Supabase。</span>
        </motion.div>
      )}

      <div className="rule-top" />

      {/* Hero: oversized serif NAV + KPI column */}
      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="grid gap-x-10 gap-y-4 py-4 sm:gap-y-6 sm:py-6 lg:grid-cols-[1.45fr_1fr]"
      >
        <div>
          <div className="flex items-center gap-2 kicker">
            持仓市值 · Portfolio Value
            {cacheDirty && <StatusBadge tone="warn" dot>缓存待刷新</StatusBadge>}
          </div>
          <div className="font-serif-fig mt-2 break-all text-[clamp(3.2rem,16vw,4.4rem)] font-semibold leading-[0.92] text-foreground lg:text-[clamp(2.75rem,8vw,6rem)]">
            <AnimatedNumber value={aggregates.stockMv} format={(v) => usd0.format(v)} duration={1.1} />
          </div>
          <div className="font-num mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground sm:mt-4 sm:text-[13px]">
            <span>资产 <span className="text-foreground">{positions.length} 个</span></span>
            <span>基准 <span className="text-foreground">{selectedBenchmark}</span></span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px self-start overflow-hidden rounded-2xl border border-border bg-border min-[360px]:grid-cols-2">
          <HeroKpi
            label="今日盈亏 · Today"
            value={signedUsd(aggregates.dayPL)}
            sub={Number.isFinite(dayChangePct) && aggregates.stockMv > 0 ? signedPct(dayChangePct) : '—'}
            tone={changeColor(aggregates.dayPL)}
          />
          <HeroKpi
            label="未实现盈亏 · Unrealized"
            value={signedUsd(aggregates.unrealizedPL)}
            sub={Number.isFinite(aggregates.unrealizedPL / Math.max(aggregates.costBasis, 1e-9)) ? signedPct(aggregates.unrealizedPL / Math.max(aggregates.costBasis, 1e-9)) : '—'}
            tone={changeColor(aggregates.unrealizedPL)}
          />
          <HeroKpi
            label="已实现盈亏 · Realized"
            value={signedUsd(aggregates.realizedPL)}
            sub="已卖出部分"
            tone={changeColor(aggregates.realizedPL)}
          />
          <HeroKpi
            label="总收益 · Total P/L"
            value={signedUsd(aggregates.totalPL)}
            sub={Number.isFinite(totalReturnPct) ? `简单总回报 ${signedPct(totalReturnPct)}` : '—'}
            tone={changeColor(aggregates.totalPL)}
          />
        </div>
      </motion.section>

      {(quotesNone || quotesPartial || quotesError) && (
        <Card className="mb-6 flex items-start gap-3 border-warn/30 bg-warn/5 p-3 text-sm">
          <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {quotesError ? '行情接口异常' : quotesNone ? '行情未连接' : '部分行情缺失'}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {quotesError ? '行情接口请求失败，请检查网络或稍后重试。'
                : quotesNone ? '未配置 Quote Worker 地址，当前按成本价估算。'
                  : '部分持仓现价缺失，相关盈亏可能按成本估算，请稍后刷新。'}
            </p>
          </div>
        </Card>
      )}

      {/* Three editorial metrics across a ruled row */}
      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="rule-top grid grid-cols-1 divide-y divide-border border-b border-border min-[360px]:grid-cols-3 min-[360px]:divide-x min-[360px]:divide-y-0"
      >
        <EditorialMetric
          en="Annualized · XIRR" zh="年化收益"
          value={xirr !== null ? signedPct(xirr) : '—'}
          tone={xirr === null ? '' : xirr >= 0 ? 'text-gain' : 'text-loss'}
          sub={xirr !== null ? '唯一年化主指标' : '至少需 2 笔不同日期入金'}
          infoTitle="XIRR 年化收益"
          infoBody="按你的实际入金时间、金额和当前账户净值计算的资金加权年化收益。越早投入的资金权重越高，适合回答“我的钱实际赚了多少年化”。"
        />
        <EditorialMetric
          en="Cumulative · TWR" zh="时间加权累计"
          value={signedPct(portfolioCumulative)}
          tone={portfolioCumulative >= 0 ? 'text-gain' : 'text-loss'}
          sub={last ? `${history[0].date} 至 ${last.date}` : '录入后显示'}
          infoTitle="TWR 累计收益"
          infoBody="时间加权收益会尽量剥离追加入金和取出的影响，按每日收益连续链接，适合看交易和持仓本身的表现，也用于和基准曲线比较。组合和基准都使用复权日线作为总回报 proxy，能近似纳入分红再投资影响，但不是券商精确口径。"
        />
        <EditorialMetric
          en={`Excess vs ${selectedBenchmark}`} zh="超额收益"
          value={signedPct(excessVsBenchmark)}
          tone={changeColor(excessVsBenchmark)}
          sub={`组合 − ${selectedBenchmark} 同期`}
        />
      </motion.section>

      {/* Performance + target */}
      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="grid gap-5 py-6 sm:gap-6 sm:py-8 lg:grid-cols-3"
      >
        <div className="lg:col-span-2">
          <div className="mb-3 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Kicker index="02" en="Performance" zh="业绩曲线" />
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <SegmentedControl
                value={chartMode}
                onChange={(v) => setChartMode(v as 'value' | 'return')}
                options={[
                  { value: 'value', label: '价值' },
                  { value: 'return', label: '表现' },
                ]}
                size="sm"
                name="dashboard-chart-mode"
                ariaLabel="选择首页曲线模式"
              />
              {ranges.length > 1 && (
                <SegmentedControl
                  value={effectiveRange}
                  onChange={(v) => setChartRange(v as RangeKey)}
                  options={ranges.map((r) => ({ value: r, label: r === 'ALL' ? 'All' : r }))}
                  size="sm"
                  name="dashboard-chart-range"
                  ariaLabel="选择首页曲线时间段"
                />
              )}
              <Button asChild variant="ghost" size="sm" className="hidden shrink-0 text-brand sm:inline-flex">
                <Link to="/performance">查看完整业绩 <ArrowUpRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </div>
          <EquitySpark history={chartHistory} colorVar="var(--brand)" height={230} gradientId="va-spark" mode={chartMode} />
          <div className="font-num mt-1 text-[11px] text-muted-foreground">{chartModeHint}</div>
        </div>
        <div>
          <div className="mb-3">
            <Kicker index="03" en="Milestone · $1M" zh="百万进度" />
          </div>
          <Card className="flex flex-col items-center p-5">
            <TargetProgressRing
              current={aggregates.nav}
              target={target}
              monthsToTarget={monthsToTarget}
              size={196}
              strokeWidth={12}
            />
            <div className="font-num mt-3 text-[11px] text-muted-foreground">
              {(annualRet * 100).toFixed(0)}% 年化 · 月供 {usd.format(monthlyDca)}
            </div>
          </Card>
        </div>
      </motion.section>

      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="grid gap-3 pb-6 sm:gap-6 sm:pb-8 lg:grid-cols-3"
      >
        <DailyMovers title="每日赢家" icon={TrendingUp} rows={movers.winners} hasQuotes={movers.hasQuotes} />
        <DailyMovers title="每日输家" icon={TrendingDown} rows={movers.losers} hasQuotes={movers.hasQuotes} />
        <DistributionPanel rows={distribution} total={distributionTotal} assetCount={positions.length} />
      </motion.section>

      {/* Holdings */}
      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
      >
        <div className="mb-3 flex items-end justify-between">
          <Kicker index="04" en="Holdings" zh="当前持仓" />
          <Button asChild variant="ghost" size="sm" className="shrink-0 text-brand">
            <Link to="/transactions">全部交易 <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </div>
        {positions.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="还没有持仓"
            description="去「交易」录入第一笔买入，持仓会自动出现在这里。"
            action={<Button asChild size="sm"><Link to="/transactions"><Plus className="h-3.5 w-3.5" /> 添加交易</Link></Button>}
          />
        ) : (
          <HoldingsList
            positions={positions}
            quoteByTicker={quoteByTicker}
            totalMarketValue={aggregates.stockMv}
            basis={costBasisMode}
          />
        )}
      </motion.section>

      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="pt-8"
      >
        <div className="mb-3 flex items-end justify-between">
          <Kicker index="05" en="Look-through" zh="穿透敞口" />
          <Button asChild variant="ghost" size="sm" className="shrink-0 text-brand">
            <Link to="/exposure">展开穿透 <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </div>
        <LookThroughPanel rows={lookThroughTop} totalNav={lookThrough.totalNav} unclassifiedValue={lookThrough.unclassifiedValue} />
      </motion.section>

    </motion.div>
  );
}

function DashboardActionBar({ cacheDirty, quotesStale }: { cacheDirty: boolean; quotesStale: boolean }) {
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const maintenanceLabel = cacheDirty ? '刷新缓存' : quotesStale ? '补齐价格' : '数据维护';
  const maintenanceShortLabel = cacheDirty ? '刷新' : quotesStale ? '补价' : '维护';
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
      <Dialog open={tradeOpen} onOpenChange={setTradeOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            onClick={() => setTradeSide('buy')}
            className="min-w-0 w-full px-2 shadow-none sm:px-3"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sm:hidden">添加</span>
            <span className="hidden sm:inline">添加交易</span>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tradeSide === 'sell' ? '新增卖出' : '新增买入'}</DialogTitle>
            <DialogDescription>
              {LOCAL_MODE ? '本地 Debug 模式只写入浏览器内存。' : '录入买入或卖出后会刷新持仓和业绩缓存。'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={tradeSide === 'buy' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTradeSide('buy')}
            >
              买入
            </Button>
            <Button
              type="button"
              variant={tradeSide === 'sell' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTradeSide('sell')}
            >
              卖出
            </Button>
          </div>
          <TxnForm defaultSide={tradeSide} defaultTicker="QQQ" onDone={() => setTradeOpen(false)} />
        </DialogContent>
      </Dialog>

      <Button asChild variant={cacheDirty || quotesStale ? 'default' : 'outline'} size="sm" className="min-w-0 w-full px-2 shadow-none sm:px-3">
        <Link to="/health">
          <Database className="h-3.5 w-3.5" />
          <span className="sm:hidden">{maintenanceShortLabel}</span>
          <span className="hidden sm:inline">{maintenanceLabel}</span>
        </Link>
      </Button>
    </div>
  );
}

function DailyMovers({
  title,
  icon: Icon,
  rows,
  hasQuotes,
}: {
  title: string;
  icon: LucideIcon;
  rows: Array<{ ticker: string; changePct: number | null; changeUsd: number | null }>;
  hasQuotes: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-brand" />
          {title}
        </div>
        <div className="text-[10px] text-muted-foreground">今日报价</div>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
          {hasQuotes ? (title === '每日赢家' ? '今日暂无上涨持仓' : '今日暂无下跌持仓') : '暂无今日行情'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={`${title}-${row.ticker}`} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="font-semibold">{row.ticker}</div>
              <div className="text-right">
                <div className={cn('font-num text-sm font-semibold', changeColor(row.changePct))}>
                  {row.changePct !== null ? signedPct(row.changePct) : '—'}
                </div>
                <div className={cn('font-num text-[10px]', changeColor(row.changeUsd))}>
                  {row.changeUsd !== null ? signedUsd(row.changeUsd) : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DistributionPanel({
  rows,
  total,
  assetCount,
}: {
  rows: Array<{ label: string; value: number; color: string }>;
  total: number;
  assetCount: number;
}) {
  let cursor = 0;
  const stops = rows.map((row) => {
    const pct = total > 0 ? row.value / total : 0;
    const start = cursor;
    cursor += pct * 100;
    return `${row.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  const donutBackground = stops.length > 0 ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(#e5e7eb 0% 100%)';

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LineChart className="h-4 w-4 text-brand" />
          组合分布
        </div>
        <div className="text-[10px] text-muted-foreground">板块</div>
      </div>
      <div className="grid grid-cols-[112px_1fr] items-center gap-3 sm:grid-cols-[132px_1fr] sm:gap-4">
        <div
          className="relative mx-auto h-28 w-28 rounded-full sm:h-32 sm:w-32"
          style={{ background: donutBackground }}
          aria-label="组合分布环形图"
        >
          <div className="absolute inset-[24px] flex flex-col items-center justify-center rounded-full bg-surface sm:inset-[27px]">
            <div className="font-serif-fig text-2xl font-semibold">{assetCount}</div>
            <div className="text-[10px] text-muted-foreground">总资产</div>
          </div>
        </div>
        <div className="space-y-2">
        {rows.map((row) => {
          const weight = total > 0 ? row.value / total : 0;
          return (
            <div key={row.label} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="font-num font-medium">{fmtPct(weight, 1)}</span>
              </div>
              <div className="font-num ml-3.5 mt-0.5 text-[10px] text-muted-foreground">{usd.format(row.value)}</div>
            </div>
          );
        })}
        {rows.some((row) => row.label === '其他板块') && (
          <div className="pt-0.5 text-[10px] text-muted-foreground">其他板块为 ETF 成分表未列出的剩余持仓。</div>
        )}
        </div>
      </div>
    </Card>
  );
}

function LookThroughPanel({
  rows,
  totalNav,
  unclassifiedValue,
}: {
  rows: LookThroughStock[];
  totalNav: number;
  unclassifiedValue: number;
}) {
  return (
    <Card className="p-4">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          暂无可穿透的持仓
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <div key={row.ticker} className="rounded-lg border border-border bg-surface-elevated px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="kicker">{row.sources[0]?.via === 'direct' ? 'DIRECT' : `VIA ${row.sources[0]?.via}`}</div>
                  <div className="mt-1 text-sm font-semibold">{row.ticker}</div>
                </div>
                <div className="font-serif-fig text-2xl font-semibold text-brand">{fmtPct(row.weightNav, 1)}</div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.min(100, Math.max(2, row.weightNav * 100))}%` }}
                />
              </div>
              <div className="font-num mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                <span>{usd.format(row.value)}</span>
                <span>占净值</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="font-num mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
        <span>总净值 {usd.format(totalNav)}</span>
        {unclassifiedValue > 0 && <span>未穿透长尾 {usd.format(unclassifiedValue)}</span>}
      </div>
    </Card>
  );
}

function HeroKpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  const mobileLabel = label.split(' · ')[0] || label;
  return (
    <div className="min-w-0 bg-surface px-3 py-3 sm:px-5 sm:py-4">
      <div className="kicker leading-4">
        <span className="sm:hidden">{mobileLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </div>
      <div className={cn('font-serif-fig mt-1.5 truncate text-[1.06rem] font-semibold leading-none min-[360px]:text-[1.12rem] min-[400px]:text-[1.2rem] sm:text-3xl', tone)}>{value}</div>
      <div className={cn('font-num mt-1 truncate text-[11px]', tone)}>{sub}</div>
    </div>
  );
}

function EditorialMetric({
  en,
  zh,
  value,
  tone,
  sub,
  infoTitle,
  infoBody,
}: {
  en: string;
  zh: string;
  value: string;
  tone: string;
  sub: string;
  infoTitle?: string;
  infoBody?: string;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div className="grid min-w-0 grid-rows-[2.45rem_auto] px-2.5 py-3 sm:grid-rows-none sm:px-5 sm:py-5">
      <div className="relative flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="kicker truncate">{en}</div>
          <div className="mt-0.5 truncate text-[12px] font-medium text-muted-foreground sm:text-[13px]">{zh}</div>
        </div>
        {infoTitle && infoBody && (
          <>
            <button
              type="button"
              aria-label={`查看${infoTitle}说明`}
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((v) => !v)}
              className={cn(
                'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground',
                infoOpen && 'border-brand/40 text-brand',
              )}
            >
              <Info className="h-3 w-3" />
            </button>
            {infoOpen && (
              <div className="absolute left-0 top-7 z-20 w-[min(20rem,calc(100vw-2rem))] rounded-md border border-border bg-surface-elevated p-3 text-xs leading-5 text-muted-foreground shadow-lg">
                <div className="mb-1 font-medium text-foreground">{infoTitle}</div>
                {infoBody}
              </div>
            )}
          </>
        )}
      </div>
      <div className={cn('font-serif-fig self-start whitespace-nowrap text-[clamp(1rem,4.7vw,1.24rem)] font-semibold leading-none sm:mt-2 sm:text-4xl', tone)}>{value}</div>
      <div className="font-num mt-1.5 hidden truncate text-[10px] text-muted-foreground sm:block sm:text-[11px]">{sub}</div>
    </div>
  );
}
