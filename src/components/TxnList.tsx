import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TxnForm } from '@/components/TxnForm';
import { supabase } from '@/lib/supabase';
import { usd, shortDate, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Database } from '@/lib/database.types';

type TxnRow = Database['public']['Tables']['transactions']['Row'];

interface Props {
  rows: TxnRow[];
  emptyText?: string;
}

export function TxnList({ rows, emptyText = '暂无交易' }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TxnRow | null>(null);
  const [deleting, setDeleting] = useState<TxnRow | null>(null);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
    },
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <AnimatePresence initial={false}>
          {rows.map((t, i) => {
            const notional = Number(t.shares) * Number(t.price);
            const isLump = t.kind === 'lumpsum';
            const isSell = t.side === 'sell';
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ delay: i * 0.02 }}
                className="border-b px-4 py-3 text-sm last:border-b-0"
              >
                {/* Desktop: horizontal row */}
                <div className="hidden items-center gap-3 md:flex">
                  <div className="w-14 shrink-0 text-xs text-muted-foreground tnum">{shortDate(t.trade_date)}</div>
                  <div className="w-16 shrink-0 font-semibold">{t.ticker}</div>
                  <div className="hidden w-16 shrink-0 sm:block">
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium',
                        isSell ? 'bg-loss-soft' : 'bg-gain-soft',
                      )}
                    >
                      {isSell ? '卖出' : '买入'}
                    </span>
                  </div>
                  <div className="hidden w-16 shrink-0 lg:block">
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium',
                        isLump ? 'bg-warn-soft' : 'bg-surface-elevated text-muted-foreground',
                      )}
                    >
                      {isLump ? '大额' : '定投'}
                    </span>
                  </div>
                  <div className="flex-1 text-right text-xs tnum text-muted-foreground">
                    {Number(t.shares).toFixed(4)} × {usd.format(Number(t.price))}
                  </div>
                  <div className={cn('w-24 shrink-0 text-right font-medium tnum', changeColor(isSell ? notional : -notional))}>
                    {usd.format(notional)}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-loss" onClick={() => setDeleting(t)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Mobile: two-line card */}
                <div className="flex flex-col gap-2 md:hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t.ticker}</span>
                      <span
                        className={cn(
                          'inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium',
                          isSell ? 'bg-loss-soft' : 'bg-gain-soft',
                        )}
                      >
                        {isSell ? '卖出' : '买入'}
                      </span>
                    </div>
                    <div className={cn('text-base font-medium tnum', changeColor(isSell ? notional : -notional))}>
                      {usd.format(notional)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tnum">
                      <span>{shortDate(t.trade_date)}</span>
                      <span>{Number(t.shares).toFixed(4)} 股</span>
                      <span>@ {usd.format(Number(t.price))}</span>
                      <span
                        className={cn(
                          'inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                          isLump ? 'bg-warn-soft' : 'bg-surface-elevated text-muted-foreground',
                        )}
                      >
                        {isLump ? '大额' : '定投'}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-loss" onClick={() => setDeleting(t)}>
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

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑交易</DialogTitle>
            <DialogDescription>{editing && `${editing.trade_date} · ${editing.ticker}`}</DialogDescription>
          </DialogHeader>
          {editing && <TxnForm initial={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除？</DialogTitle>
            <DialogDescription>
              {deleting && `${deleting.trade_date} · ${deleting.ticker} · ${Number(deleting.shares).toFixed(4)} 股 @ ${usd.format(Number(deleting.price))}`}
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
    </>
  );
}
