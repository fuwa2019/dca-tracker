import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useAccounts } from '@/hooks/usePortfolio';
import { todayLocalIso } from '@/lib/format';
import { normalizeSymbol } from '@/lib/symbols';
import { LOCAL_MODE, LOCAL_USER } from '@/lib/localMode';
import type { Database, LedgerCashflowKind } from '@/lib/database.types';

type CashRow = Database['public']['Tables']['cashflows']['Row'];

/** Broker cash events a person records by hand. The sign follows the kind. */
export const MANUAL_CASH_KINDS: ReadonlyArray<{ value: LedgerCashflowKind; label: string; sign: 1 | -1 | 0; hint: string }> = [
  { value: 'broker_deposit', label: '入金', sign: 1, hint: '外部资金转入券商账户；TWR 在这一天切分子区间。' },
  { value: 'broker_withdrawal', label: '出金', sign: -1, hint: '从券商账户转出；按当日收盘后离开计算。' },
  { value: 'dividend', label: '股息', sign: 1, hint: '持仓派息，属于投资收益。' },
  { value: 'interest', label: '利息', sign: 0, hint: '现金利息；负数表示融资利息支出。' },
  { value: 'tax', label: '税款', sign: -1, hint: '预扣税等，属于投资成本。' },
  { value: 'fee', label: '费用', sign: -1, hint: '账户费、平台费等，属于投资成本。' },
];

interface Props {
  initial?: CashRow;
  onDone?: () => void;
}

export function CashEventForm({ initial, onDone }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [kind, setKind] = useState<LedgerCashflowKind>(initial?.cashflow_kind ?? 'broker_deposit');
  const [date, setDate] = useState(initial?.effective_date ?? initial?.usd_in_date ?? todayLocalIso());
  const [amount, setAmount] = useState(initial?.usd_amount != null ? String(Math.abs(Number(initial.usd_amount))) : '');
  const [ticker, setTicker] = useState(initial?.ticker ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const accounts = useAccounts();
  const hasAccounts = (accounts.data?.length ?? 0) > 0;
  const [accountId, setAccountId] = useState<string>(initial?.account_id ?? 'none');
  const spec = MANUAL_CASH_KINDS.find((item) => item.value === kind) ?? MANUAL_CASH_KINDS[0];
  const needsTicker = kind === 'dividend' || kind === 'tax';

  const parsed = Number(amount);
  const signed = spec.sign === 0 ? parsed : spec.sign * Math.abs(parsed);
  const valid = Number.isFinite(parsed) && parsed !== 0 && !!date;

  const mut = useMutation({
    mutationFn: async () => {
      if (!valid) throw new Error('请输入非零金额和日期');
      const payload = {
        cashflow_kind: kind,
        cny_out_date: date,
        usd_in_date: date,
        effective_date: date,
        usd_amount: signed,
        cny_amount: null,
        target_rate: null,
        fees_cny: 0,
        fees_usd: 0,
        source_currency: 'USD',
        source_amount: signed,
        ticker: needsTicker && ticker.trim() ? normalizeSymbol(ticker) : null,
        note: note.trim() || null,
        ...(hasAccounts ? { account_id: accountId === 'none' ? null : accountId } : {}),
      };
      if (LOCAL_MODE) {
        const now = new Date().toISOString();
        qc.setQueryData<CashRow[]>(['cashflows'], (rows = []) => {
          if (isEdit && initial) return rows.map((row) => (row.id === initial.id ? { ...row, ...payload } : row));
          const row: CashRow = {
            id: `local-cf-${Date.now()}`,
            user_id: user?.id ?? LOCAL_USER.id,
            batch_id: null,
            ...payload,
            source_action: null,
            source_description: null,
            import_source: null,
            import_key: null,
            created_at: now,
          };
          return [row, ...rows];
        });
        return;
      }
      if (isEdit && initial) {
        const { error } = await supabase.from('cashflows').update(payload).eq('id', initial.id);
        if (error) throw error;
      } else {
        if (!user) throw new Error('not_authed');
        const { error } = await supabase.from('cashflows').insert({ ...payload, user_id: user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashflows'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
      qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      onDone?.();
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mut.mutateAsync();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cash-kind">类型</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as LedgerCashflowKind)}>
            <SelectTrigger id="cash-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MANUAL_CASH_KINDS.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cash-date">日期</Label>
          <Input id="cash-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cash-amount">金额 (USD)</Label>
          <Input
            id="cash-amount"
            type="number"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        {hasAccounts && (
          <div className="space-y-1.5">
            <Label htmlFor="cash-account">账户</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="cash-account"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未分配</SelectItem>
                {(accounts.data ?? []).map((account) => (
                  <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {needsTicker && (
          <div className="space-y-1.5">
            <Label htmlFor="cash-ticker">相关代码（可选）</Label>
            <Input id="cash-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="例：QQQM" />
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {spec.hint}
        {valid && ` 记账金额 ${signed >= 0 ? '+' : ''}${signed.toFixed(2)} USD。`}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="cash-note">备注（可选）</Label>
        <Input id="cash-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {mut.isError && <p className="text-xs text-loss">{(mut.error as Error)?.message ?? '保存失败'}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone?.()}>取消</Button>
        <Button type="submit" disabled={mut.isPending || !valid}>
          {mut.isPending ? '保存中…' : isEdit ? '保存' : '添加现金事件'}
        </Button>
      </div>
    </form>
  );
}
