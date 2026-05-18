import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { usd, signedUsd, signedPct, changeColor } from '@/lib/format';
import type { Position } from '@/lib/calc/position';
import type { Quote } from '@/lib/quote';
import { unrealizedPL } from '@/lib/calc/position';

interface Props {
  position: Position;
  quote: Quote | undefined;
  basis: 'avg' | 'fifo';
  index: number;
}

export function PositionCard({ position, quote, basis, index }: Props) {
  const price = quote?.price ?? null;
  const { marketValue, unrealizedUsd, unrealizedPct } = unrealizedPL(position, price, basis);
  const dayChange = quote?.change ?? null;
  const dayChangePct = quote?.changePct ?? null;
  const dayPLUsd = dayChange !== null ? position.shares * dayChange : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: 'spring', damping: 25, stiffness: 200 }}
    >
      <Card className="p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm font-semibold tracking-wide">{position.ticker}</div>
            <div className="text-xs text-muted-foreground tnum">{position.shares.toFixed(4)} 股</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tnum">{price !== null ? usd.format(price) : '—'}</div>
            <div className={`text-xs tnum ${changeColor(dayChangePct)}`}>
              {dayChangePct !== null ? signedPct(dayChangePct) : '—'}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">市值</div>
            <div className="mt-0.5 font-medium tnum">{usd.format(marketValue)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{basis === 'avg' ? '平均成本' : 'FIFO 成本'}</div>
            <div className="mt-0.5 font-medium tnum">
              {usd.format(basis === 'avg' ? position.avgCost : position.fifoCost)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">开仓盈亏</div>
            <div className={`mt-0.5 font-medium tnum ${changeColor(unrealizedUsd)}`}>
              {signedUsd(unrealizedUsd)} <span className="text-[10px]">({signedPct(unrealizedPct)})</span>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">今日盈亏</div>
            <div className={`mt-0.5 font-medium tnum ${changeColor(dayPLUsd)}`}>
              {dayPLUsd !== null ? signedUsd(dayPLUsd) : '—'}
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
