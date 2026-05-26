import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Copy, Trash2, Plus, LogOut, Check, ShieldCheck, Mail } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { StatusBadge } from '@/components/StatusBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { EmptyState } from '@/components/EmptyState';
import { useSettings } from '@/hooks/usePortfolio';
import { useAuth, signOut } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { searchSymbols, type SymbolSearchResult } from '@/lib/quote';
import { DEFAULT_BENCHMARKS, DEFAULT_WATCHLIST, getBenchmarks, getSelectedBenchmark, splitTickers } from '@/lib/settings';
import { cn } from '@/lib/utils';
import type { Database } from '@/lib/database.types';

type ShareRow = Database['public']['Tables']['share_links']['Row'];

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const [form, setForm] = useState({
    target_usd: '1000000',
    expected_annual_ret: '8',
    monthly_dca_usd: '',
    email_enabled: true,
    email_to: '',
    cost_basis_default: 'avg' as 'avg' | 'fifo',
    watchlist: 'VOO,QQQM,SMH',
    benchmarks: DEFAULT_BENCHMARKS.join(','),
    selected_benchmark: DEFAULT_BENCHMARKS[0],
  });
  const [savedFlash, setSavedFlash] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setForm({
        target_usd: String(settings.target_usd),
        expected_annual_ret: String(Number(settings.expected_annual_ret) * 100),
        monthly_dca_usd: settings.monthly_dca_usd ? String(settings.monthly_dca_usd) : '',
        email_enabled: settings.email_enabled,
        email_to: settings.email_to ?? '',
        cost_basis_default: (settings.cost_basis_default as 'avg' | 'fifo') ?? 'avg',
        watchlist: (settings.watchlist ?? DEFAULT_WATCHLIST).join(','),
        benchmarks: getBenchmarks(settings).join(','),
        selected_benchmark: getSelectedBenchmark(settings),
      });
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('not_authed');
      const watchlist = splitTickers(form.watchlist, DEFAULT_WATCHLIST);
      const benchmarks = splitTickers(form.benchmarks, DEFAULT_BENCHMARKS);
      const selectedBenchmark = benchmarks.includes(form.selected_benchmark.toUpperCase())
        ? form.selected_benchmark.toUpperCase()
        : benchmarks[0] ?? 'SPY';
      const payload = {
        user_id: user.id,
        target_usd: Number(form.target_usd),
        expected_annual_ret: Number(form.expected_annual_ret) / 100,
        monthly_dca_usd: form.monthly_dca_usd ? Number(form.monthly_dca_usd) : null,
        email_enabled: form.email_enabled,
        email_to: form.email_to || null,
        cost_basis_default: form.cost_basis_default,
        watchlist,
        benchmarks,
        selected_benchmark: selectedBenchmark,
      };
      const { error } = await supabase.from('settings').upsert(payload);
      if (!error) return;
      if (!/benchmarks|selected_benchmark|schema cache|column/i.test(error.message ?? '')) throw error;
      const { benchmarks: _benchmarks, selected_benchmark: _selected, ...legacyPayload } = payload;
      const retry = await supabase.from('settings').upsert(legacyPayload);
      if (retry.error) throw retry.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    },
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
  });

  const createShare = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('not_authed');
      const token = randomToken();
      const { error } = await supabase.from('share_links').insert({ token, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['share_links'] }),
  });

  const revokeShare = useMutation({
    mutationFn: async (token: string) => {
      const { error } = await supabase.from('share_links').update({ revoked: true }).eq('token', token);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['share_links'] }),
  });

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="container max-w-3xl px-4 py-5 sm:px-6 sm:py-6 space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">目标与定投</CardTitle>
          <CardDescription className="text-xs">用于 $1M 进度环和入金提醒邮件</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="target">目标金额 (USD)</Label>
            <Input id="target" type="number" inputMode="decimal" value={form.target_usd} onChange={(e) => setForm((f) => ({ ...f, target_usd: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ret">预期年化 (%)</Label>
            <Input id="ret" type="number" step="0.1" inputMode="decimal" value={form.expected_annual_ret} onChange={(e) => setForm((f) => ({ ...f, expected_annual_ret: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dca">月定投 (USD)</Label>
            <Input id="dca" type="number" step="0.01" inputMode="decimal" value={form.monthly_dca_usd} onChange={(e) => setForm((f) => ({ ...f, monthly_dca_usd: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">邮件提醒</CardTitle>
          <CardDescription className="text-xs">每月第一个美股交易日前一天 11:00（北京）提醒入金</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="email-on" className="cursor-pointer">启用提醒</Label>
            </div>
            <Switch id="email-on" checked={form.email_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, email_enabled: v }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail">收件邮箱</Label>
            <Input id="mail" type="email" value={form.email_to} onChange={(e) => setForm((f) => ({ ...f, email_to: e.target.value }))} placeholder="you@gmail.com" />
            <p className="text-[11px] text-muted-foreground">建议 Gmail / iCloud / Outlook（Resend 直发可达）</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">持仓与自选</CardTitle>
          <CardDescription className="text-xs">控制盈亏计算口径、首页自选股和业绩基准</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="costBasis">成本口径</Label>
            <select
              id="costBasis"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.cost_basis_default}
              onChange={(e) => setForm((f) => ({ ...f, cost_basis_default: e.target.value as 'avg' | 'fifo' }))}
            >
              <option value="avg">平均成本 (AVG)</option>
              <option value="fifo">先进先出 (FIFO)</option>
            </select>
            <p className="text-[11px] text-muted-foreground">AVG 按持仓均价；FIFO 按最早买入批次</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="watchlist">自选股</Label>
            <Input
              id="watchlist"
              value={form.watchlist}
              onChange={(e) => setForm((f) => ({ ...f, watchlist: e.target.value }))}
              placeholder="VOO,QQQM,SMH"
            />
            <p className="text-[11px] text-muted-foreground">逗号分隔，保存时自动大写去重</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>业绩基准</Label>
            <BenchmarkManager
              benchmarks={splitTickers(form.benchmarks, DEFAULT_BENCHMARKS)}
              selected={form.selected_benchmark}
              onChange={(benchmarks, selected) => {
                setForm((f) => ({
                  ...f,
                  benchmarks: benchmarks.join(','),
                  selected_benchmark: selected,
                }));
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? '保存中…' : '保存设置'}
        </Button>
        {savedFlash && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="inline-flex items-center gap-1 text-xs text-gain"
          >
            <Check className="h-3.5 w-3.5" /> 已保存
          </motion.span>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">分享链接</CardTitle>
              <CardDescription className="text-xs">
                只读视图 · 显示持仓权重 % 和收益率 %，永远不会暴露金额、CNY 和现金流。
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => createShare.mutate()} disabled={createShare.isPending}>
              <Plus className="h-3.5 w-3.5" /> 生成新链接
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gain" />
            <p className="text-muted-foreground">
              对方只能看见持仓 ticker、占比、收益率 % 和基准比较图。USD 金额、入金、汇兑损耗、个别交易都被服务端脱敏。
            </p>
          </div>
          {(shareLinks.data ?? []).length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="还没有分享链接"
              description="点上方按钮生成一个 32 位 hex token，分享地址会立即显示在这里。"
            />
          ) : (
            <div className="space-y-2">
              {(shareLinks.data ?? []).map((s) => {
                const url = `${baseUrl}/share/${s.token}`;
                const copied = copiedToken === s.token;
                return (
                  <div
                    key={s.token}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs',
                      s.revoked && 'opacity-60',
                    )}
                  >
                    <code className="min-w-0 flex-1 truncate font-mono text-foreground">
                      /share/{maskToken(s.token)}
                    </code>
                    <StatusBadge tone={s.revoked ? 'neutral' : 'ok'} dot>
                      {s.revoked ? '已撤销' : '有效'}
                    </StatusBadge>
                    <span className="hidden text-[11px] text-muted-foreground tnum sm:inline">
                      访问 {s.access_count ?? 0} 次
                    </span>
                    <span className="hidden text-[11px] text-muted-foreground tnum sm:inline">
                      最近 {formatRelative(s.last_accessed_at)}
                    </span>
                    {!s.revoked ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={async () => {
                            await navigator.clipboard.writeText(url);
                            setCopiedToken(s.token);
                            setTimeout(() => setCopiedToken(null), 1200);
                          }}
                          title="复制完整链接"
                        >
                          {copied ? <Check className="h-3.5 w-3.5 text-gain" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-loss"
                          onClick={() => revokeShare.mutate(s.token)}
                          title="撤销"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">不可访问</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">外观</CardTitle>
          <CardDescription className="text-xs">默认跟随系统，也可以手动固定浅色或深色。</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">主题</div>
          <ThemeToggle compact={false} />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-muted-foreground truncate">登录身份：{user?.email ?? '—'}</div>
        <Button variant="ghost" size="sm" onClick={() => signOut()}>
          <LogOut className="h-4 w-4" />退出登录
        </Button>
      </div>
    </div>
  );
}

function BenchmarkManager({
  benchmarks,
  selected,
  onChange,
}: {
  benchmarks: string[];
  selected: string;
  onChange: (benchmarks: string[], selected: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const safeSelected = benchmarks.includes(selected) ? selected : benchmarks[0] ?? 'SPY';

  async function runSearch() {
    const q = query.trim().toUpperCase();
    if (!q) return;
    setSearching(true);
    try {
      const next = await searchSymbols(q);
      setResults(next.length > 0 ? next : [{ symbol: q, name: '手动添加', exchange: null, type: null }]);
    } finally {
      setSearching(false);
    }
  }

  function add(symbol: string) {
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) return;
    const next = benchmarks.includes(ticker) ? benchmarks : [...benchmarks, ticker];
    onChange(next, ticker);
    setQuery('');
    setResults([]);
  }

  function remove(symbol: string) {
    const next = benchmarks.filter((b) => b !== symbol);
    const fallback = next.length > 0 ? next : DEFAULT_BENCHMARKS;
    onChange(fallback, safeSelected === symbol ? fallback[0] : safeSelected);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-elevated/40 p-3">
      <div className="flex flex-wrap gap-2">
        {benchmarks.map((ticker) => (
          <div
            key={ticker}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors',
              safeSelected === ticker
                ? 'border-brand/50 bg-brand/10 text-foreground'
                : 'border-border bg-surface text-muted-foreground hover:text-foreground',
            )}
          >
            <button type="button" onClick={() => onChange(benchmarks, ticker)}>
              {ticker}
            </button>
            {ticker !== 'SPY' && (
              <button
                type="button"
                className="text-muted-foreground hover:text-loss"
                onClick={() => remove(ticker)}
                aria-label={`删除 ${ticker}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              runSearch();
            }
          }}
          placeholder="搜索 ETF / 股票，例如 QQQ"
        />
        <Button type="button" variant="outline" size="sm" onClick={runSearch} disabled={searching || !query.trim()}>
          {searching ? '搜索中' : '搜索'}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((row) => (
            <button
              key={`${row.symbol}-${row.exchange ?? ''}`}
              type="button"
              onClick={() => add(row.symbol)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-xs hover:bg-surface"
            >
              <span className="min-w-0">
                <span className="font-semibold">{row.symbol}</span>
                <span className="ml-2 text-muted-foreground">{row.name}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{row.exchange ?? row.type ?? ''}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] leading-5 text-muted-foreground">
        当前选中的基准会用于业绩曲线和分享页。新增基准后到「数据健康」补齐日线价格并刷新缓存。
      </p>
    </div>
  );
}

function maskToken(token: string) {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function formatRelative(value: string | null | undefined) {
  if (!value) return '未访问';
  try {
    const d = new Date(value);
    const diff = Date.now() - d.getTime();
    const minutes = Math.round(diff / 60_000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days} 天前`;
    return d.toLocaleDateString('zh-CN');
  } catch {
    return value;
  }
}
