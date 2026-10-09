import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Check, Copy, Plus, ShieldCheck, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { LOCAL_MODE } from '@/lib/localMode';
import { localShareLinks } from '@/lib/localData';
import { cn } from '@/lib/utils';
import type { Database, ShareScope } from '@/lib/database.types';
import { SettingsPaneHeader } from '../components';

type ShareRow = Database['public']['Tables']['share_links']['Row'];

const SCOPE_LABEL: Record<ShareScope, string> = { report: '报告视图', full: '完整只读' };
const SCOPE_OPTIONS = [
  { value: 'report' as const, label: SCOPE_LABEL.report },
  { value: 'full' as const, label: SCOPE_LABEL.full },
];
const SCOPE_DETAIL: Record<ShareScope, string> = {
  report: '只显示收益率、持仓权重和基准对照，不含任何金额、现金流或交易。',
  full: '除设置外的全部页面：净值与盈亏金额、每笔交易、入金与汇兑损耗、对账结果。对方不能导入、导出、新增、修改或删除。',
};
/** What a link newly reveals when raised from report to full. */
const FULL_SCOPE_ADDS = [
  'USD 金额：净值、净投入、累计与每日盈亏',
  '每一笔交易的日期、数量、价格与成交金额，以及备注',
  '入金、出金、CNY 金额与汇兑损耗',
  'XIRR、净值桥、目标进度与账务对账结果',
];

function linkScope(row: ShareRow): ShareScope {
  return row.scope === 'full' ? 'full' : 'report';
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function SharePane() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [createScope, setCreateScope] = useState<ShareScope>('report');
  const [pendingFull, setPendingFull] = useState<ShareRow | null>(null);

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
      const { error } = await supabase
        .from('share_links')
        // 'report' is the column default; only send a scope when raising it,
        // so report links keep working on a database without migration 0059.
        .insert({ token, user_id: user.id, ...(createScope === 'full' ? { scope: createScope } : {}) });
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

  const updateScope = useMutation({
    mutationFn: async ({ token, scope }: { token: string; scope: ShareScope }) => {
      if (LOCAL_MODE) return;
      const { error } = await supabase.from('share_links').update({ scope }).eq('token', token);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['share_links'] }),
  });

  const changeScope = (row: ShareRow, scope: ShareScope) => {
    if (scope === linkScope(row)) return;
    // Raising a link reveals amounts to anyone who already has the address.
    if (scope === 'full') setPendingFull(row);
    else updateScope.mutate({ token: row.token, scope });
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const links = shareLinks.data ?? [];

  return (
    <div className="space-y-5">
      <SettingsPaneHeader
        heading="分享链接"
        text={
          LOCAL_MODE
            ? '本地 Debug 模式使用固定 demo 分享链接，不创建线上 token。'
            : '每条链接单独设置权限：报告视图只有百分比，完整只读可看到除设置外的全部页面。'
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gain" />
        <p className="text-muted-foreground">
          新链接默认是报告视图。完整只读会让拿到地址的人看到金额和明细，但任何权限都看不到设置、邮箱和登录身份，也不能修改数据。
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base">已生成的链接</CardTitle>
              <CardDescription className="text-xs">撤销后地址立即失效，已发出的链接也一并作废</CardDescription>
            </div>
          </div>
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-surface px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">新链接权限</span>
              <SegmentedControl
                value={createScope}
                onChange={setCreateScope}
                options={SCOPE_OPTIONS}
                size="sm"
                name="share-create-scope"
                ariaLabel="新链接权限"
              />
              <Button size="sm" className="ml-auto" onClick={() => createShare.mutate()} disabled={LOCAL_MODE || createShare.isPending}>
                <Plus className="h-3.5 w-3.5" /> 生成{SCOPE_LABEL[createScope]}链接
              </Button>
            </div>
            <p className="text-[11px] leading-5 text-muted-foreground">{SCOPE_DETAIL[createScope]}</p>
            {createShare.isError && (
              <p className="text-[11px] text-loss">生成失败：{(createShare.error as Error)?.message ?? '请稍后重试'}</p>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {shareLinks.isPending ? (
            // Loading used to fall through to the empty state, which read as
            // "no links" while active links existed (the health audit, which
            // shares this query, showed them).
            <div className="space-y-2" aria-busy="true" aria-label="正在读取分享链接">
              {[0, 1].map((index) => <div key={index} className="h-10 animate-pulse rounded-lg bg-surface-elevated" />)}
            </div>
          ) : shareLinks.isError ? (
            <div className="rounded-lg border border-loss/30 bg-loss/5 px-3 py-2 text-xs">
              <div className="font-medium text-loss">分享链接读取失败，无法确认是否存在有效链接</div>
              <p className="mt-1 text-muted-foreground">{(shareLinks.error as Error)?.message ?? '请稍后重试'}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => shareLinks.refetch()}>重试</Button>
            </div>
          ) : links.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={LOCAL_MODE ? '本地模式不生成分享链接' : '还没有分享链接'}
              description={
                LOCAL_MODE
                  ? '本地 demo 链接会固定展示在这里，用于预览只读分享页面。'
                  : '生成后，分享地址会显示在这里。'
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
                        'min-w-[8.5rem] flex-1 truncate font-mono',
                        s.revoked ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      /share/{maskToken(s.token)}
                    </code>
                    <StatusBadge tone={s.revoked ? 'neutral' : 'ok'} dot>
                      {s.revoked ? '已撤销' : '有效'}
                    </StatusBadge>
                    {s.revoked && (
                      <StatusBadge tone="neutral">{SCOPE_LABEL[linkScope(s)]}</StatusBadge>
                    )}
                    <span className="hidden text-[11px] text-muted-foreground tnum sm:inline">
                      访问 {s.access_count ?? 0} 次
                    </span>
                    <span className="hidden text-[11px] text-muted-foreground tnum sm:inline">
                      最近 {formatRelative(s.last_accessed_at)}
                    </span>
                    {!s.revoked && (
                      <SegmentedControl
                        value={linkScope(s)}
                        onChange={(scope) => changeScope(s, scope)}
                        options={SCOPE_OPTIONS}
                        size="sm"
                        name={`share-scope-${s.token}`}
                        ariaLabel={`调整 /share/${maskToken(s.token)} 的权限`}
                      />
                    )}
                    {!s.revoked ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="以访客身份打开"
                        >
                          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`以访客身份打开 /share/${maskToken(s.token)}`}>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        </Button>
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
          {updateScope.isError && (
            <p className="mt-2 text-[11px] text-loss">权限调整失败：{(updateScope.error as Error)?.message ?? '请稍后重试'}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={pendingFull !== null} onOpenChange={(open) => { if (!open) setPendingFull(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>升级为「完整只读」？</DialogTitle>
            <DialogDescription>
              {pendingFull ? `/share/${maskToken(pendingFull.token)} · 已访问 ${pendingFull.access_count ?? 0} 次` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            <p>对方将新增看到：</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {FULL_SCOPE_ADDS.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-2 text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              已发出的这个地址立即生效，任何拿到它的人都能看到以上内容。设置、邮箱和登录身份仍不可见，也不能修改数据。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingFull(null)}>取消</Button>
            <Button
              size="sm"
              disabled={updateScope.isPending}
              onClick={() => {
                if (pendingFull) updateScope.mutate({ token: pendingFull.token, scope: 'full' });
                setPendingFull(null);
              }}
            >
              确认升级
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
