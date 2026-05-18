import { useState, useEffect, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { Database } from '@/lib/database.types';

type CashRow = Database['public']['Tables']['cashflows']['Row'];

interface Props {
  initial?: CashRow;
  onDone?: () => void;
}

export function CashflowForm({ initial, onDone }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!initial;

  const today = new Date().toISOString().slice(0, 10);
  const [cnyOutDate, setCnyOutDate] = useState(initial?.cny_out_date ?? today);
  const [cnyAmount, setCnyAmount] = useState(initial ? String(initial.cny_amount) : '');
  const [usdInDate, setUsdInDate] = useState(initial?.usd_in_date ?? today);
  const [usdAmount, setUsdAmount] = useState(initial?.usd_amount ? String(initial.usd_amount) : '');
  const [targetRate, setTargetRate] = useState(initial ? String(initial.target_rate) : '7.20');
  const [feesUsd, setFeesUsd] = useState(initial ? String(initial.fees_usd) : '0');
  const [note, setNote] = useState(initial?.note ?? '');

  useEffect(() => {
    if (initial) {
      setCnyOutDate(initial.cny_out_date);
      setCnyAmount(String(initial.cny_amount));
      setUsdInDate(initial.usd_in_date ?? today);
      setUsdAmount(initial.usd_amount ? String(initial.usd_amount) : '');
      setTargetRate(String(initial.target_rate));
      setFeesUsd(String(initial.fees_usd));
      setNote(initial.note ?? '');
    }
  }, [initial, today]);

  const cny = Number(cnyAmount) || 0;
  const usd = Number(usdAmount) || 0;
  const rate = Number(targetRate) || 0;
  const idealUsd = rate > 0 ? cny / rate : 0;
  const loss = idealUsd - usd;
  const lossPct = idealUsd > 0 ? loss / idealUsd : 0;

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        cny_out_date: cnyOutDate,
        cny_amount: cny,
        usd_in_date: usdInDate || null,
        usd_amount: usd || null,
        target_rate: rate,
        fees_usd: Number(feesUsd) || 0,
        note: note || null,
      };
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
      onDone?.();
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    await mut.mutateAsync();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cny-date">CNY 出账日</Label>
          <Input id="cny-date" type="date" value={cnyOutDate} onChange={(e) => setCnyOutDate(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cny-amt">CNY 金额</Label>
          <Input id="cny-amt" type="number" step="0.01" inputMode="decimal" value={cnyAmount} onChange={(e) => setCnyAmount(e.target.value)} required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="usd-date">USD 到账日</Label>
          <Input id="usd-date" type="date" value={usdInDate} onChange={(e) => setUsdInDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="usd-amt">USD 实际到账</Label>
          <Input id="usd-amt" type="number" step="0.01" inputMode="decimal" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rate">目标汇率 (USD/CNY)</Label>
          <Input id="rate" type="number" step="0.0001" inputMode="decimal" value={targetRate} onChange={(e) => setTargetRate(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fees">USD 手续费</Label>
          <Input id="fees" type="number" step="0.01" inputMode="decimal" value={feesUsd} onChange={(e) => setFeesUsd(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cf-note">备注（可选）</Label>
        <Input id="cf-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：港卡转账 / 大额第 2/3 笔" />
      </div>

      {idealUsd > 0 && (
        <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs tnum">
          <div className="flex justify-between text-muted-foreground"><span>理想 USD ({cny.toFixed(0)} / {rate.toFixed(4)})</span><span>${idealUsd.toFixed(2)}</span></div>
          {usd > 0 && (
            <div className={`mt-1 flex justify-between font-medium ${loss > 0 ? 'text-danger' : 'text-success'}`}>
              <span>损耗</span><span>${loss.toFixed(2)} ({(lossPct * 100).toFixed(2)}%)</span>
            </div>
          )}
        </div>
      )}

      {mut.isError && <p className="text-xs text-danger">{(mut.error as Error)?.message ?? '保存失败'}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone?.()}>取消</Button>
        <Button type="submit" disabled={mut.isPending}>
          {mut.isPending ? '保存中…' : isEdit ? '保存' : '添加资金流'}
        </Button>
      </div>
    </form>
  );
}
