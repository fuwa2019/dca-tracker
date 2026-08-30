import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, MoreVertical, Pencil, Trash2 } from '@/components/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TxnForm } from '@/components/TxnForm';
import { StatusBadge } from '@/components/StatusBadge';
import { tradeEventChip } from '@/lib/ledgerEvents';
import { supabase } from '@/lib/supabase';
import { usd, shortDate, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LOCAL_MODE } from '@/lib/localMode';
import type { Database } from '@/lib/database.types';
import { transactionCashEffect, transactionFee } from '@/lib/calc/transactionAmounts';
import {
  DEFAULT_TXN_SORT,
  nextSort,
  sortTransactions,
  type TxnSort,
  type TxnSortKey,
} from '@/lib/ledgerSort';
import { coordinateEtfHoldings } from '@/lib/etfHoldings';
import { useEnterMotion } from '@/hooks/useEnterMotion';

type TxnRow = Database['public']['Tables']['transactions']['Row'];

export { DEFAULT_TXN_SORT, sortTransactions } from '@/lib/ledgerSort';
export type { TxnSort } from '@/lib/ledgerSort';

/** The table's ordering needs the cash effect, which lives in the calc layer. */
export function sortLedgerRows(rows: TxnRow[], sort: TxnSort) {
  return sortTransactions(rows, sort, transactionCashEffect);
}

interface Props {
  rows: TxnRow[];
  emptyText?: string;
  /**
   * Controlled sort. A paginated caller must own this and sort the whole
   * filtered set, otherwise the header would only reorder the visible page.
   */
  sort?: TxnSort;
  onSortChange?: (sort: TxnSort) => void;
}

/** Columns the reader can hide. Identity and amount always stay. */
type OptionalColumn = 'event' | 'quantity' | 'price' | 'note';

const COLUMN_LABELS: Record<OptionalColumn, string> = {
  event: '事件',
  quantity: '数量',
  price: '价格',
  note: '备注',
};

/** Notes are usually empty, so the column is opt-in like the reference's. */
const DEFAULT_HIDDEN: ReadonlyArray<OptionalColumn> = ['note'];

/**
 * Placeholder with the footprint of a five-row list, which is what
 * `/transactions` shows.
 *
 * The old placeholder was `h-24`, so the list arriving grew the section by
 * 228 px on emulated mobile and pushed the section below it off screen — the
 * 0.015 CLS `docs/release/probes/cls-attribution.mjs` attributed on that route.
 * The heights are measured from the rendered list and belong next to the markup
 * that determines them: below `md` the card list is 5 x 64.5 px plus its border;
 * at `md` and up the table adds a 45 px column chooser and a 41 px head to
 * 5 x 63 px rows.
 *
 * A ledger with fewer than five rows still settles shorter than this. That is
 * the uncommon case and it only ever shifts content up, unlike the old
 * placeholder, which was wrong for every ledger.
 */
export function TxnListSkeleton() {
  return (
    <Card
      className="h-[324px] animate-pulse p-0 md:h-[402px]"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">正在读取交易记录</span>
    </Card>
  );
}

export function TxnList({ rows, emptyText = '暂无交易', sort: controlledSort, onSortChange }: Props) {
  const enter = useEnterMotion();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TxnRow | null>(null);
  const [deleting, setDeleting] = useState<TxnRow | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<OptionalColumn>>(() => new Set(DEFAULT_HIDDEN));
  const [localSort, setLocalSort] = useState<TxnSort>(DEFAULT_TXN_SORT);
  const controlled = controlledSort !== undefined;
  const sort = controlledSort ?? localSort;
  const setSort = (next: TxnSort) => (controlled ? onSortChange?.(next) : setLocalSort(next));

  const visible = (column: OptionalColumn) => !hidden.has(column);
  const toggleColumn = (column: OptionalColumn) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });

  // A controlled caller has already sorted the full set for us.
  const sorted = useMemo(() => (controlled ? rows : sortLedgerRows(rows, sort)), [controlled, rows, sort]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (LOCAL_MODE) {
        qc.setQueryData<TxnRow[]>(['transactions'], (current = []) => current.filter((row) => row.id !== id));
        return;
      }
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      if (LOCAL_MODE) return;
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
      qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      void coordinateEtfHoldings(qc);
    },
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        {/* The chooser drives the desktop table only. */}
        <div className="hidden items-center justify-end gap-3 border-b border-border px-4 py-1.5 md:flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground">
                <Columns3 className="h-3.5 w-3.5" />
                列
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>显示列</DropdownMenuLabel>
              {(Object.keys(COLUMN_LABELS) as OptionalColumn[]).map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={visible(column)}
                  onCheckedChange={() => toggleColumn(column)}
                >
                  {COLUMN_LABELS[column]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Desktop: one table, hairline separators, no vertical rules. */}
        <div
          className="hidden overflow-x-auto md:block"
          tabIndex={0}
          role="region"
          aria-label="交易表格"
        >
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">交易记录</caption>
            <thead>
              <tr className="border-b border-border bg-surface-elevated/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <SortableHeader label="日期" sortKey="date" sort={sort} onSort={setSort} className="w-28 px-4 py-2 text-left" />
                <SortableHeader label="标的" sortKey="ticker" sort={sort} onSort={setSort} className="px-3 py-2 text-left" />
                {visible('event') && <th scope="col" className="w-24 px-3 py-2 text-left font-medium">事件</th>}
                {visible('quantity') && <th scope="col" className="w-28 px-3 py-2 text-right font-medium">数量</th>}
                {visible('price') && <th scope="col" className="w-28 px-3 py-2 text-right font-medium">价格</th>}
                <SortableHeader label="现金影响" sortKey="amount" sort={sort} onSort={setSort} className="w-32 px-3 py-2 text-right" />
                {visible('note') && <th scope="col" className="px-3 py-2 text-left font-medium">备注</th>}
                <th scope="col" className="w-12 px-2 py-2">
                  <span className="sr-only">行操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {sorted.map((t, i) => {
                  const cashEffect = transactionCashEffect(t);
                  const fee = transactionFee(t);
                  const eventChip = tradeEventChip(t.side);
                  return (
                    <motion.tr
                      key={t.id}
                      layout
                      {...enter({ opacity: 0, y: 4 }, { delay: i * 0.015 })}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      className="border-b border-border last:border-0 hover:bg-surface-elevated/40"
                    >
                      <td className="px-4 py-2.5 font-num text-[12px] text-muted-foreground">
                        {shortDate(t.trade_date)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <TickerAvatar ticker={t.ticker} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{t.ticker}</div>
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {t.kind === 'lumpsum' ? '建仓' : '定投'}
                            </div>
                          </div>
                        </div>
                      </td>
                      {visible('event') && (
                        <td className="px-3 py-2.5">
                          <StatusBadge tone={eventChip.tone} dot className="text-[10px]">
                            {eventChip.label}
                          </StatusBadge>
                        </td>
                      )}
                      {visible('quantity') && (
                        <td className="px-3 py-2.5 text-right">
                          <NumericCell value={Number(t.shares).toFixed(4)} unit="股" />
                        </td>
                      )}
                      {visible('price') && (
                        <td className="px-3 py-2.5 text-right">
                          <NumericCell value={usd.format(Number(t.price))} unit={fee > 0 ? `费 ${usd.format(fee)}` : '成交价'} />
                        </td>
                      )}
                      <td className={cn('px-3 py-2.5 text-right font-medium tnum', changeColor(cashEffect))}>
                        <NumericCell
                          value={usd.format(cashEffect)}
                          unit={cashEffect >= 0 ? '现金流入' : '现金流出'}
                          valueClassName={changeColor(cashEffect)}
                        />
                      </td>
                      {visible('note') && (
                        <td className="max-w-[16rem] truncate px-3 py-2.5 text-[12px] text-muted-foreground" title={t.note ?? undefined}>
                          {t.note || '—'}
                        </td>
                      )}
                      <td className="px-2 py-2.5 text-right">
                        <RowMenu row={t} onEdit={setEditing} onDelete={setDeleting} />
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Narrow: the same row, stacked. */}
        <div className="divide-y divide-border md:hidden">
          <AnimatePresence initial={false}>
            {sorted.map((t, i) => {
              const cashEffect = transactionCashEffect(t);
              const fee = transactionFee(t);
              const eventChip = tradeEventChip(t.side);
              return (
                <motion.div
                  key={t.id}
                  layout
                  {...enter({ opacity: 0, y: 4 }, { delay: i * 0.015 })}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  className="px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <TickerAvatar ticker={t.ticker} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">{t.ticker}</span>
                          <StatusBadge tone={eventChip.tone} dot className="text-[10px]">
                            {eventChip.label}
                          </StatusBadge>
                        </div>
                        <div className="mt-0.5 truncate font-num text-[11px] text-muted-foreground">
                          {shortDate(t.trade_date)} · {Number(t.shares).toFixed(4)} 股 @ {usd.format(Number(t.price))}
                          {fee > 0 ? ` · 费 ${usd.format(fee)}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <div className="text-right font-medium tnum">
                        <NumericCell
                          value={usd.format(cashEffect)}
                          unit={<KindBadge kind={t.kind} />}
                          valueClassName={changeColor(cashEffect)}
                        />
                      </div>
                      <RowMenu row={t} onEdit={setEditing} onDelete={setDeleting} />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑交易</DialogTitle>
            <DialogDescription>修改后会重新参与净值与业绩计算。</DialogDescription>
          </DialogHeader>
          {editing && <TxnForm initial={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除这笔交易？</DialogTitle>
            <DialogDescription>
              {deleting && `${shortDate(deleting.trade_date)} · ${deleting.ticker} · ${Number(deleting.shares).toFixed(4)} 股`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={del.isPending}
              onClick={() => {
                if (!deleting) return;
                del.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
              }}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Reference row identity: a rounded-square ticker mark before the name. */
function TickerAvatar({ ticker }: { ticker: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-elevated font-num text-[10px] font-semibold text-muted-foreground"
    >
      {ticker.slice(0, 4)}
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const isLump = kind === 'lumpsum';
  return (
    <span
      className={cn(
        'inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        isLump ? 'bg-warn-soft' : 'bg-surface-elevated text-muted-foreground',
      )}
    >
      {isLump ? '建仓' : '定投'}
    </span>
  );
}

/** Value on top, unit or qualifier underneath — the reference's numeric cell. */
function NumericCell({
  value,
  unit,
  valueClassName,
}: {
  value: string;
  unit: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="leading-tight">
      <div className={cn('font-num text-[13px]', valueClassName)}>{value}</div>
      <div className="mt-0.5 font-num text-[10px] font-normal text-muted-foreground">{unit}</div>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: TxnSortKey;
  sort: TxnSort;
  onSort: (next: TxnSort) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={ariaSort} className={cn('font-medium', className)}>
      <button
        type="button"
        className="inline-flex min-h-6 items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground"
        onClick={() => onSort(nextSort(sort, sortKey))}
      >
        {label}
        <Icon className={cn('h-3 w-3', active ? 'text-foreground' : 'opacity-50')} />
      </button>
    </th>
  );
}

function RowMenu({
  row,
  onEdit,
  onDelete,
}: {
  row: TxnRow;
  onEdit: (row: TxnRow) => void;
  onDelete: (row: TxnRow) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`${row.ticker} ${shortDate(row.trade_date)} 交易操作`}
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(row)}>
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-loss" onSelect={() => onDelete(row)}>
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
