import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layers, ArrowUpRight, Plus, Info, ShieldQuestion, Wifi, RefreshCw, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { useExposure } from '@/hooks/useExposure';
import type { LookThroughStock } from '@/lib/calc/lookThrough';
import { pct as fmtPct, usd } from '@/lib/format';
import { refreshEtfHoldings } from '@/lib/etfHoldings';
import { LOCAL_MODE } from '@/lib/localMode';

const ease = [0.16, 1, 0.3, 1] as const;

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
  const { lookThrough, asOf, sources, isFallback, isEmpty, model } = useExposure();
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: refreshEtfHoldings,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['etf_holdings'] }),
        queryClient.invalidateQueries({ queryKey: ['quotes'] }),
      ]);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['etf_holdings'] }),
        queryClient.refetchQueries({ queryKey: ['quotes'] }),
      ]);
    },
  });

  const topStocks = useMemo(() => lookThrough.stocks.slice(0, 14), [lookThrough.stocks]);
  const topStock = topStocks[0];

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

  const priceStale = model.quotesNone || model.quotesPartial || model.quotesError;
  const failedRefreshes = refresh.data?.results.filter((item) => item.status === 'failed') ?? [];

  if (isEmpty) {
    return (
      <div className="workbench-page">
        <EmptyState
          icon={Layers}
          title="还没有可穿透的持仓"
          description="先录入买入交易,这里会把每个 ETF 拆成底层股票,显示 NVDA 等单票的真实敞口。"
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
      className="workbench-page"
    >
      <motion.header
        variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } }}
        className="workbench-intro"
      >
        <div>
          <div className="workbench-eyebrow">Look-through exposure</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">穿透敞口</h1>
          <div className="mt-2 flex flex-wrap gap-2">
          {priceStale && (
            <StatusBadge tone="warn" dot>
              <Wifi className="h-3 w-3" /> 行情缺失·按成本估
            </StatusBadge>
          )}
          </div>
        </div>
        <div className="flex min-w-0 items-end gap-2">
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-1.5">
              <div className="kicker">成分表更新</div>
              {isFallback && <StatusBadge tone="warn">静态兜底</StatusBadge>}
            </div>
            <div className="max-w-[520px] truncate font-num text-[11px] text-muted-foreground" title={asOfText || undefined}>
              <span className="sm:hidden">{heldEtfCount > 0 ? `${heldEtfCount} 个 ETF 来源` : '—'}</span>
              <span className="hidden sm:inline">{asOfText || '—'}</span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || LOCAL_MODE}
            title={LOCAL_MODE ? '本地演示模式使用静态数据' : '获取官网完整成分和最新行情'}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />
            {refresh.isPending ? '刷新中' : '刷新敞口'}
          </Button>
        </div>
      </motion.header>

      {(refresh.isError || failedRefreshes.length > 0) && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <span>
            {refresh.isError
              ? `刷新失败：${(refresh.error as Error)?.message ?? '未知错误'}`
              : `部分刷新失败：${failedRefreshes.map((item) => item.ticker).join('、')}。已保留这些 ETF 的旧快照。`}
          </span>
        </div>
      )}

      <div className="rule-top" />

      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ExposureSummaryCard
          label="最大单票"
          value={topStock ? `${topStock.ticker} ${fmtPct(topStock.weightNav, 1)}` : '—'}
          sub={topStock ? `${usd.format(topStock.value)} · 占净值` : '无底层股票'}
        />
        <ExposureSummaryCard
          label="已穿透到个股"
          value={fmtPct(decomposedValue / nav, 1)}
          sub="ETF 成分 + 直接持股"
        />
        <ExposureSummaryCard
          label="未穿透长尾"
          value={fmtPct(lookThrough.unclassifiedValue / nav, 1)}
          sub="未列出的 ETF 小成分"
        />
        <ExposureSummaryCard
          label="现金 / 国债"
          value={fmtPct(lookThrough.cashValue / nav, 1)}
          sub="SGOV / BOXX 等不拆股"
        />
        <p className="sm:col-span-2 lg:col-span-4 flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          ETF 会按成分表拆到底层股票；现金替代和短债类 ETF 归入现金 / 国债；未覆盖的尾部成分单独列为未穿透长尾。
        </p>
      </motion.section>

      {/* 穿透权重 */}
      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="py-6"
      >
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="workbench-eyebrow">True per-stock weights</div>
            <h2 className="mt-1 text-lg font-semibold">穿透后单票权重</h2>
          </div>
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
        </div>

        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-3 border-b border-border bg-surface-elevated/50 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <div>代码</div>
            <div>来源构成(条长 = 占净值)</div>
            <div className="text-right">占净值</div>
          </div>
          <div className="divide-y divide-border">
            {topStocks.map((s, i) => (
              <StockRow key={s.ticker} stock={s} index={i} />
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
          {isFallback
            ? '当前使用内置静态成分表；其余归入未穿透长尾。上面三块加起来等于总净值。'
            : `当前使用官网完整成分快照；无法识别的现金、衍生品和权重残差归入未穿透长尾。${Object.values(sources).length > 0 ? ` 最近抓取 ${latestFetchedAt(sources)}。` : ''}`}
        </p>
      </motion.section>
    </motion.div>
  );
}

function latestFetchedAt(sources: Record<string, { fetchedAt: string | null }>): string {
  const latest = Object.values(sources).map((source) => source.fetchedAt).filter((value): value is string => !!value).sort().at(-1);
  return latest ? new Date(latest).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function StockRow({ stock, index }: { stock: LookThroughStock; index: number }) {
  const barWidthPct = Math.min(100, Math.max(2, stock.weightNav * 100));
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.025 }}
      className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-3 px-4 py-2.5"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{stock.ticker}</span>
      </div>
      <div className="min-w-0">
        <div
          className="flex h-3 overflow-hidden rounded-full bg-surface-elevated"
          style={{ width: `${barWidthPct}%`, minWidth: 18 }}
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

function ExposureSummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="kicker">{label}</div>
      <div className="font-num mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
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
      <div className="font-num mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{zh}</div>
    </div>
  );
}
