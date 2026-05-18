import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Copy, Trash2, Plus, LogOut, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSettings } from '@/hooks/usePortfolio';
import { useAuth, signOut } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
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
      const { data, error } = await supabase.from('share_links').select('*').order('created_at', { ascending: false });
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
    <div className="container max-w-3xl py-6 space-y-5">
      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-semibold tracking-tight"
      >
        设置
      </motion.h1>

      <Card>
        <CardHeader>
          <CardTitle>目标与定投</CardTitle>
          <CardDescription>用于 $1M 进度环和入金提醒</CardDescription>
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
        <CardHeader>
          <CardTitle>邮件提醒</CardTitle>
          <CardDescription>每月第一个美股交易日前一天上午 11:00 提醒入金</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="email-on">启用提醒</Label>
            <Switch id="email-on" checked={form.email_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, email_enabled: v }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail">收件邮箱</Label>
            <Input id="mail" type="email" value={form.email_to} onChange={(e) => setForm((f) => ({ ...f, email_to: e.target.value }))} placeholder="you@gmail.com" />
            <p className="text-xs text-muted-foreground">建议 Gmail / iCloud / Outlook（Resend 直发可达）</p>
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
            className="flex items-center gap-1 text-xs text-success"
          >
            <Check className="h-3.5 w-3.5" /> 已保存
          </motion.span>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>分享链接</CardTitle>
          <CardDescription>只显示持仓权重和收益率，隐藏现金流 / CNY / 损耗</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" onClick={() => createShare.mutate()} disabled={createShare.isPending}>
            <Plus className="h-4 w-4" /> 生成新链接
          </Button>
          <div className="space-y-2">
            {(shareLinks.data ?? []).map((s) => {
              const url = `${baseUrl}/share/${s.token}`;
              return (
                <div key={s.token} className={`flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs ${s.revoked ? 'opacity-50' : ''}`}>
                  <code className="flex-1 truncate font-mono">{url}</code>
                  {!s.revoked && (
                    <>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigator.clipboard.writeText(url)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-danger" onClick={() => revokeShare.mutate(s.token)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {s.revoked && <span className="text-[10px] text-muted-foreground">已撤销</span>}
                </div>
              );
            })}
            {shareLinks.data?.length === 0 && (
              <p className="text-xs text-muted-foreground">还没有分享链接</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-4">
        <div className="text-xs text-muted-foreground">登录身份：{user?.email ?? '—'}</div>
        <Button variant="ghost" size="sm" onClick={() => signOut()}>
          <LogOut className="h-4 w-4" />退出登录
        </Button>
      </div>
    </div>
  );
}
