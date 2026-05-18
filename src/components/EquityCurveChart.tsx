import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { motion } from 'framer-motion';
import type { Database } from '@/lib/database.types';

type TxnRow = Database['public']['Tables']['transactions']['Row'];
type CashRow = Database['public']['Tables']['cashflows']['Row'];

interface Props {
  transactions: TxnRow[];
  cashflows: CashRow[];
  quotes: Record<string, number>;
}

interface Point {
  date: string;
  invested: number;
  costBasis: number;
}

/**
 * Show two curves:
 * - Cumulative invested principal (= Σ USD deposits over time)
 * - Cumulative cost basis (= Σ buy notional at trade date)
 * Today's portfolio market value drawn as a single dot using current quotes.
 */
export function EquityCurveChart({ transactions, cashflows, quotes }: Props) {
  const { data, todayMV } = useMemo(() => {
    // Build a date-sorted timeline of events
    type Event = { date: string; deltaInvested: number; deltaCost: number };
    const events: Event[] = [];
    for (const c of cashflows) {
      if (c.usd_in_date && c.usd_amount) {
        events.push({ date: c.usd_in_date, deltaInvested: Number(c.usd_amount), deltaCost: 0 });
      }
    }
    for (const t of transactions) {
      const notional = Number(t.shares) * Number(t.price);
      events.push({
        date: t.trade_date,
        deltaInvested: 0,
        deltaCost: t.side === 'buy' ? notional : -notional,
      });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));

    let invested = 0;
    let cost = 0;
    const byDate = new Map<string, Point>();
    for (const e of events) {
      invested += e.deltaInvested;
      cost += e.deltaCost;
      byDate.set(e.date, { date: e.date, invested, costBasis: cost });
    }
    const points = [...byDate.values()];

    // Market value at today using quotes
    const netShares = new Map<string, number>();
    for (const t of transactions) {
      const s = Number(t.shares);
      netShares.set(t.ticker, (netShares.get(t.ticker) ?? 0) + (t.side === 'buy' ? s : -s));
    }
    let mv = 0;
    for (const [tk, sh] of netShares) {
      const px = quotes[tk] ?? 0;
      mv += sh * px;
    }

    return { data: points, todayMV: mv };
  }, [transactions, cashflows, quotes]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        暂无数据 — 添加交易和资金流后会显示资产曲线
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="2 4" className="stroke-border" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickMargin={6} tickFormatter={(v) => (v as string).slice(5)} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Math.round((v as number) / 1000)}k`} width={50} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
            formatter={(value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            labelFormatter={(label) => label}
          />
          <ReferenceLine y={todayMV} stroke="hsl(142 71% 45%)" strokeDasharray="3 3" label={{ value: '当前市值', fontSize: 10, fill: 'hsl(142 71% 45%)', position: 'insideTopRight' }} />
          <Line type="monotone" dataKey="invested" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} name="累计入金" />
          <Line type="monotone" dataKey="costBasis" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="累计成本" />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
