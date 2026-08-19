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
import { Kicker } from '@/components/Kicker';
import { StatusBadge } from '@/components/StatusBadge';
import { cashEventChip } from '@/lib/ledgerEvents';
import { useCashflows, useExchangeLoss } from '@/hooks/usePortfolio';
import { useEnterMotion } from '@/hooks/useEnterMotion';
import { supabase } from '@/lib/supabase';
import { cny, usd, signedUsd, signedPct, changeColor, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LOCAL_MODE } from '@/lib/localMode';
import type { Database } from '@/lib/database.types';

type CashRow = Database['public']['Tables']['cashflows']['Row'];

export function CashflowsPage() {
  const enter = useEnterMotion();
  const { data: rows = [] } = useCashflows();
  const stats = useExchangeLoss();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CashRow | null>(null);
  const [deleting, setDeleting] = useState<CashRow | null>(null);
  const fxTransferCount = rows.filter((row) => row.cashflow_kind === 'fx_transfer').length;
  const externalCashflowCount = rows.filter((row) => row.cashflow_kind !== 'stock_allocation').length;

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (LOCAL_MODE) {
        qc.setQueryData<CashRow[]>(['cashflows'], (items = []) => items.filter((row) => row.id !== id));
        return;
      }
      const { error } = await supabase.from('cashflows').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      if (LOCAL_MODE) return;
      qc.invalidateQueries({ queryKey: ['cashflows'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
      qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
    },
  });

  return (
    <div className="container max-w-5xl px-4 py-5 sm:px-6 sm:py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker en="Cash Flow" zh="资金流水" />
          <p className="mt-1.5 text-[11px] text-muted-foreground">手工换汇用于汇损统计；导入的原始入金与个股划转参与账户现金和 XIRR。</p>
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
        <StatCard label="累计 USD 到账" value={usd.format(stats.totalUsdActual)} sub={`${externalCashflowCount} 笔外部资金记录`} />
        <StatCard
          label="累计损耗"
          value={signedUsd(-stats.totalLoss)}
          sub={signedPct(-stats.lossPct)}
          className={changeColor(-stats.totalLoss)}
        />
        <StatCard label="累计 CNY 出账" value={cny.format(stats.totalCny)} sub={`${fxTransferCount} 笔手工换汇`} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="还没有资金流水"
          description="可添加手工换汇，或从交易 CSV 导入原始入金和按日个股划转。"
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
              const eventChip = cashEventChip(c.cashflow_kind);
              const isFxTransfer = c.cashflow_kind === 'fx_transfer';
              const cnyAmt = Number(c.cny_amount);
              const feesCny = Number(c.fees_cny) || 0;
              const usdAmt = Number(c.usd_amount ?? 0);
              const rate = Number(c.target_rate);
              const ideal = rate > 0 ? (cnyAmt + feesCny) / rate : 0;
              const loss = ideal - usdAmt;
              const displayDate = c.usd_in_date ?? c.cny_out_date;
              return (
                <motion.div
                  key={c.id}
                  layout
                  {...enter({ opacity: 0, y: 4 }, { delay: i * 0.02 })}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  className="border-b border-border px-4 py-3 text-sm last:border-b-0"
                >
                  {/* Desktop: horizontal row */}
                  <div className="hidden items-center gap-3 md:flex">
                    <div className="w-14 shrink-0 text-xs text-muted-foreground tnum">{shortDate(displayDate)}</div>
                    <div className="w-20 shrink-0">
                      <StatusBadge tone={eventChip.tone} dot className="text-[10px]">{eventChip.label}</StatusBadge>
                    </div>
                    <div className="min-w-[180px] flex-1">
                      {isFxTransfer ? (
                        <>
                          <div className="font-medium tnum">{cny.format(cnyAmt)}</div>
                          <div className="text-[11px] text-muted-foreground tnum">
                            汇率 {rate.toFixed(4)} {c.note ? `· ${c.note}` : ''}
                          </div>
                        </>
                      ) : (
                        <div className="truncate text-xs text-muted-foreground">
                          {cashEventDetail(c) || eventChip.label}
                        </div>
                      )}
                    </div>
                    <div className={cn('w-28 shrink-0 text-right font-medium tnum', isFxTransfer ? undefined : changeColor(usdAmt))}>
                      {isFxTransfer
                        ? (usdAmt > 0 ? usd.format(usdAmt) : <span className="text-warn">待入账</span>)
                        : signedUsd(usdAmt)}
                    </div>
                    <div className={cn('w-24 shrink-0 text-right text-xs tnum', changeColor(-loss))}>
                      {isFxTransfer && usdAmt > 0 ? `${signedUsd(-loss)} (${signedPct(-loss / Math.max(ideal, 1e-9))})` : '—'}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {isFxTransfer && (
                        <Button aria-label={`编辑 ${shortDate(displayDate)} 资金流`} variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button aria-label={`删除 ${shortDate(displayDate)} 资金流`} variant="ghost" size="icon" className="h-8 w-8 text-loss" onClick={() => setDeleting(c)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Mobile: two-line card */}
                  <div className="flex flex-col gap-2 md:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusBadge tone={eventChip.tone} dot className="text-[10px]">{eventChip.label}</StatusBadge>
                        {isFxTransfer && (
                          <span className="min-w-0 truncate text-xs text-muted-foreground tnum">{cny.format(cnyAmt)}</span>
                        )}
                      </div>
                      <div className={cn('shrink-0 text-right font-medium tnum', isFxTransfer ? undefined : changeColor(usdAmt))}>
                        {isFxTransfer
                          ? (usdAmt > 0 ? usd.format(usdAmt) : <span className="text-warn">待入账</span>)
                          : signedUsd(usdAmt)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tnum min-w-0">
                        <span>{shortDate(displayDate)}</span>
                        {isFxTransfer ? (
                          <>
                            <span>汇率 {rate.toFixed(4)}</span>
                            {usdAmt > 0 && (
                              <span className={changeColor(-loss)}>{signedUsd(-loss)} ({signedPct(-loss / Math.max(ideal, 1e-9))})</span>
                            )}
                          </>
                        ) : (
                          <span className="truncate">{cashEventDetail(c)}</span>
                        )}
                        {c.note && <span className="truncate">· {c.note}</span>}
                      </div>
                      <div className="ml-2 flex shrink-0 gap-1">
                        {isFxTransfer && (
                          <Button aria-label={`编辑 ${shortDate(displayDate)} 资金流`} variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(c)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button aria-label={`删除 ${shortDate(displayDate)} 资金流`} variant="ghost" size="icon" className="h-8 w-8 text-loss" onClick={() => setDeleting(c)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
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
              {deleting && (
                deleting.cashflow_kind !== 'fx_transfer'
                  ? `${deleting.usd_in_date ?? deleting.cny_out_date} · ${cashEventChip(deleting.cashflow_kind).label} · ${signedUsd(Number(deleting.usd_amount))}`
                  : `${deleting.cny_out_date} · ${cashEventChip(deleting.cashflow_kind).label} · ${cny.format(Number(deleting.cny_amount))}`
              )}
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

/** Source-side detail for a plain cash event; empty when the row carries none. */
function cashEventDetail(row: CashRow): string {
  return [row.ticker, row.source_action, row.source_description]
    .filter((part): part is string => !!part && part.trim() !== '')
    .join(' · ');
}
