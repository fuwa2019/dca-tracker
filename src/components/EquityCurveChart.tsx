import { useMemo } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ComposedChart,
} from 'recharts';
import { motion } from 'framer-motion';
import {
  sliceByRange,
  availableRanges,
  aggregateMarkers,
  markerGranularityFor,
  type HistoryPoint,
  type RangeKey,
} from '@/lib/calc/history';
import { usd, signedUsd, signedPct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';

export type ChartMetric = 'returnPct' | 'pnl';

interface Props {
  history: HistoryPoint[];
  metric: ChartMetric;
  range: RangeKey;
  showBenchmark: boolean;
  benchmarkLabel?: string;
  /** When true, suppress transaction markers + per-day transaction detail in tooltip.
   *  Used by the public share view to avoid leaking trading dates/sizes. */
  redacted?: boolean;
}

export function EquityCurveChart({ history, metric, range, showBenchmark, benchmarkLabel = 'SPY', redacted = false }: Props) {
  const sliced = useMemo(() => sliceByRange(history, range), [history, range]);
  const markers = useMemo(
    () => (redacted ? [] : aggregateMarkers(sliced, markerGranularityFor(range))),
    [sliced, range, redacted],
  );

  if (sliced.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        暂无数据 - 录入交易后会显示资产曲线
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={sliced} margin={{ top: 12, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="2 4" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickMargin={6}
            interval="preserveStartEnd"
            tickFormatter={(v) => formatXTick(v as string, range)}
            minTickGap={36}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => formatYTick(v as number, metric)}
            width={metric === 'returnPct' ? 48 : 56}
            domain={['auto', 'auto']}
          />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" />

          {showBenchmark && (
            <Line
              type="monotone"
              dataKey={metric === 'returnPct' ? 'returnPctSpy' : 'pnlSpy'}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={sliced.length <= 14 ? { r: 2, strokeWidth: 0, fill: 'hsl(var(--muted-foreground))' } : false}
              name={`${benchmarkLabel} 对照`}
              isAnimationActive={false}
            />
          )}

          <Line
            type="monotone"
            dataKey={metric === 'returnPct' ? 'returnPctUser' : 'pnlUser'}
            stroke="hsl(var(--foreground))"
            strokeWidth={2.2}
            dot={sliced.length <= 14 ? { r: 3, strokeWidth: 0, fill: 'hsl(var(--foreground))' } : false}
            name="我的组合"
            activeDot={{ r: 5, strokeWidth: 0 }}
            isAnimationActive={false}
          />

          {markers.length > 0 && (
            <Scatter
              data={markers.map((m) => ({
                date: m.date,
                value: metric === 'returnPct' ? m.returnPctUser : m.pnlUser,
                _marker: m,
              }))}
              dataKey="value"
              shape={(props: { cx?: number; cy?: number; payload?: { _marker: typeof markers[number] } }) => {
                const m = props.payload?._marker;
                if (!m || props.cx == null || props.cy == null) return <g />;
                const isBuy = m.totalBuyUsd >= m.totalSellUsd;
                const r = m.hasLumpsum ? 5 : 3.5;
                const fill = isBuy ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)';
                return (
                  <g>
                    <circle cx={props.cx} cy={props.cy} r={r + 1.5} fill="hsl(var(--background))" />
                    <circle cx={props.cx} cy={props.cy} r={r} fill={fill} stroke="hsl(var(--background))" strokeWidth={1} />
                  </g>
                );
              }}
            />
          )}

          <Tooltip
            cursor={{ stroke: 'hsl(var(--foreground))', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={<EquityTooltip metric={metric} showBenchmark={showBenchmark} benchmarkLabel={benchmarkLabel} redacted={redacted} />}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

function formatYTick(v: number, metric: ChartMetric): string {
  if (metric === 'returnPct') return `${(v * 100).toFixed(0)}%`;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function formatXTick(iso: string, range: RangeKey): string {
  if (range === '1M' || range === '3M') {
    // MM/DD
    return iso.slice(5).replace('-', '/');
  }
  if (range === '6M' || range === 'YTD' || range === '1Y') {
    // MMM (e.g. Jan)
    const [, mm] = iso.split('-');
    return `${Number(mm)}月`;
  }
  // ALL: YYYY/MM
  return iso.slice(0, 7).replace('-', '/');
}

interface TooltipPayloadItem {
  payload?: HistoryPoint & { _marker?: ReturnType<typeof aggregateMarkers>[number] };
}

function EquityTooltip({
  metric,
  showBenchmark,
  benchmarkLabel,
  redacted,
  active,
  payload,
}: {
  metric: ChartMetric;
  showBenchmark: boolean;
  benchmarkLabel: string;
  redacted?: boolean;
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const userValue = metric === 'returnPct' ? point.returnPctUser : point.pnlUser;
  const spyValue = metric === 'returnPct' ? point.returnPctSpy : point.pnlSpy;
  const diff = userValue - spyValue;

  return (
    <div className="rounded-xl border bg-popover/95 px-3 py-2.5 shadow-lg backdrop-blur min-w-[160px] max-w-[260px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground tnum">{point.date}</div>
      <div className={cn('mt-1 text-base font-semibold tnum', changeColor(userValue))}>
        {metric === 'returnPct' ? signedPct(userValue) : signedUsd(userValue)}
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">我的</span>
      </div>
      {showBenchmark && (
        <>
          <div className={cn('text-sm tnum', changeColor(spyValue))}>
            {metric === 'returnPct' ? signedPct(spyValue) : signedUsd(spyValue)}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">{benchmarkLabel} 对照</span>
          </div>
          <div className={cn('mt-1 border-t pt-1 text-xs tnum', changeColor(diff))}>
            差值 {metric === 'returnPct' ? signedPct(diff) : signedUsd(diff)}
          </div>
        </>
      )}
      {!redacted && point.txns.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t pt-1.5">
          {point.txns.map((t, i) => (
            <div key={i} className="text-[11px] tnum">
              <span className={t.side === 'buy' ? 'text-success' : 'text-danger'}>{t.side === 'buy' ? '买' : '卖'}</span>{' '}
              <span className="font-medium">{t.ticker}</span> {t.shares.toFixed(4)} @ {usd.format(t.price)}
              {t.kind === 'lumpsum' && <span className="ml-1 text-amber-600">·大额</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------- Control surface --------------------
 * Re-exportable controls so Dashboard can place them in the card header.
 */

export function MetricToggle({ value, onChange }: { value: ChartMetric; onChange: (v: ChartMetric) => void }) {
  return (
    <div className="relative inline-flex rounded-lg bg-muted p-1 text-xs">
      {(['returnPct', 'pnl'] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'relative z-10 rounded-md px-3 py-1.5 font-medium transition-colors',
            value === opt ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt === 'returnPct' ? '收益率 %' : '收益金额 $'}
          {value === opt && (
            <motion.span
              layoutId="metric-toggle-pill"
              className="absolute inset-0 -z-10 rounded-md bg-background shadow-sm"
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

export function RangeToggle({
  value,
  onChange,
  available,
}: {
  value: RangeKey;
  onChange: (v: RangeKey) => void;
  available: RangeKey[];
}) {
  const all: RangeKey[] = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];
  return (
    <div className="relative inline-flex rounded-lg bg-muted p-1 text-xs">
      {all.map((opt) => {
        const ok = available.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            disabled={!ok}
            onClick={() => ok && onChange(opt)}
            title={ok ? undefined : '数据不足，无法显示此区间'}
            className={cn(
              'relative z-10 rounded-md px-2.5 py-1.5 font-medium transition-colors min-w-[36px]',
              !ok && 'cursor-not-allowed opacity-30',
              value === opt && ok ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt}
            {value === opt && ok && (
              <motion.span
                layoutId="range-toggle-pill"
                className="absolute inset-0 -z-10 rounded-md bg-background shadow-sm"
                transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export { availableRanges };
