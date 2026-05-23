import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { unrealizedPL, type Position } from '@/lib/calc/position';
import type { Quote } from '@/lib/quote';
import { usd, signedUsd, signedPct, pct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  positions: Position[];
  quoteByTicker: Map<string, Quote>;
  totalMarketValue: number;
  basis: 'avg' | 'fifo';
}

interface Row {
  ticker: string;
  shares: number;
  price: number | null;
  dayChangePct: number | null;
  dayChangeUsd: number | null;
  marketValue: number;
  weightPct: number;
  unrealizedUsd: number;
  unrealizedPct: number;
}

function buildRows({ positions, quoteByTicker, totalMarketValue, basis }: Props): Row[] {
  return positions
    .map((p) => {
      const q = quoteByTicker.get(p.ticker);
      const price = q?.price ?? null;
      const { marketValue, unrealizedUsd, unrealizedPct } = unrealizedPL(p, price, basis);
      const dayChange = q?.change ?? null;
      const dayChangePct = q?.changePct ?? null;
      return {
        ticker: p.ticker,
        shares: p.shares,
        price,
        dayChangePct,
        dayChangeUsd: dayChange !== null ? p.shares * dayChange : null,
        marketValue,
        weightPct: totalMarketValue > 0 ? marketValue / totalMarketValue : 0,
        unrealizedUsd,
        unrealizedPct,
      };
    })
    .sort((a, b) => b.marketValue - a.marketValue);
}

export function HoldingsList(props: Props) {
  const rows = buildRows(props);
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <HoldingsTable rows={rows} />
      <HoldingsCards rows={rows} basis={props.basis} />
    </div>
  );
}

function HoldingsTable({ rows }: { rows: Row[] }) {
  return (
    <table className="hidden w-full text-sm md:table">
      <thead>
        <tr className="border-b border-border bg-surface-elevated/50 text-muted-foreground">
          <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider">代码</th>
          <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider">股数</th>
          <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider">现价</th>
          <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider">今日</th>
          <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider">市值</th>
          <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider">未实现盈亏</th>
          <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider">权重</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <motion.tr
            key={r.ticker}
            layout
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className="border-b border-border last:border-0 hover:bg-surface-elevated/40"
          >
            <td className="px-4 py-3 font-semibold">{r.ticker}</td>
            <td className="px-4 py-3 text-right tnum text-muted-foreground">{r.shares.toFixed(4)}</td>
            <td className="px-4 py-3 text-right tnum">
              {r.price !== null ? usd.format(r.price) : '—'}
            </td>
            <td className={cn('px-4 py-3 text-right tnum', changeColor(r.dayChangePct))}>
              <span className="inline-flex items-center justify-end gap-1">
                <DayArrow value={r.dayChangePct} />
                {r.dayChangePct !== null ? signedPct(r.dayChangePct) : '—'}
              </span>
              <div className="text-[10px] text-muted-foreground tnum">
                {r.dayChangeUsd !== null ? signedUsd(r.dayChangeUsd) : ''}
              </div>
            </td>
            <td className="px-4 py-3 text-right font-medium tnum">{usd.format(r.marketValue)}</td>
            <td className={cn('px-4 py-3 text-right tnum', changeColor(r.unrealizedUsd))}>
              {signedUsd(r.unrealizedUsd)}
              <div className="text-[10px] tnum opacity-80">{signedPct(r.unrealizedPct)}</div>
            </td>
            <td className="px-4 py-3 text-right tnum">
              <WeightBar pctValue={r.weightPct} />
            </td>
          </motion.tr>
        ))}
      </tbody>
    </table>
  );
}

function HoldingsCards({ rows, basis: _basis }: { rows: Row[]; basis: 'avg' | 'fifo' }) {
  return (
    <div className="divide-y divide-border md:hidden">
      {rows.map((r, i) => (
        <motion.div
          key={r.ticker}
          layout
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.02 }}
          className="px-4 py-3"
        >
          <div className="flex items-baseline justify-between">
            <div>
              <div className="font-semibold">{r.ticker}</div>
              <div className="text-[11px] text-muted-foreground tnum">
                {r.shares.toFixed(4)} 股 · {r.price !== null ? usd.format(r.price) : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-base font-medium tnum">{usd.format(r.marketValue)}</div>
              <div className={cn('text-[11px] tnum', changeColor(r.dayChangePct))}>
                {r.dayChangePct !== null ? signedPct(r.dayChangePct) : '—'} 今日
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1">
              <WeightBar pctValue={r.weightPct} compact />
            </div>
            <div className={cn('text-right text-xs tnum', changeColor(r.unrealizedUsd))}>
              {signedUsd(r.unrealizedUsd)} ({signedPct(r.unrealizedPct)})
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function WeightBar({ pctValue, compact }: { pctValue: number; compact?: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span
        className={cn(
          'overflow-hidden rounded-full bg-surface-elevated',
          compact ? 'block h-1 w-full' : 'hidden h-1.5 w-16 md:block',
        )}
      >
        <span
          aria-hidden
          className={cn('block rounded-full bg-brand', compact ? 'h-1' : 'h-1.5')}
          style={{ width: `${Math.min(100, Math.max(2, pctValue * 100))}%` }}
        />
      </span>
      <span className="text-xs text-muted-foreground tnum">{pct(pctValue, 1)}</span>
    </div>
  );
}

function DayArrow({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <Minus className="h-3 w-3" />;
  if (value > 0) return <TrendingUp className="h-3 w-3" />;
  if (value < 0) return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}
