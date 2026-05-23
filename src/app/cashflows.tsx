import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { CashflowForm } from '@/components/CashflowForm';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { useCashflows, useExchangeLoss } from '@/hooks/usePortfolio';
import { supabase } from '@/lib/supabase';
import { cny, usd, signedUsd, signedPct, changeColor, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Database } from '@/lib/database.types';

type CashRow = Database['public']['Tables']['cashflows']['Row'];

export function CashflowsPage() {
  const { data: rows = [] } = useCashflows();
  const stats = useExchangeLoss();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CashRow | null>(null);
  const [deleting, setDeleting] = useState<CashRow | null>(null);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cashflows').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashflows'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
    },
  });

  return (
    <div className="container max-w-5xl px-4 py-5 sm:px-6 sm:py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">资金流水</h2>
          <p className="text-[11px] text-muted-foreground">每笔 CNY → USD 转账单独记一行，自动汇总汇兑损耗。</p>
        </div>
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4" />添加资金流</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新增资金流</DialogTitle></DialogHeader>
            <CashflowForm onDone={() => setAdding(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="累计 USD 到账" value={usd.format(stats.totalUsdActual)} sub={`${rows.length} 笔转账`} />
        <StatCard
          label="累计损耗"
          value={signedUsd(-stats.totalLoss)}
          sub={signedPct(-stats.lossPct)}
          className={changeColor(-stats.totalLoss)}
        />
        <StatCard label="累计 CNY 出账" value={cny.format(stats.totalCny)} sub="入金前 CNY 端" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="还没有资金流水"
          description="第一笔 CNY → USD 转账录进来后，汇兑损耗、TWR 起算点、SPY 基准都会自动开始计算。"
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" /> 添加第一笔
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <AnimatePresence initial={false}>
            {rows.map((c, i) => {
              const cnyAmt = Number(c.cny_amount);
              const feesCny = Number(c.fees_cny) || 0;
              const usdAmt = Number(c.usd_amount ?? 0);
              const rate = Number(c.target_rate);
              const ideal = rate > 0 ? (cnyAmt + feesCny) / rate : 0;
              const loss = ideal - usdAmt;
              return (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ delay: i * 0.02 }}
                  className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
                >
                  <div className="w-14 shrink-0 text-xs text-muted-foreground tnum">{shortDate(c.cny_out_date)}</div>
                  <div className="min-w-[180px] flex-1">
                    <div className="font-medium tnum">
                      {cny.format(cnyAmt)} <span className="text-muted-foreground">→</span> {usdAmt > 0 ? usd.format(usdAmt) : <span className="text-warn">待入账</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground tnum">
                      汇率 {rate.toFixed(4)} {c.note ? `· ${c.note}` : ''}
                    </div>
                  </div>
                  <div className={cn('w-24 text-right text-xs tnum', changeColor(-loss))}>
                    {usdAmt > 0 ? `${signedUsd(-loss)} (${signedPct(-loss / Math.max(ideal, 1e-9))})` : '—'}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-loss" onClick={() => setDeleting(c)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑资金流</DialogTitle>
            <DialogDescription>{editing && `${editing.cny_out_date} · ${cny.format(Number(editing.cny_amount))}`}</DialogDescription>
          </DialogHeader>
          {editing && <CashflowForm initial={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除？</DialogTitle>
            <DialogDescription>
              {deleting && `${deleting.cny_out_date} · ${cny.format(Number(deleting.cny_amount))}`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>取消</Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={async () => {
                if (deleting) await del.mutateAsync(deleting.id);
                setDeleting(null);
              }}
            >
              {del.isPending ? '删除中…' : '删除'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
