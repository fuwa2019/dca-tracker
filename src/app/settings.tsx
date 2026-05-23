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
      });
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('not_authed');
      const payload = {
        user_id: user.id,
        target_usd: Number(form.target_usd),
        expected_annual_ret: Number(form.expected_annual_ret) / 100,
        monthly_dca_usd: form.monthly_dca_usd ? Number(form.monthly_dca_usd) : null,
        email_enabled: form.email_enabled,
        email_to: form.email_to || null,
      };
      const { error } = await supabase.from('settings').upsert(payload);
      if (error) throw error;
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
          <CardDescription className="text-xs">浅色或深色主题。系统会在你下次打开时记住选择。</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">主题</div>
          <ThemeToggle />
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
