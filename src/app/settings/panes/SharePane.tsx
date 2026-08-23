import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { LOCAL_MODE } from '@/lib/localMode';
import { localShareLinks } from '@/lib/localData';
import { cn } from '@/lib/utils';
import type { Database } from '@/lib/database.types';
import { SettingsPaneHeader } from '../components';

type ShareRow = Database['public']['Tables']['share_links']['Row'];

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function SharePane() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const shareLinks = useQuery<ShareRow[]>({
    queryKey: ['share_links'],
    queryFn: async () => {
      if (LOCAL_MODE) return localShareLinks;
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
      if (LOCAL_MODE) return;
      if (!user) throw new Error('not_authed');
      const token = randomToken();
      const { error } = await supabase.from('share_links').insert({ token, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['share_links'] }),
  });

  const revokeShare = useMutation({
    mutationFn: async (token: string) => {
      if (LOCAL_MODE) return;
      const { error } = await supabase.from('share_links').update({ revoked: true }).eq('token', token);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['share_links'] }),
  });

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const links = shareLinks.data ?? [];

  return (
    <div className="space-y-5">
      <SettingsPaneHeader
        heading="分享链接"
        text={
          LOCAL_MODE
            ? '本地 Debug 模式使用固定 demo 分享链接，不创建线上 token。'
            : '只读视图 · 显示持仓权重 % 和收益率 %，永远不会暴露金额、CNY 和现金流。'
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gain" />
        <p className="text-muted-foreground">
          对方只能看见持仓 ticker、占比、收益率 % 和基准比较图。USD 金额、入金、汇兑损耗、个别交易都被服务端脱敏。
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base">已生成的链接</CardTitle>
              <CardDescription className="text-xs">撤销后地址立即失效，已发出的链接也一并作废</CardDescription>
            </div>
            <Button size="sm" onClick={() => createShare.mutate()} disabled={LOCAL_MODE || createShare.isPending}>
              <Plus className="h-3.5 w-3.5" /> 生成新链接
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={LOCAL_MODE ? '本地模式不生成分享链接' : '还没有分享链接'}
              description={
                LOCAL_MODE
                  ? '本地 demo 链接会固定展示在这里，用来调试只读分享界面。'
                  : '点上方按钮生成一个 32 位 hex token，分享地址会立即显示在这里。'
              }
            />
          ) : (
            <div className="space-y-2">
              {links.map((s) => {
                const url = `${baseUrl}/share/${s.token}`;
                const copied = copiedToken === s.token;
                return (
                  <div
                    key={s.token}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-xs',
                      s.revoked ? 'bg-surface-elevated' : 'bg-surface',
                    )}
                  >
                    <code
                      className={cn(
                        'min-w-0 flex-1 truncate font-mono',
                        s.revoked ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
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
                          aria-label={`复制 /share/${maskToken(s.token)} 的完整链接`}
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
                          aria-label={`撤销 /share/${maskToken(s.token)} 分享链接`}
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
