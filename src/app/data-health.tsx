import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, Database, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCashflows, useSettings, useTransactions } from '@/hooks/usePortfolio';
import { aggregatePositions } from '@/lib/calc/position';
import { supabase } from '@/lib/supabase';
import { fetchHistory } from '@/lib/quote';
import { cn } from '@/lib/utils';
import type { Database as Db, PerformanceCacheStatus } from '@/lib/database.types';

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

  const positions = useMemo(() => aggregatePositions(txns).filter((p) => p.shares > 1e-9), [txns]);
  const earliestDate = useMemo(() => {
    const cashDates = cashflows.map((c) => c.usd_in_date).filter((d): d is string => !!d);
    const tradeDates = txns.map((t) => t.trade_date);
    return [...cashDates, ...tradeDates].sort()[0] ?? null;
  }, [cashflows, txns]);
  const symbols = useMemo(
    () => [...new Set([...positions.map((p) => p.ticker), ...(settings?.watchlist ?? []), 'SPY'].map((s) => s.toUpperCase()))].sort(),
    [positions, settings?.watchlist],
  );

  const cacheStatus = useQuery<PerformanceCacheStatus | null>({
    queryKey: ['performance_cache_status'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('performance_cache_status');
      if (error) {
        if (isMissingRpc(error)) return null;
        throw error;
      }
      if (!data || 'error' in data) return null;
      return data as PerformanceCacheStatus;
    },
    staleTime: 60_000,
  });

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
      const { data, error } = await supabase.from('share_links').select('*').order('created_at', { ascending: false });
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

  const refreshCache = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('refresh_performance_history_cache');
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
    },
  });

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
    <div className="container max-w-[1460px] py-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight">数据健康</h1>
        <p className="mt-1 text-xs text-muted-foreground">检查价格覆盖、业绩缓存、分享安全和计算输入状态。</p>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-4">
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
          value={!cacheStatus.data ? '未初始化' : cacheDirty ? '待刷新' : '最新'}
          tone={!cacheStatus.data || cacheDirty ? 'warn' : 'ok'}
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
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>操作</CardTitle>
              <CardDescription>补价格、刷新缓存、验证分享视图前先从这里看状态。</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => backfillPrices.mutate()} disabled={backfillPrices.isPending || symbols.length === 0}>
                <RefreshCw className={cn('h-4 w-4', backfillPrices.isPending && 'animate-spin')} />
                补齐日线价格
              </Button>
              <Button size="sm" onClick={() => refreshCache.mutate()} disabled={refreshCache.isPending || !hasEvents}>
                <RefreshCw className={cn('h-4 w-4', refreshCache.isPending && 'animate-spin')} />
                刷新业绩缓存
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <StatusLine label="最早计算日期" value={earliestDate ?? '暂无'} />
          <StatusLine label="缓存更新时间" value={formatDateTime(cacheStatus.data?.updated_at)} />
          <StatusLine label="最近刷新耗时" value={cacheStatus.data?.refresh_ms != null ? `${cacheStatus.data.refresh_ms} ms` : '暂无'} />
          <StatusLine label="缓存错误" value={cacheStatus.data?.error ?? '无'} tone={cacheStatus.data?.error ? 'bad' : 'ok'} />
          <StatusLine label="复权价覆盖" value={adjustedMissing.length === 0 ? '完整' : `${adjustedMissing.length} 个 ticker 缺复权价`} tone={adjustedMissing.length === 0 ? 'ok' : 'warn'} />
          <StatusLine label="监控代码" value={symbols.join(', ') || '暂无'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>价格覆盖</CardTitle>
          <CardDescription>历史业绩曲线优先使用 adjusted close；缺失时回退 close。</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="py-2 text-left font-medium">Ticker</th>
                <th className="py-2 text-right font-medium">点数</th>
                <th className="py-2 text-right font-medium">复权覆盖</th>
                <th className="py-2 text-left font-medium">起始</th>
                <th className="py-2 text-left font-medium">最新</th>
                <th className="py-2 text-left font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((c) => (
                <tr key={c.ticker} className="border-b last:border-0">
                  <td className="py-2 font-medium">{c.ticker}</td>
                  <td className="py-2 text-right tnum">{c.points}</td>
                  <td className="py-2 text-right tnum">{c.points > 0 ? `${Math.round((c.adjustedPoints / c.points) * 100)}%` : '-'}</td>
                  <td className="py-2 tnum">{c.firstDate ?? '-'}</td>
                  <td className="py-2 tnum">{c.lastDate ?? '-'}</td>
                  <td className={cn('py-2', toneClass(c.status))}>{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>分享链接审计</CardTitle>
          <CardDescription>分享页只读公开收益率曲线和持仓比例，不返回金额与现金流。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(shareLinks.data ?? []).map((s) => (
            <div key={s.token} className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs', s.revoked && 'opacity-50')}>
              <code className="min-w-0 flex-1 truncate font-mono">{s.token}</code>
              <span>{s.revoked ? '已撤销' : '有效'}</span>
              <span className="text-muted-foreground">访问 {s.access_count ?? 0} 次</span>
              <span className="text-muted-foreground">最近 {formatDateTime(s.last_accessed_at)}</span>
            </div>
          ))}
          {shareLinks.data?.length === 0 && <p className="text-sm text-muted-foreground">还没有分享链接</p>}
        </CardContent>
      </Card>

      {(txnsLoading || cashLoading || priceRows.isLoading || cacheStatus.isLoading) && (
        <p className="text-xs text-muted-foreground">正在读取数据健康状态...</p>
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
  tone: 'ok' | 'warn' | 'bad';
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={cn('font-semibold', toneClass(tone))}>{value}</div>
          <div className="truncate text-xs text-muted-foreground">{detail}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusLine({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate font-medium', tone && toneClass(tone))}>{value}</div>
    </div>
  );
}

function buildCoverage(symbols: string[], rows: DailyPriceRow[], earliestDate: string | null): Coverage[] {
  const today = new Date().toISOString().slice(0, 10);
  const freshEnough = addDays(today, -10);
  const byTicker = new Map<string, DailyPriceRow[]>();
  for (const row of rows) {
    const list = byTicker.get(row.ticker) ?? [];
    list.push(row);
    byTicker.set(row.ticker, list);
  }
  return symbols.map((ticker) => {
    const list = (byTicker.get(ticker) ?? []).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
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
    return { ticker, points: list.length, adjustedPoints, firstDate: first, lastDate: last, updatedAt, status, note };
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

function toneClass(tone: 'ok' | 'warn' | 'bad') {
  if (tone === 'ok') return 'text-success';
  if (tone === 'warn') return 'text-warning';
  return 'text-danger';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '暂无';
  return new Date(value).toLocaleString();
}

function isMissingRpc(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || /function .* does not exist|could not find .* function/i.test(error.message ?? '');
}
