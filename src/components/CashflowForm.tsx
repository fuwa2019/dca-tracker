import { useState, useEffect, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { todayLocalIso } from '@/lib/format';
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

  const today = todayLocalIso();
  const [cnyOutDate, setCnyOutDate] = useState(initial?.cny_out_date ?? today);
  const [cnyAmount, setCnyAmount] = useState(initial ? String(initial.cny_amount) : '');
  const [usdInDate, setUsdInDate] = useState(initial?.usd_in_date ?? today);
  const [usdAmount, setUsdAmount] = useState(initial?.usd_amount ? String(initial.usd_amount) : '');
  const [targetRate, setTargetRate] = useState(initial ? String(initial.target_rate) : '7.20');
  const [feesCny, setFeesCny] = useState(initial ? String(initial.fees_cny) : '0');
  const [feesUsd, setFeesUsd] = useState(initial ? String(initial.fees_usd) : '0');
  const [note, setNote] = useState(initial?.note ?? '');

  useEffect(() => {
    if (initial) {
      setCnyOutDate(initial.cny_out_date);
      setCnyAmount(String(initial.cny_amount));
      setUsdInDate(initial.usd_in_date ?? today);
      setUsdAmount(initial.usd_amount ? String(initial.usd_amount) : '');
      setTargetRate(String(initial.target_rate));
      setFeesCny(String(initial.fees_cny));
      setFeesUsd(String(initial.fees_usd));
      setNote(initial.note ?? '');
    }
  }, [initial, today]);

  const cny = Number(cnyAmount) || 0;
  const usd = Number(usdAmount) || 0;
  const rate = Number(targetRate) || 0;
  const fCny = Number(feesCny) || 0;
  // Loss = (CNY paid out incl. fees) at target CNY/USD rate − USD actually received.
  // fees_usd is recorded for display only — it's already subtracted from usd_amount when
  // the user reports the net USD that landed on Schwab.
  const totalCnyCost = cny + fCny;
  const idealUsd = rate > 0 ? totalCnyCost / rate : 0;
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
        fees_cny: fCny,
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
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
      onDone?.();
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    await mut.mutateAsync();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Section title="CNY 出账" hint="把人民币从国内账户转出的那一笔">
        <div className="grid grid-cols-2 gap-3">
          <Field id="cny-date" label="出账日">
            <Input id="cny-date" type="date" value={cnyOutDate} onChange={(e) => setCnyOutDate(e.target.value)} required />
          </Field>
          <Field id="cny-amt" label="CNY 金额">
            <Input id="cny-amt" type="number" step="0.01" inputMode="decimal" value={cnyAmount} onChange={(e) => setCnyAmount(e.target.value)} required />
          </Field>
        </div>
      </Section>

      <Section title="USD 到账" hint="Schwab 实际收到的美元金额（净额，扣完手续费）">
        <div className="grid grid-cols-2 gap-3">
          <Field id="usd-date" label="到账日">
            <Input id="usd-date" type="date" value={usdInDate} onChange={(e) => setUsdInDate(e.target.value)} />
          </Field>
          <Field id="usd-amt" label="USD 实际到账">
            <Input id="usd-amt" type="number" step="0.01" inputMode="decimal" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="汇率与手续费" hint="汇率写「CNY/USD」（例如 7.20）。CNY 手续费会计入损耗，USD 手续费仅作展示。">
        <div className="grid grid-cols-3 gap-3">
          <Field id="rate" label="参考汇率">
            <Input id="rate" type="number" step="0.0001" inputMode="decimal" value={targetRate} onChange={(e) => setTargetRate(e.target.value)} required />
          </Field>
          <Field id="fees-cny" label="CNY 手续费">
            <Input id="fees-cny" type="number" step="0.01" inputMode="decimal" value={feesCny} onChange={(e) => setFeesCny(e.target.value)} />
          </Field>
          <Field id="fees-usd" label="USD 手续费">
            <Input id="fees-usd" type="number" step="0.01" inputMode="decimal" value={feesUsd} onChange={(e) => setFeesUsd(e.target.value)} />
          </Field>
        </div>
      </Section>

      <Field id="cf-note" label="备注（可选）">
        <Input id="cf-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：港卡转账 / 大额第 2/3 笔" />
      </Field>

      {idealUsd > 0 && (
        <div className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs tnum space-y-1">
          <div className="flex justify-between text-muted-foreground">
            <span>总 CNY 成本 ({cny.toFixed(2)}{fCny > 0 ? ` + ${fCny.toFixed(2)} 手续费` : ''})</span>
            <span>¥{totalCnyCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>理想 USD (÷ {rate.toFixed(4)})</span>
            <span>${idealUsd.toFixed(2)}</span>
          </div>
          {usd > 0 && (
            <div className={`flex justify-between font-medium ${loss > 0 ? 'text-loss' : 'text-gain'}`}>
              <span>损耗</span><span>${loss.toFixed(2)} ({(lossPct * 100).toFixed(2)}%)</span>
            </div>
          )}
        </div>
      )}

      {mut.isError && <p className="text-xs text-loss">{(mut.error as Error)?.message ?? '保存失败'}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone?.()}>取消</Button>
        <Button type="submit" disabled={mut.isPending}>
          {mut.isPending ? '保存中…' : isEdit ? '保存' : '添加资金流'}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      </div>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
