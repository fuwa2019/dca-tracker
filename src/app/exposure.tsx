import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layers, ArrowUpRight, Plus, Info, Wifi, RefreshCw, TriangleAlert, ChevronDown } from '@/components/icons';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { useExposure } from '@/hooks/useExposure';
import type { LookThroughStock } from '@/lib/calc/lookThrough';
import { pct as fmtPct, usd } from '@/lib/format';
import { refreshEtfHoldings } from '@/lib/etfHoldings';
import { LOCAL_MODE } from '@/lib/localMode';
import { useEnterMotion } from '@/hooks/useEnterMotion';
import { exposureBarCutoff } from '@/lib/exposureDisplay';

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
  const maxWeight = topStock?.weightNav ?? 0;
  const [trackNode, setTrackNode] = useState<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ width: 320, barLimit: 6 });
  useEffect(() => {
    if (!trackNode) return;
    const desktop = window.matchMedia('(min-width: 640px)');
    const measure = () => {
      const width = trackNode.getBoundingClientRect().width;
      const barLimit = desktop.matches ? 8 : 6;
      setLayout((previous) => previous.width === width && previous.barLimit === barLimit ? previous : { width, barLimit });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(trackNode);
    desktop.addEventListener('change', measure);
    measure();
    return () => {
      observer.disconnect();
      desktop.removeEventListener('change', measure);
    };
  }, [trackNode]);
  const cutoff = exposureBarCutoff(topStocks.map((stock) => stock.weightNav), layout.width, layout.barLimit);
  const barStocks = topStocks.filter((stock) => stock.weightNav >= cutoff);
  const numericStocks = topStocks.filter((stock) => stock.weightNav < cutoff);
  const barWeight = barStocks.reduce((sum, stock) => sum + stock.weightNav, 0);
  const numericWeight = numericStocks.reduce((sum, stock) => sum + stock.weightNav, 0);

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
  const asOfEntries = usedSources
    .filter((v) => v !== 'direct' && asOf[v])
    .map((v) => `${v} ${asOf[v]}`);
  const asOfText = asOfEntries.join(' · ');

  const priceStale = model.quotesNone || model.quotesPartial || model.quotesError;
  const failedRefreshes = refresh.data?.results.filter((item) => item.status === 'failed') ?? [];
  const fallbackRefreshes = refresh.data?.results.filter((item) => item.mode === 'static-fallback') ?? [];

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
          {/* TODO: concentration monitor lines (per-stock caps) are a separate
              product decision; the page shows weights only until then. */}
          <p className="workbench-lede">看穿 ETF 成分，得到真实的单票权重。</p>
          {priceStale && (
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge tone="warn" dot>
                <Wifi className="h-3 w-3" /> 行情缺失·按成本估
              </StatusBadge>
            </div>
          )}
        </div>
        <div className="flex min-w-0 items-end justify-between gap-3 sm:justify-end sm:gap-2">
          <div className="min-w-0 sm:text-right">
            <div className="flex items-center gap-1.5 sm:justify-end">
              <div className="kicker">成分表更新</div>
              {isFallback && <StatusBadge tone="warn">静态兜底</StatusBadge>}
            </div>
            {/* Phones wrap per source instead of truncating, so every ETF's
                snapshot date stays visible. */}
            <div className="mt-0.5 max-w-[520px] font-num text-[11px] text-muted-foreground sm:mt-0 sm:truncate" title={asOfText || undefined}>
              {asOfEntries.length > 0
                ? asOfEntries.map((entry, i) => (
                    <Fragment key={entry}>{i > 0 && ' · '}<span className="whitespace-nowrap">{entry}</span></Fragment>
                  ))
                : heldEtfCount > 0 ? `${heldEtfCount} 个 ETF 来源` : '—'}
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

      {!refresh.isError && failedRefreshes.length === 0 && fallbackRefreshes.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <span>
            {fallbackRefreshes.map((item) => `${item.ticker}${item.asOf ? `（截至 ${item.asOf}）` : ''}`).join('、')}
            {' '}已采用官方静态快照；替代数据源暂不可用或数据过旧，本次仍已完成可用快照更新。
          </span>
        </div>
      )}

      <div className="rule-top" />

      <motion.section
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}
        className="grid gap-5 border-b border-border py-5 sm:grid-cols-[1fr_2fr] sm:gap-8"
      >
        <div>
          <div className="kicker">最大单票 · 占总净值</div>
          <div className="mt-1 font-num text-2xl font-semibold">
            {topStock ? <><span className="mr-3 text-sm">{topStock.ticker}</span>{fmtPct(topStock.weightNav, 1)}</> : '—'}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{topStock ? usd.format(topStock.value) : '无底层股票'}</div>
        </div>
        <div>
          <div className="kicker">资产穿透覆盖</div>
          <div className="my-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-elevated" aria-hidden="true">
            <div className="bg-brand/80" style={{ width: `${Math.max(0, decomposedValue / nav * 100)}%` }} />
            <div className="bg-muted-foreground/60" style={{ width: `${Math.max(0, lookThrough.unclassifiedValue / nav * 100)}%` }} />
            <div className="bg-muted-foreground/25" style={{ width: `${Math.max(0, lookThrough.cashValue / nav * 100)}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
            <div>已穿透到个股 <strong className="inline-block font-num text-foreground">{fmtPct(decomposedValue / nav, 1)}</strong></div>
            <div>未穿透长尾 <strong className="inline-block font-num text-foreground">{fmtPct(lookThrough.unclassifiedValue / nav, 1)}</strong></div>
            <div>现金 / 国债 <strong className="inline-block font-num text-foreground">{fmtPct(lookThrough.cashValue / nav, 1)}</strong></div>
          </div>
        </div>
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
          <Button asChild variant="ghost" size="sm" className="hidden shrink-0 text-brand lg:inline-flex">
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

        {topStocks.length > 0 && <p className="mb-3 text-xs text-muted-foreground">重点 {barStocks.length} 只占 {fmtPct(barWeight, 1)}，其余 {numericStocks.length} 只占 {fmtPct(numericWeight, 1)}。</p>}
        <Card className="relative overflow-hidden p-0">
          <div aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 sm:grid-cols-[120px_minmax(0,1fr)_100px] sm:gap-x-5">
            <span />
            <div ref={setTrackNode} className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1" />
            <span />
          </div>
          {barStocks.length > 0 && <>
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-elevated/50 px-4 py-3 text-xs">
              <span className="font-medium">主要敞口 · {barStocks.length} 只</span>
              <span className="font-num text-muted-foreground">合计 {fmtPct(barWeight, 1)}</span>
            </div>
            <div className="divide-y divide-border" data-exposure-bars>
              {barStocks.map((stock, i) => <StockRow key={stock.ticker} stock={stock} index={i} maxWeight={maxWeight} nav={nav} />)}
            </div>
          </>}
          {numericStocks.length > 0 && <>
            <div className="flex items-center justify-between gap-3 border-y border-border bg-surface-elevated/50 px-4 py-3 text-xs">
              <span className="font-medium">数字列表 · {numericStocks.length} 只</span>
              <span className="font-num text-muted-foreground">合计 {fmtPct(numericWeight, 1)}</span>
            </div>
            <div className="grid grid-cols-2 items-start" data-exposure-numbers>
              {numericStocks.map((stock, i) => <StockRow key={stock.ticker} stock={stock} index={i + barStocks.length} maxWeight={maxWeight} nav={nav} numeric />)}
            </div>
          </>}
          {topStocks.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">当前没有可展示的底层个股，资产构成见上方摘要。</p>}
        </Card>
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
          右侧百分比为占总净值的真实权重。颜色区分持有来源，点击任一行查看来源贡献。
          {lookThrough.stocks.length > topStocks.length && <> 当前列表最多展示前 {topStocks.length} 大敞口；其他已穿透个股合计 {fmtPct((decomposedValue - topStocks.reduce((sum, stock) => sum + stock.value, 0)) / nav, 1)}。</>}
        </p>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {isFallback
            ? '当前使用内置静态成分表；其余归入未穿透长尾。'
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

function StockRow({ stock, index, maxWeight, nav, numeric = false }: { stock: LookThroughStock; index: number; maxWeight: number; nav: number; numeric?: boolean }) {
  const [open, setOpen] = useState(false);
  const enter = useEnterMotion();
  const barWidthPct = maxWeight > 0 ? Math.min(100, Math.max(0, stock.weightNav / maxWeight * 100)) : 0;
  return (
    <motion.div
      {...enter({ opacity: 0, y: 4 }, { delay: index * 0.025 })}
      animate={{ opacity: 1, y: 0 }}
      className={numeric ? `min-w-0 border-b border-border ${open ? 'col-span-2' : 'odd:border-r'}` : undefined}
    >
      <details className="group" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className={`cursor-pointer list-none items-center px-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden ${numeric ? 'flex justify-between gap-2' : 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 sm:grid-cols-[120px_minmax(0,1fr)_100px] sm:gap-x-5'}`}>
          <span className="flex min-w-0 items-center gap-2">
            {!numeric && <span className="w-4 shrink-0 font-num text-[10px] text-muted-foreground" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>}
            <span className={`break-all font-semibold ${numeric ? 'text-xs' : ''}`}>{stock.ticker}</span>
          </span>
          {!numeric && <div className="col-span-2 row-start-2 h-2.5 min-w-0 overflow-hidden rounded bg-surface-elevated sm:col-span-1 sm:col-start-2 sm:row-start-1" aria-hidden="true">
            <div className="flex h-full overflow-hidden rounded" style={{ width: `${barWidthPct}%` }}>
              {stock.sources.map((src) => (
                <div
                  key={src.via}
                  className="h-full"
                  style={{ width: `${src.value / Math.max(stock.value, 1e-9) * 100}%`, background: sourceColor(src.via) }}
                />
              ))}
            </div>
          </div>}
          <span className={`col-start-2 row-start-1 flex shrink-0 items-center justify-end font-num font-semibold tabular-nums sm:col-start-3 ${numeric ? 'gap-1 text-xs' : 'gap-3 text-sm'}`}>
            <span><span className="sr-only">占总净值 </span>{fmtPct(stock.weightNav, 1)}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-open:rotate-180" />
          </span>
        </summary>
        <div className={`mx-4 mb-4 rounded-lg bg-surface-elevated/50 px-3 py-3 ${numeric ? '' : 'sm:ml-[156px]'}`}>
          <p className="mb-2 text-[11px] text-muted-foreground">各来源对总净值的贡献 · 合计 {fmtPct(stock.weightNav, 2)}</p>
          <dl className="space-y-2 text-xs">
            {stock.sources.map((src) => (
              <div key={src.via} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: sourceColor(src.via) }} aria-hidden="true" />{sourceLabel(src.via)}</dt>
                <dd className="font-num tabular-nums">{fmtPct(src.value / nav, 2)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </motion.div>
  );
}
