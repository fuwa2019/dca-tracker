import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { pct, signedPct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SharedPortfolio } from '@/lib/database.types';

export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['share', token],
    queryFn: async () => {
      if (!token) throw new Error('no_token');
      const { data, error } = await supabase.rpc('shared_portfolio', { p_token: token });
      if (error) throw error;
      return data as SharedPortfolio | { error: string };
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (!token) return <Centered>缺少 token</Centered>;
  if (isLoading) return <Centered>加载中…</Centered>;
  if (error) return <Centered>加载失败：{(error as Error).message}</Centered>;
  if (!data || 'error' in data) return <Centered>分享链接无效或已过期</Centered>;

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">分享视图</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          只显示持仓比例和收益率；具体金额已隐藏。
        </p>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle>组合总收益</CardTitle>
          <CardDescription>按持仓加权平均成本基准计算</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={cn('text-4xl font-semibold tracking-tight tnum', changeColor(data.total_return_pct))}>
            {signedPct(data.total_return_pct)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>持仓</CardTitle>
          <CardDescription>{data.positions.length} 只</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.positions.map((p, i) => (
            <motion.div
              key={p.ticker}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 rounded-lg border bg-card/60 px-3 py-3"
            >
              <div className="w-16 font-semibold">{p.ticker}</div>
              <div className="flex-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${p.weight_pct * 100}%` }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.05 * i }}
                    className="h-full rounded-full bg-foreground"
                  />
                </div>
              </div>
              <div className="w-16 text-right text-xs tnum text-muted-foreground">{pct(p.weight_pct, 1)}</div>
              <div className={cn('w-20 text-right font-medium tnum', changeColor(p.return_pct))}>{signedPct(p.return_pct)}</div>
              <div className={cn('hidden w-20 text-right text-xs tnum sm:block', changeColor(p.day_change_pct ?? 0))}>
                {p.day_change_pct !== null ? signedPct(p.day_change_pct) + ' 今日' : '—'}
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground">
        Generated {new Date(data.generated_at).toLocaleString()} · DCA Tracker
      </p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
