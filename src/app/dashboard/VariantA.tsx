import { Link } from 'react-router-dom';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Plus, Briefcase, Info, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { HoldingsList } from '@/components/HoldingsList';
import { TargetProgressRing } from '@/components/TargetProgressRing';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { usd, signedUsd, signedPct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DashboardModel } from './model';
import { EmptyDashboard, EquitySpark, Kicker, QuickActions } from './shared';

const ease = [0.16, 1, 0.3, 1] as const;

export function DashboardVariantA({ model }: { model: DashboardModel }) {
  const {
    positions, selectedBenchmark, quoteByTicker, quotesNone, quotesPartial, quotesError,
    cacheDirty, history, last, costBasisMode, aggregates, dayChangePct, totalReturnPct,
    target, annualRet, monthlyDca, monthsToTarget, xirr, portfolioCumulative,
    excessVsBenchmark, isEmpty,
  } = model;

  if (isEmpty) {
    return (
      <div className="container max-w-[1180px] px-4 py-6 sm:px-6">
        <EmptyDashboard />
      </div>
    );
  }

  const range = last ? `${history[0].date} — ${last.date}` : '—';

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
      className="container max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8"
    >
      {/* Masthead */}
      <motion.header
        variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } }}
        className="flex items-end justify-between gap-4 pb-4"
      >
        <Kicker index="01" en="Portfolio Report" zh="组合总览" />
        <div className="text-right">
          <div className="kicker">As of</div>
          <div className="font-num text-xs text-muted-foreground">{range}</div>
        </div>
      </motion.header>

      <div className="rule-top" />

      {/* Hero: oversized serif NAV + KPI column */}
      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="grid gap-x-10 gap-y-8 py-8 lg:grid-cols-[1.7fr_1fr]"
      >
        <div>
          <div className="flex items-center gap-2 kicker">
            净值 · Net Asset Value
            {cacheDirty && <StatusBadge tone="warn" dot>缓存待刷新</StatusBadge>}
          </div>
          <div className="font-serif-fig mt-2 text-[clamp(3rem,8vw,6rem)] font-semibold leading-[0.92] text-foreground">
            <AnimatedNumber value={aggregates.nav} format={(v) => usd.format(v)} duration={1.1} />
          </div>
          <div className="font-num mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px] text-muted-foreground">
            <span>持仓 <span className="text-foreground">{usd.format(aggregates.stockMv)}</span></span>
            <span>现金 <span className="text-foreground">{usd.format(aggregates.cash)}</span></span>
            <span>基准 <span className="text-foreground">{selectedBenchmark}</span></span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-1">
          <HeroKpi
            label="今日盈亏 · Today"
            value={signedUsd(aggregates.dayPL)}
            sub={Number.isFinite(dayChangePct) && aggregates.stockMv > 0 ? signedPct(dayChangePct) : '—'}
            tone={changeColor(aggregates.dayPL)}
          />
          <HeroKpi
            label="累计盈亏 · Total P/L"
            value={signedUsd(aggregates.totalPL)}
            sub={Number.isFinite(totalReturnPct) ? signedPct(totalReturnPct) : '—'}
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
        className="rule-top grid grid-cols-1 divide-y divide-border border-b border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
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
          en="Cumulative · TWR" zh="组合累计表现"
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
        className="grid gap-6 py-8 lg:grid-cols-3"
      >
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-end justify-between">
            <Kicker index="02" en="Performance" zh="业绩曲线" />
            <Button asChild variant="ghost" size="sm" className="shrink-0 text-brand">
              <Link to="/performance">查看完整 <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
          <EquitySpark history={history} colorVar="var(--brand)" height={260} gradientId="va-spark" />
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

      <div className="pt-6">
        <QuickActions accentClass="text-brand" />
      </div>
    </motion.div>
  );
}

function HeroKpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="kicker">{label}</div>
      <div className={cn('font-serif-fig mt-1.5 whitespace-nowrap text-[1.7rem] font-semibold leading-none sm:text-3xl', tone)}>{value}</div>
      <div className={cn('font-num mt-1 text-[11px]', tone)}>{sub}</div>
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
    <div className="px-1 py-5 sm:px-5">
      <div className="flex items-center gap-1.5">
        <div className="kicker">{en}</div>
        {infoTitle && infoBody && (
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
        )}
      </div>
      <div className="mt-0.5 text-[13px] font-medium text-muted-foreground">{zh}</div>
      <div className={cn('font-serif-fig mt-2 text-4xl font-semibold leading-none', tone)}>{value}</div>
      <div className="font-num mt-1.5 text-[11px] text-muted-foreground">{sub}</div>
      {infoOpen && infoTitle && infoBody && (
        <div className="mt-3 rounded-md border border-border bg-surface-elevated p-3 text-xs leading-5 text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">{infoTitle}</div>
          {infoBody}
        </div>
      )}
    </div>
  );
}
