import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layers, ArrowUpRight, Plus, Gauge, Info, ShieldQuestion, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Kicker } from '@/components/Kicker';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { ExposureGauge } from '@/components/ExposureGauge';
import { useExposure } from '@/hooks/useExposure';
import { SHOVEL_TICKERS } from '@/lib/calc/exposureConfig';
import type { LookThroughStock } from '@/lib/calc/lookThrough';
import { pct as fmtPct } from '@/lib/format';

const ease = [0.16, 1, 0.3, 1] as const;
const SHOVEL_SET = new Set(SHOVEL_TICKERS.map((t) => t.toUpperCase()));

/**
 * 来源分段配色:刻意只用蓝/靛/紫/青系(避开盈亏的绿/红),
 * 直接持有用中性灰,和彩色 ETF 段区分开。
 */
const SOURCE_HUE: Record<string, number> = {
  VOO: 244,
  SMH: 199,
  VGT: 280,
  QQQM: 305,
  QQQ: 305,
};
/** 按来源名确定性取色,保证图例和条形分段永远一致;未知 ETF 落在蓝→品红安全带内。 */
function sourceColor(via: string): string {
  if (via === 'direct') return 'hsl(228 7% 55%)';
  let hue = SOURCE_HUE[via];
  if (hue == null) {
    let hash = 0;
    for (let i = 0; i < via.length; i += 1) hash = (hash * 31 + via.charCodeAt(i)) % 120;
    hue = 200 + hash; // 200..319,避开绿/红/琥珀
  }
  return `hsl(${hue} 60% 53%)`;
}
function sourceLabel(via: string): string {
  return via === 'direct' ? '直接持有' : via;
}

export function ExposurePage() {
  const { lookThrough, asOf, isEmpty, dashboard } = useExposure();

  const topStocks = useMemo(() => lookThrough.stocks.slice(0, 14), [lookThrough.stocks]);
  const maxWeight = topStocks[0]?.weightNav ?? 0.0001;

  const usedSources = useMemo(() => {
    const set = new Set<string>();
    for (const s of lookThrough.stocks) for (const src of s.sources) set.add(src.via);
    return [...set].sort((a, b) => (a === 'direct' ? 1 : 0) - (b === 'direct' ? 1 : 0) || a.localeCompare(b));
  }, [lookThrough.stocks]);

  // 三分法分母:已穿透到个股 + 未穿透长尾 + 现金国债 = 总净值。
  const nav = Math.max(lookThrough.totalNav, 1e-9);
  const decomposedValue = useMemo(
    () => lookThrough.stocks.reduce((acc, s) => acc + s.value, 0),
    [lookThrough.stocks],
  );

  // 只显示实际持有(命中)的 ETF 的成分表日期。
  const heldEtfCount = usedSources.filter((v) => v !== 'direct').length;
  const asOfText = usedSources
    .filter((v) => v !== 'direct' && asOf[v])
    .map((v) => `${v} ${asOf[v]}`)
    .join(' · ');

  const priceStale = dashboard.quotesNone || dashboard.quotesPartial || dashboard.quotesError;

  if (isEmpty) {
    return (
      <div className="container max-w-[1180px] px-4 py-6 sm:px-6">
        <EmptyState
          icon={Layers}
          title="还没有可穿透的持仓"
          description="先录入买入交易,这里会把每个 ETF 拆成底层股票,显示 NVDA 等单票的真实敞口与两条监控线。"
          action={<Button asChild size="sm"><Link to="/transactions"><Plus className="h-3.5 w-3.5" /> 添加交易</Link></Button>}
        />
      </div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
      className="container max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <motion.header
        variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } }}
        className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Kicker index="01" en="Look-through Exposure" zh="穿透敞口" />
          {priceStale && (
            <StatusBadge tone="warn" dot>
              <Wifi className="h-3 w-3" /> 行情缺失·按成本估
            </StatusBadge>
          )}
        </div>
        <div className="text-right">
          <div className="kicker">成分表更新</div>
          <div className="font-num text-[11px] text-muted-foreground">
            <span className="sm:hidden">{heldEtfCount > 0 ? `${heldEtfCount} 个 ETF 来源` : '—'}</span>
            <span className="hidden sm:inline">{asOfText || '—'}</span>
          </div>
        </div>
      </motion.header>

      <div className="rule-top" />

      {/* 两条监控线 */}
      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="py-6"
      >
        <div className="mb-3 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-brand" />
          <Kicker index="02" en="Monitoring lines" zh="两条监控线" />
        </div>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
          {lookThrough.lines.map((line) => (
            <div key={line.config.id} className="bg-surface px-4 py-5">
              <ExposureGauge line={line} />
            </div>
          ))}
        </div>
      </motion.section>

      {/* 穿透权重 */}
      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="rule-top py-6"
      >
        <div className="mb-3 flex items-end justify-between">
          <Kicker index="03" en="True per-stock weights" zh="穿透后单票权重" />
          <Button asChild variant="ghost" size="sm" className="shrink-0 text-brand">
            <Link to="/">回总览 <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </div>

        {/* 来源图例 */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {usedSources.map((via) => (
            <span key={via} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: sourceColor(via) }} />
              {sourceLabel(via)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-brand" />
            AI 铲子线成分
          </span>
        </div>

        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-3 border-b border-border bg-surface-elevated/50 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <div>代码</div>
            <div>来源构成(条长 = 占净值)</div>
            <div className="text-right">占净值</div>
          </div>
          <div className="divide-y divide-border">
            {topStocks.map((s, i) => (
              <StockRow key={s.ticker} stock={s} index={i} maxWeight={maxWeight} />
            ))}
          </div>
        </Card>

        {/* 三分法:三块加起来 = 总净值 100% */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FootStat label="已穿透到个股" zh="加总到底层股票" value={fmtPct(decomposedValue / nav, 1)} />
          <FootStat label="未穿透长尾" zh="ETF 未列出成分" value={fmtPct(lookThrough.unclassifiedValue / nav, 1)} icon={ShieldQuestion} />
          <FootStat label="现金 / 国债" zh="SGOV 等,不拆股" value={fmtPct(lookThrough.cashValue / nav, 1)} />
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          穿透基于一份手动维护的 ETF 成分股表,只取每只 ETF 的前若干大成分;其余归入「未穿透长尾」。上面三块加起来等于总净值。每季度核对一次即可,数值用于观察集中度趋势,非券商精确口径。
        </p>
      </motion.section>
    </motion.div>
  );
}

function StockRow({ stock, index, maxWeight }: { stock: LookThroughStock; index: number; maxWeight: number }) {
  const isShovel = SHOVEL_SET.has(stock.ticker);
  const barScale = stock.weightNav / Math.max(maxWeight, 1e-9);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.025 }}
      className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-3 px-4 py-2.5"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{stock.ticker}</span>
        {isShovel && (
          <span className="h-1.5 w-1.5 rounded-full bg-brand" title="AI 铲子线成分" aria-label="AI 铲子线成分" />
        )}
      </div>
      <div className="min-w-0">
        <div
          className="flex h-3 overflow-hidden rounded-full bg-surface-elevated"
          style={{ width: `${Math.max(6, barScale * 100)}%`, minWidth: 24 }}
        >
          {stock.sources.map((src) => (
            <div
              key={src.via}
              className="h-full"
              style={{
                width: `${(src.value / stock.value) * 100}%`,
                background: sourceColor(src.via),
              }}
              title={`${sourceLabel(src.via)} ${fmtPct(src.value / Math.max(stock.value, 1e-9), 0)}`}
            />
          ))}
        </div>
        {/* 触摸端没有 hover title,手机上把来源拆分用紧凑文字显示 */}
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground sm:hidden">
          {stock.sources.map((src) => (
            <span key={src.via} className="font-num">
              {sourceLabel(src.via)} {fmtPct(src.value / Math.max(stock.value, 1e-9), 0)}
            </span>
          ))}
        </div>
      </div>
      <div className="text-right font-num text-sm font-semibold tabular-nums">{fmtPct(stock.weightNav, 1)}</div>
    </motion.div>
  );
}

function FootStat({
  label,
  zh,
  value,
  icon: Icon,
}: {
  label: string;
  zh: string;
  value: string;
  icon?: typeof ShieldQuestion;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5 kicker">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="font-serif-fig mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{zh}</div>
    </div>
  );
}
