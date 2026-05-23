import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Beaker,
  ChevronDown,
  Database,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { useCashflows, useSettings, useTransactions } from '@/hooks/usePortfolio';
import { useDemoDcaData } from '@/hooks/useDemoDcaData';
import {
  usePerformanceCacheStatus,
  useRefreshPerformanceCache,
} from '@/hooks/usePerformanceCache';
import { aggregatePositions } from '@/lib/calc/position';
import { supabase } from '@/lib/supabase';
import { fetchHistory } from '@/lib/quote';
import { cn } from '@/lib/utils';
import type { Database as Db } from '@/lib/database.types';

type ShareRow = Db['public']['Tables']['share_links']['Row'];

type DailyPriceRow = {
  ticker: string;
  trade_date: string;
  close: number;
  adjusted_close: number | null;
  updated_at: string | null;
};

type Coverage = {
  ticker: string;
  points: number;
  adjustedPoints: number;
  firstDate: string | null;
  lastDate: string | null;
  updatedAt: string | null;
  status: 'ok' | 'warn' | 'bad';
  note: string;
};

export function DataHealthPage() {
  const qc = useQueryClient();
  const { data: txns = [], isLoading: txnsLoading } = useTransactions();
  const { data: cashflows = [], isLoading: cashLoading } = useCashflows();
  const { data: settings } = useSettings();

  const positions = useMemo(
    () => aggregatePositions(txns).filter((p) => p.shares > 1e-9),
    [txns],
  );
  const earliestDate = useMemo(() => {
    const cashDates = cashflows.map((c) => c.usd_in_date).filter((d): d is string => !!d);
    const tradeDates = txns.map((t) => t.trade_date);
    return [...cashDates, ...tradeDates].sort()[0] ?? null;
  }, [cashflows, txns]);
  const symbols = useMemo(
    () => [
      ...new Set([
        ...positions.map((p) => p.ticker),
        ...(settings?.watchlist ?? []),
        'SPY',
      ].map((s) => s.toUpperCase())),
    ].sort(),
    [positions, settings?.watchlist],
  );

  const cacheStatus = usePerformanceCacheStatus();
  const refreshCache = useRefreshPerformanceCache();

  const priceRows = useQuery<DailyPriceRow[]>({
    queryKey: ['price_coverage', symbols.join(','), earliestDate],
    enabled: symbols.length > 0,
    queryFn: async () => {
      let query = supabase
        .from('daily_prices')
        .select('ticker,trade_date,close,adjusted_close,updated_at')
        .in('ticker', symbols)
        .order('trade_date', { ascending: true });
      if (earliestDate) query = query.gte('trade_date', earliestDate);
      const { data, error } = await query;
      if (error) throw error;
      return (data as DailyPriceRow[]) ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const shareLinks = useQuery<ShareRow[]>({
    queryKey: ['share_links'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('share_links')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const coverage = useMemo(
    () => buildCoverage(symbols, priceRows.data ?? [], earliestDate),
    [symbols, priceRows.data, earliestDate],
  );

  const activeShares = (shareLinks.data ?? []).filter((s) => !s.revoked);
  const stalePrices = coverage.filter((c) => c.status !== 'ok');
  const adjustedMissing = coverage.filter((c) => c.points > 0 && c.adjustedPoints < c.points);
  const hasEvents = txns.length > 0 || cashflows.length > 0;
  const cacheDirty = cacheStatus.data?.dirty ?? false;
  const cacheExists = cacheStatus.data?.exists ?? false;

  const backfillPrices = useMutation({
    mutationFn: async () => {
      if (symbols.length === 0) return 0;
      const series = await fetchHistory(symbols, pickRange(earliestDate));
      return series.reduce((sum, s) => sum + (s.points?.length ?? 0), 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price_coverage'] });
      qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
    },
  });

  return (
    <div className="container max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 space-y-5">
      <header>
        <p className="text-xs text-muted-foreground">
          检查价格覆盖、业绩缓存、分享安全和计算输入状态。
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HealthTile
          icon={Activity}
          label="输入数据"
          value={hasEvents ? '可计算' : '缺数据'}
          tone={hasEvents ? 'ok' : 'bad'}
          detail={`${txns.length} 笔交易 · ${cashflows.length} 笔资金流`}
        />
        <HealthTile
          icon={Database}
          label="价格覆盖"
          value={stalePrices.length === 0 ? '正常' : `${stalePrices.length} 项需检查`}
          tone={stalePrices.length === 0 ? 'ok' : 'warn'}
          detail={`${coverage.reduce((sum, c) => sum + c.points, 0)} 个日线点`}
        />
        <HealthTile
          icon={TrendingUp}
          label="业绩缓存"
          value={!cacheExists ? '未初始化' : cacheDirty ? '待刷新' : '最新'}
          tone={!cacheExists ? 'warn' : cacheDirty ? 'warn' : 'ok'}
          detail={cacheStatus.data?.points ? `${cacheStatus.data.points} 个曲线点` : '暂无缓存'}
        />
        <HealthTile
          icon={ShieldCheck}
          label="分享安全"
          value={`${activeShares.length} 个有效`}
          tone="ok"
          detail={`${(shareLinks.data ?? []).length} 个总链接`}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">运维操作</CardTitle>
              <CardDescription className="text-xs">
                按顺序：先补价格，再刷缓存。处理完成后回到「业绩」页确认曲线。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => backfillPrices.mutate()}
                disabled={backfillPrices.isPending || symbols.length === 0}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', backfillPrices.isPending && 'animate-spin')} />
                补齐日线价格
              </Button>
              <Button
                size="sm"
                onClick={() => refreshCache.mutate()}
                disabled={refreshCache.isPending || !hasEvents}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refreshCache.isPending && 'animate-spin')} />
                刷新业绩缓存
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <StatusLine label="最早计算日期" value={earliestDate ?? '暂无'} />
          <StatusLine label="缓存更新时间" value={formatDateTime(cacheStatus.data?.updated_at)} />
          <StatusLine
            label="最近刷新耗时"
            value={cacheStatus.data?.refresh_ms != null ? `${cacheStatus.data.refresh_ms} ms` : '暂无'}
          />
          <StatusLine
            label="缓存错误"
            value={cacheStatus.data?.error ?? '无'}
            tone={cacheStatus.data?.error ? 'bad' : 'ok'}
          />
          <StatusLine
            label="复权价覆盖"
            value={adjustedMissing.length === 0 ? '完整' : `${adjustedMissing.length} 个 ticker 缺复权价`}
            tone={adjustedMissing.length === 0 ? 'ok' : 'warn'}
          />
          <StatusLine label="监控代码" value={symbols.join(', ') || '暂无'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">价格覆盖</CardTitle>
          <CardDescription className="text-xs">
            历史业绩曲线优先用 adjusted close（总回报口径）；缺失时回退 close。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:px-5 sm:pb-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-elevated/50 text-muted-foreground">
                  <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider">Ticker</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider">点数</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider">复权覆盖</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider">起始</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider">最新</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider">状态</th>
                </tr>
              </thead>
              <tbody>
                {coverage.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      还没有监控代码 — 录入交易后会自动开始监控。
                    </td>
                  </tr>
                ) : (
                  coverage.map((c) => (
                    <tr key={c.ticker} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium">{c.ticker}</td>
                      <td className="px-4 py-2.5 text-right tnum">{c.points}</td>
                      <td className="px-4 py-2.5 text-right tnum">
                        {c.points > 0 ? `${Math.round((c.adjustedPoints / c.points) * 100)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 tnum text-muted-foreground">{c.firstDate ?? '—'}</td>
                      <td className="px-4 py-2.5 tnum text-muted-foreground">{c.lastDate ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge tone={toStatusTone(c.status)} dot>
                          {c.note}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">分享链接审计</CardTitle>
          <CardDescription className="text-xs">
            分享页只读公开收益率曲线和持仓比例，不返回金额、现金流或交易明细。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(shareLinks.data ?? []).length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="还没有分享链接"
              description="在「设置」里生成第一个只读链接。"
            />
          ) : (
            (shareLinks.data ?? []).map((s) => (
              <div
                key={s.token}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs',
                  s.revoked && 'opacity-60',
                )}
              >
                <code className="min-w-0 flex-1 truncate font-mono">
                  {maskToken(s.token)}
                </code>
                <StatusBadge tone={s.revoked ? 'neutral' : 'ok'} dot>
                  {s.revoked ? '已撤销' : '有效'}
                </StatusBadge>
                <span className="text-muted-foreground tnum">访问 {s.access_count ?? 0} 次</span>
                <span className="text-muted-foreground tnum">最近 {formatDateTime(s.last_accessed_at)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <DemoDataPanel />

      {(txnsLoading || cashLoading || priceRows.isLoading || cacheStatus.isLoading) && (
        <p className="text-xs text-muted-foreground">正在读取数据健康状态…</p>
      )}
    </div>
  );
}

function HealthTile({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
}) {
  const toneClass: Record<StatusTone, string> = {
    ok: 'text-gain',
    warn: 'text-warn',
    bad: 'text-loss',
    info: 'text-brand',
    neutral: 'text-foreground',
  };
  const iconBg: Record<StatusTone, string> = {
    ok: 'bg-gain-soft',
    warn: 'bg-warn-soft',
    bad: 'bg-loss-soft',
    info: 'bg-brand-soft',
    neutral: 'bg-surface-elevated text-muted-foreground',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconBg[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={cn('mt-0.5 truncate text-base font-semibold', toneClass[tone])}>{value}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground tnum">{detail}</div>
        </div>
      </div>
    </Card>
  );
}

function StatusLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const toneClass: Record<NonNullable<typeof tone>, string> = {
    ok: 'text-gain',
    warn: 'text-warn',
    bad: 'text-loss',
  };
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate text-sm font-medium tnum', tone && toneClass[tone])}>{value}</div>
    </div>
  );
}

function DemoDataPanel() {
  const demo = useDemoDcaData();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-elevated text-muted-foreground">
            <Beaker className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-medium">测试数据</div>
            <div className="text-[11px] text-muted-foreground">
              生成 10 年 QQQ 月定投，便于与 IBKR 对照曲线。会写真实数据库行，可一键清除。
            </div>
          </div>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={demo.seed} disabled={demo.busy}>
              {demo.seeding ? '生成中…' : '生成 10 年定投'}
            </Button>
            <Button size="sm" variant="outline" onClick={demo.clear} disabled={demo.busy}>
              {demo.clearing ? '清除中…' : '清除测试数据'}
            </Button>
            {demo.message && (
              <span className="text-xs text-muted-foreground">{demo.message}</span>
            )}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            操作会触发缓存重算，可能需要几秒。完成后到「业绩」页查看曲线。
          </p>
        </div>
      )}
    </Card>
  );
}

function buildCoverage(
  symbols: string[],
  rows: DailyPriceRow[],
  earliestDate: string | null,
): Coverage[] {
  const today = new Date().toISOString().slice(0, 10);
  const freshEnough = addDays(today, -10);
  const byTicker = new Map<string, DailyPriceRow[]>();
  for (const row of rows) {
    const list = byTicker.get(row.ticker) ?? [];
    list.push(row);
    byTicker.set(row.ticker, list);
  }
  return symbols.map((ticker) => {
    const list = (byTicker.get(ticker) ?? []).sort((a, b) =>
      a.trade_date.localeCompare(b.trade_date),
    );
    const first = list[0]?.trade_date ?? null;
    const last = list[list.length - 1]?.trade_date ?? null;
    const adjustedPoints = list.filter((r) => Number(r.adjusted_close) > 0).length;
    const updatedAt = list.reduce<string | null>((latest, row) => {
      if (!row.updated_at) return latest;
      return !latest || row.updated_at > latest ? row.updated_at : latest;
    }, null);
    let status: Coverage['status'] = 'ok';
    let note = '正常';
    if (list.length === 0) {
      status = 'bad';
      note = '缺价格';
    } else if (earliestDate && first && first > addDays(earliestDate, 7)) {
      status = 'bad';
      note = '起始覆盖不足';
    } else if (last && last < freshEnough) {
      status = 'warn';
      note = '价格偏旧';
    } else if (adjustedPoints < list.length) {
      status = 'warn';
      note = '缺复权价';
    }
    return {
      ticker,
      points: list.length,
      adjustedPoints,
      firstDate: first,
      lastDate: last,
      updatedAt,
      status,
      note,
    };
  });
}

function pickRange(earliestDate: string | null) {
  if (!earliestDate) return '10y';
  const earliest = new Date(earliestDate + 'T00:00:00Z').getTime();
  const days = (Date.now() - earliest) / 86_400_000;
  if (days <= 30) return '3mo';
  if (days <= 90) return '6mo';
  if (days <= 200) return '1y';
  if (days <= 500) return '2y';
  if (days <= 1500) return '5y';
  return '10y';
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

function toStatusTone(status: 'ok' | 'warn' | 'bad'): StatusTone {
  if (status === 'ok') return 'ok';
  if (status === 'warn') return 'warn';
  return 'bad';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '暂无';
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}

function maskToken(token: string) {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
