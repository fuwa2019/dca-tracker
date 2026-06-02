import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useTransactions } from '@/hooks/usePortfolio';
import { useQuotes } from '@/hooks/useQuotes';
import { aggregatePositions } from '@/lib/calc/position';
import { todayLocalIso } from '@/lib/format';
import { formatDefaultNumber, shouldAutoFillField } from '@/lib/formAutoFill';
import { cn } from '@/lib/utils';
import { addTrackedSymbol } from '@/lib/trackedSymbols';
import { normalizeSymbol } from '@/lib/symbols';
import type { Database } from '@/lib/database.types';

type TxnRow = Database['public']['Tables']['transactions']['Row'];

interface Props {
  initial?: TxnRow;
  onDone?: () => void;
}

export function TxnForm({ initial, onDone }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!initial;

  const { data: allTxns = [] } = useTransactions();
  const [tradeDate, setTradeDate] = useState(initial?.trade_date ?? todayLocalIso());
  const [ticker, setTicker] = useState(initial?.ticker ?? 'VOO');
  const [side, setSide] = useState<'buy' | 'sell'>(initial?.side ?? 'buy');
  const [price, setPrice] = useState(initial ? String(initial.price) : '');
  const [priceTouched, setPriceTouched] = useState(false);
  const [shares, setShares] = useState(initial ? String(initial.shares) : '');
  const [kind, setKind] = useState<'dca' | 'lumpsum'>(initial?.kind ?? 'dca');
  const [note, setNote] = useState(initial?.note ?? '');

  useEffect(() => {
    if (initial) {
      setTradeDate(initial.trade_date);
      setTicker(initial.ticker);
      setSide(initial.side);
      setPrice(String(initial.price));
      setShares(String(initial.shares));
      setKind(initial.kind);
      setNote(initial.note ?? '');
      setPriceTouched(false);
    }
  }, [initial]);

  const normalizedTicker = normalizeSymbol(ticker);
  const { data: tickerQuotes = [], isFetching: quoteFetching, isError: quoteError } = useQuotes([normalizedTicker]);
  const quotePrice = tickerQuotes[0]?.price ?? tickerQuotes[0]?.displayPrice ?? tickerQuotes[0]?.regularPrice ?? null;

  useEffect(() => {
    if (quotePrice == null) return;
    if (!shouldAutoFillField({ isEdit, touched: priceTouched, currentValue: price })) return;
    setPrice(formatDefaultNumber(quotePrice, 4));
  }, [isEdit, price, priceTouched, quotePrice]);

  // Max sellable shares for the current ticker (excluding this txn if editing).
  const maxSellable = useMemo(() => {
    if (side !== 'sell') return Infinity;
    const upper = normalizeSymbol(ticker);
    const others = isEdit && initial ? allTxns.filter((t) => t.id !== initial.id) : allTxns;
    const positions = aggregatePositions(others as TxnRow[]);
    return positions.find((p) => p.ticker === upper)?.shares ?? 0;
  }, [side, ticker, allTxns, isEdit, initial]);

  const sellOverflow = side === 'sell' && Number(shares) > maxSellable + 1e-9;

  const mut = useMutation({
    mutationFn: async () => {
      if (sellOverflow) {
        throw new Error(`卖出数量 ${shares} 超过当前持仓 ${maxSellable.toFixed(4)} 股`);
      }
      const payload = {
        trade_date: tradeDate,
        ticker: normalizedTicker,
        side,
        price: Number(price),
        shares: Number(shares),
        kind,
        note: note || null,
      };
      if (isEdit && initial) {
        const { error } = await supabase.from('transactions').update(payload).eq('id', initial.id);
        if (error) throw error;
      } else {
        if (!user) throw new Error('not_authed');
        const { error } = await supabase.from('transactions').insert({ ...payload, user_id: user.id });
        if (error) throw error;
      }
      await addTrackedSymbol({
        symbol: normalizedTicker,
        source: 'transaction',
        firstTradeDate: tradeDate,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
      qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      qc.invalidateQueries({ queryKey: ['tracked_symbol_coverage'] });
      qc.invalidateQueries({ queryKey: ['price_coverage'] });
      onDone?.();
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    await mut.mutateAsync();
  }

  const notional = Number(price) * Number(shares);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="date">日期</Label>
          <Input id="date" type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} required />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="ticker">股票代码</Label>
          <Input
            id="ticker"
            value={ticker}
            onChange={(e) => {
              const next = e.target.value.toUpperCase();
              if (next !== ticker && !priceTouched) setPrice('');
              setTicker(next);
            }}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 min-w-0">
          <Label>方向</Label>
          <SegmentedControl
            value={side}
            onChange={(v) => setSide(v)}
            name="txn-side"
            ariaLabel="买入或卖出"
            className={cn(side === 'sell' && 'ring-1 ring-loss/30')}
            options={[
              { value: 'buy', label: <span className={side === 'buy' ? 'text-gain' : ''}>买入</span> },
              { value: 'sell', label: <span className={side === 'sell' ? 'text-loss' : ''}>卖出</span> },
            ]}
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label>类型</Label>
          <SegmentedControl
            value={kind}
            onChange={(v) => setKind(v)}
            name="txn-kind"
            ariaLabel="定投或大额建仓"
            options={[
              { value: 'dca', label: '月定投' },
              { value: 'lumpsum', label: '大额建仓' },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="price">成交价 (USD)</Label>
          <Input
            id="price"
            type="number"
            step="0.0001"
            inputMode="decimal"
            value={price}
            onChange={(e) => {
              setPriceTouched(true);
              setPrice(e.target.value);
            }}
            required
          />
          {!isEdit && quoteFetching && !price && (
            <p className="text-[11px] text-muted-foreground">正在填入 {normalizedTicker || '当前标的'} 的最新报价…</p>
          )}
          {!isEdit && quoteError && !price && (
            <p className="text-[11px] text-warn">当前报价暂时获取失败，可手动填写成交价。</p>
          )}
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="shares">股数</Label>
          <Input
            id="shares"
            type="number"
            step="0.000001"
            inputMode="decimal"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            required
            aria-invalid={sellOverflow}
          />
          {side === 'sell' && Number.isFinite(maxSellable) && (
            <p className={cn('text-[11px] tnum', sellOverflow ? 'text-loss' : 'text-muted-foreground')}>
              当前可卖 {maxSellable.toFixed(4)} 股
              {sellOverflow && ' · 超出持仓'}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5 min-w-0">
        <Label htmlFor="note">备注（可选）</Label>
        <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：换仓 / Q4 大额" />
      </div>

      {Number.isFinite(notional) && notional > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs tnum">
          <span className="text-muted-foreground">成交金额</span>
          <span className="font-medium">${notional.toFixed(2)}</span>
        </div>
      )}

      {mut.isError && <p className="text-xs text-loss">{(mut.error as Error)?.message ?? '保存失败'}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone?.()}>取消</Button>
        <Button type="submit" disabled={mut.isPending || sellOverflow}>
          {mut.isPending ? '保存中…' : isEdit ? '保存' : '添加交易'}
        </Button>
      </div>
    </form>
  );
}
