import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useAccounts, useTransactions } from '@/hooks/usePortfolio';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuotes } from '@/hooks/useQuotes';
import { aggregatePositions } from '@/lib/calc/position';
import { coordinateEtfHoldings } from '@/lib/etfHoldings';
import { todayLocalIso } from '@/lib/format';
import { formatDefaultNumber, shouldAutoFillField } from '@/lib/formAutoFill';
import { cn } from '@/lib/utils';
import { addTrackedSymbol } from '@/lib/trackedSymbols';
import { normalizeSymbol } from '@/lib/symbols';
import { LOCAL_MODE, LOCAL_USER } from '@/lib/localMode';
import { transactionCashAmount } from '@/lib/calc/transactionAmounts';
import type { Database } from '@/lib/database.types';

type TxnRow = Database['public']['Tables']['transactions']['Row'];

/** Trading currencies offered for manual entry; imports carry any ISO code. */
const CURRENCIES = ['USD', 'SEK', 'HKD', 'JPY', 'EUR', 'GBP', 'CAD', 'AUD', 'CNY'] as const;
const UNASSIGNED = '__unassigned__';

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Native-currency view of a stored row: the form edits what the broker quoted. */
function nativeFields(row: TxnRow | undefined) {
  const currency = (row?.source_currency ?? 'USD').toUpperCase();
  const fx = Number(row?.fx_rate_to_usd);
  const foreign = currency !== 'USD' && Number.isFinite(fx) && fx > 0;
  return {
    currency: foreign ? currency : 'USD',
    price: row ? String(foreign && row.source_price != null ? row.source_price : row.price) : '',
    fx: foreign ? String(fx) : '1',
    fee: row ? String(foreign ? round(Number(row.fees_usd ?? 0) / fx, 8) : row.fees_usd ?? 0) : '',
  };
}

interface Props {
  initial?: TxnRow;
  onDone?: () => void;
  defaultSide?: 'buy' | 'sell';
  defaultTicker?: string;
  defaultKind?: 'dca' | 'lumpsum';
}

export function TxnForm({ initial, onDone, defaultSide = 'buy', defaultTicker = 'VOO', defaultKind = 'dca' }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!initial;

  const { data: allTxns = [] } = useTransactions();
  const [tradeDate, setTradeDate] = useState(initial?.trade_date ?? todayLocalIso());
  const [ticker, setTicker] = useState(initial?.ticker ?? defaultTicker);
  const [tickerTouched, setTickerTouched] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>(initial?.side ?? defaultSide);
  const initialNative = nativeFields(initial);
  const [currency, setCurrency] = useState(initialNative.currency);
  const [price, setPrice] = useState(initialNative.price);
  const [fxRate, setFxRate] = useState(initialNative.fx);
  const [priceTouched, setPriceTouched] = useState(false);
  const [shares, setShares] = useState(initial ? String(initial.shares) : '');
  const [feesNative, setFeesNative] = useState(initialNative.fee);
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string>(initial?.account_id ?? UNASSIGNED);
  const [kind, setKind] = useState<'dca' | 'lumpsum'>(initial?.kind ?? defaultKind);
  const [note, setNote] = useState(initial?.note ?? '');

  useEffect(() => {
    if (initial) {
      setTradeDate(initial.trade_date);
      setTicker(initial.ticker);
      setSide(initial.side);
      const native = nativeFields(initial);
      setCurrency(native.currency);
      setPrice(native.price);
      setFxRate(native.fx);
      setShares(String(initial.shares));
      setFeesNative(native.fee);
      setAccountId(initial.account_id ?? UNASSIGNED);
      setKind(initial.kind);
      setNote(initial.note ?? '');
      setTickerTouched(false);
      setPriceTouched(false);
    }
  }, [initial]);

  useEffect(() => {
    if (initial || tickerTouched) return;
    const next = normalizeSymbol(defaultTicker);
    if (!next || next === ticker) return;
    if (!priceTouched) setPrice('');
    setTicker(next);
  }, [defaultTicker, initial, priceTouched, ticker, tickerTouched]);

  useEffect(() => {
    if (!initial) setSide(defaultSide);
  }, [defaultSide, initial]);

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
      if (!(fx > 0)) throw new Error(`请填写 ${currency} 兑 USD 的汇率`);
      // USD values are derived from what the broker quoted: native price and
      // fee times the rate. An imported row keeps its broker settlement unless
      // one of the money fields actually changed.
      const quantity = Number(shares);
      const moneyUnchanged = !!initial
        && initial.side === side
        && Number(initial.shares) === quantity
        && Number(initialNative.price) === nativePrice
        && Number(initialNative.fx) === fx
        && Number(initialNative.fee) === parsedFee
        && initialNative.currency === currency;
      const priceUsd = moneyUnchanged ? Number(initial!.price) : round(nativePrice * fx, 12);
      const feeUsd = moneyUnchanged ? Number(initial!.fees_usd ?? 0) : round(parsedFee * fx, 10);
      const settled = moneyUnchanged && initial?.settled_amount_usd != null
        ? Number(initial.settled_amount_usd)
        : round(side === 'buy' ? -(quantity * priceUsd + feeUsd) : quantity * priceUsd - feeUsd, 10);
      const payload = {
        trade_date: tradeDate,
        ticker: normalizedTicker,
        side,
        price: priceUsd,
        shares: quantity,
        fees_usd: feeUsd,
        settled_amount_usd: currency === 'USD' && !initial?.settled_amount_usd && !moneyUnchanged ? null : settled,
        source_currency: currency,
        source_price: nativePrice,
        source_amount: currency === 'USD' ? null : round(settled / fx, 10),
        fx_rate_to_usd: currency === 'USD' ? null : fx,
        kind,
        note: note || null,
        // Only once migration 0058 exists (the accounts table answered).
        ...((accounts.data?.length ?? 0) > 0 ? { account_id: accountId === UNASSIGNED ? null : accountId } : {}),
      };
      if (LOCAL_MODE) {
        const now = new Date().toISOString();
        if (isEdit && initial) {
          qc.setQueryData<TxnRow[]>(['transactions'], (rows = []) =>
            rows.map((row) => row.id === initial.id ? { ...row, ...payload, updated_at: now } : row),
          );
        } else {
          const row: TxnRow = {
            id: `local-txn-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`,
            user_id: user?.id ?? LOCAL_USER.id,
            batch_id: null,
            ...payload,
            source_description: null,
            import_source: null,
            import_key: null,
            created_at: now,
            updated_at: now,
          };
          qc.setQueryData<TxnRow[]>(['transactions'], (rows = []) =>
            [row, ...rows].sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.created_at.localeCompare(a.created_at)),
          );
        }
        return;
      }
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
      if (LOCAL_MODE) {
        onDone?.();
        return;
      }
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
      qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      qc.invalidateQueries({ queryKey: ['performance_daily_pnl'] });
      qc.invalidateQueries({ queryKey: ['tracked_symbol_coverage'] });
      qc.invalidateQueries({ queryKey: ['price_coverage'] });
      void coordinateEtfHoldings(qc);
      onDone?.();
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (feeInvalid) return;
    await mut.mutateAsync();
  }

  const nativePrice = Number(price);
  const fx = currency === 'USD' ? 1 : Number(fxRate);
  const rawNotional = nativePrice * Number(shares);
  const parsedFee = feesNative.trim() === '' ? 0 : Number(feesNative);
  const feeInvalid = !Number.isFinite(parsedFee)
    || parsedFee < 0
    || (side === 'sell' && Number.isFinite(rawNotional) && rawNotional > 0 && parsedFee >= rawNotional);
  const cashAmount = fx > 0
    ? transactionCashAmount({ side, price: nativePrice * fx, shares: Number(shares), fees_usd: parsedFee * fx })
    : Number.NaN;

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
              setTickerTouched(true);
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
          <Label htmlFor="txn-currency">成交币种</Label>
          <Select value={currency} onValueChange={(value) => { setCurrency(value); if (value === 'USD') setFxRate('1'); }}>
            <SelectTrigger id="txn-currency"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...new Set([...CURRENCIES, currency])].map((code) => (
                <SelectItem key={code} value={code}>{code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {currency !== 'USD' ? (
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="txn-fx">成交汇率（1 {currency} = ? USD）</Label>
            <Input
              id="txn-fx"
              type="number"
              step="0.000000000001"
              inputMode="decimal"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              required
            />
          </div>
        ) : (accounts.data?.length ?? 0) > 0 ? (
          <AccountField accounts={accounts.data ?? []} value={accountId} onChange={setAccountId} />
        ) : null}
      </div>
      {currency !== 'USD' && (accounts.data?.length ?? 0) > 0 && (
        <AccountField accounts={accounts.data ?? []} value={accountId} onChange={setAccountId} />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="price">成交价 ({currency})</Label>
          <Input
            id="price"
            type="number"
            step="0.000000000001"
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
            step="0.0000000001"
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
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="fees-usd">手续费 ({currency === 'USD' ? 'USD' : currency}，可选)</Label>
          <Input
            id="fees-usd"
            type="number"
            min="0"
            step="0.0000000001"
            inputMode="decimal"
            value={feesNative}
            onChange={(e) => setFeesNative(e.target.value)}
            placeholder="0.00"
            aria-invalid={feeInvalid}
          />
          {feeInvalid && (
            <p className="text-[11px] text-loss">
              {!Number.isFinite(parsedFee) || parsedFee < 0 ? '手续费必须为非负数。' : '卖出手续费必须小于成交额。'}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5 min-w-0">
        <Label htmlFor="note">备注（可选）</Label>
        <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：换仓 / Q4 大额" />
      </div>

      {Number.isFinite(cashAmount) && cashAmount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs tnum">
          <span className="text-muted-foreground">{side === 'buy' ? '买入总支出' : '卖出净收入'}{currency !== 'USD' ? '（按成交汇率折算 USD）' : ''}</span>
          <span className="font-medium">${cashAmount.toFixed(2)}</span>
        </div>
      )}

      {mut.isError && <p className="text-xs text-loss">{(mut.error as Error)?.message ?? '保存失败'}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone?.()}>取消</Button>
        <Button type="submit" disabled={mut.isPending || sellOverflow || feeInvalid}>
          {mut.isPending ? '保存中…' : isEdit ? '保存' : '添加交易'}
        </Button>
      </div>
    </form>
  );
}

function AccountField({
  accounts,
  value,
  onChange,
}: {
  accounts: ReadonlyArray<{ id: string; name: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor="txn-account">账户</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="txn-account"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>未分配</SelectItem>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
