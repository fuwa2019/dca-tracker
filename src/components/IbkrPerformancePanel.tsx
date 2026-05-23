import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Tooltip,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState } from '@/components/EmptyState';
import { changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { HistoryPoint, RangeKey } from '@/lib/calc/history';

const MAX_CHART_POINTS = 720;

// Chart line colors come from CSS variables so dark/light themes pick up automatically.
const PORTFOLIO_STROKE = 'hsl(var(--brand))';
const BENCHMARK_STROKE = 'hsl(var(--benchmark))';
const GRID_STROKE = 'hsl(var(--chart-grid))';
const AXIS_FILL = 'hsl(var(--chart-axis))';
const CROSSHAIR_STROKE = 'hsl(var(--crosshair))';

interface Props {
  history: HistoryPoint[];
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  availableRanges: RangeKey[];
  showBenchmark: boolean;
  onShowBenchmarkChange: (show: boolean) => void;
  loading?: boolean;
  /** Hide the SPY toggle entirely (used by Share view where the toggle adds noise). */
  hideBenchmarkToggle?: boolean;
  emptyMessage?: string;
}

type PerfRow = {
  date: string;
  spyPeriodReturn: number;
  portfolioPeriodReturn: number;
  spyCumulativeReturn: number;
  portfolioCumulativeReturn: number;
  excessCumulativeReturn: number;
};

type ChartRow = PerfRow & {
  spyCumulativePct: number;
  portfolioCumulativePct: number;
  excessCumulativePct: number;
};

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string }> = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: '开仓至今' },
];

export function IbkrPerformancePanel(props: Props) {
  return <PerformancePanel {...props} />;
}

export function PerformancePanel({
  history,
  range,
  onRangeChange,
  availableRanges,
  showBenchmark,
  onShowBenchmarkChange,
  loading = false,
  hideBenchmarkToggle = false,
  emptyMessage,
}: Props) {
  const [page, setPage] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  const performanceRows = useMemo(() => buildPerformanceRows(history), [history]);
  const filteredRanges = RANGE_OPTIONS.filter((r) => availableRanges.includes(r.value));
  const safeRange = filteredRanges.find((r) => r.value === range)
    ? range
    : (filteredRanges[filteredRanges.length - 1]?.value ?? range);
  const visibleRows = useMemo(() => sliceRowsByRange(performanceRows, safeRange), [performanceRows, safeRange]);
  const fullChartRows = useMemo<ChartRow[]>(
    () =>
      visibleRows.map((row) => ({
        ...row,
        spyCumulativePct: row.spyCumulativeReturn * 100,
        portfolioCumulativePct: row.portfolioCumulativeReturn * 100,
        excessCumulativePct: row.excessCumulativeReturn * 100,
      })),
    [visibleRows],
  );
  const chartRows = useMemo(() => downsampleChartRows(fullChartRows, MAX_CHART_POINTS), [fullChartRows]);
  const summary = useMemo(() => buildSummary(performanceRows), [performanceRows]);
  const dateLabel = visibleRows.length > 0
    ? `${visibleRows[0].date} 至 ${visibleRows[visibleRows.length - 1].date}`
    : '暂无日期范围';

  useEffect(() => setPage(0), [safeRange, history.length]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-border bg-surface-elevated/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Mobile: label + controls row */}
          <div className="flex items-center justify-between gap-2 sm:hidden">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              时间段
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="查看业绩计算说明"
                aria-expanded={infoOpen}
                onClick={() => setInfoOpen((v) => !v)}
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground',
                  infoOpen && 'border-brand/40 text-brand',
                )}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              {!hideBenchmarkToggle && (
                <BenchmarkToggle
                  checked={showBenchmark}
                  onCheckedChange={onShowBenchmarkChange}
                />
              )}
            </div>
          </div>

          {/* Desktop: label + segmented control */}
          <div className="hidden items-center gap-3 sm:flex">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">
              时间段
            </span>
            {filteredRanges.length > 0 ? (
              <SegmentedControl
                value={safeRange}
                onChange={(v) => onRangeChange(v as RangeKey)}
                options={filteredRanges}
                size="sm"
                name="perf-range"
                ariaLabel="选择时间段"
              />
            ) : (
              <span className="text-xs text-muted-foreground">暂无数据</span>
            )}
          </div>

          {/* Mobile: scrollable segmented control */}
          <div className="overflow-x-auto sm:hidden">
            {filteredRanges.length > 0 ? (
              <SegmentedControl
                value={safeRange}
                onChange={(v) => onRangeChange(v as RangeKey)}
                options={filteredRanges}
                size="sm"
                name="perf-range-mobile"
                ariaLabel="选择时间段"
              />
            ) : (
              <span className="text-xs text-muted-foreground">暂无数据</span>
            )}
          </div>

          {/* Desktop: info + SPY toggle */}
          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              aria-label="查看业绩计算说明"
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((v) => !v)}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground',
                infoOpen && 'border-brand/40 text-brand',
              )}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            {!hideBenchmarkToggle && (
              <BenchmarkToggle
                checked={showBenchmark}
                onCheckedChange={onShowBenchmarkChange}
              />
            )}
          </div>
        </div>

        {infoOpen && (
          <div className="border-b border-border bg-surface px-4 py-3 text-[12px] leading-5 text-muted-foreground">
            累积基准比较采用日链接时间加权回报 (TWR)。组合线来自已录入交易、资金流和复权日线；SPY 基准线假设每次可投资现金流在同日买入 SPY。超额收益按
            {' '}(1+组合)/(1+SPY)-1 计算。
          </div>
        )}

        {history.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              icon={Info}
              title={loading ? '正在拉取历史数据...' : (emptyMessage ?? '暂无业绩数据')}
              description={loading ? undefined : '录入交易和资金流后会自动生成时间加权收益率曲线。'}
            />
          </div>
        ) : (
          <>
            <SummaryTable dateLabel={dateLabel} summary={summary} showBenchmark={showBenchmark} />
            <PerformanceChart rows={chartRows} showBenchmark={showBenchmark} />
            <PerformanceDetailTable
              tableRows={visibleRows}
              showBenchmark={showBenchmark}
              page={page}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      <p className="text-[11px] leading-5 text-muted-foreground">
        业绩基于已录入交易、资金流和日线复权价；曲线采用日链接时间加权回报 (TWR)。历史数据仅供分析参考，不构成投资建议。
      </p>
    </div>
  );
}

function BenchmarkToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className="inline-flex items-center gap-2 text-xs"
    >
      <span
        className={cn(
          'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
          checked ? 'bg-benchmark' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-3 w-3 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
      <span className={cn(checked ? 'text-foreground' : 'text-muted-foreground')}>
        显示 SPY 基准
      </span>
    </button>
  );
}

function SummaryTable({
  dateLabel,
  summary,
  showBenchmark,
}: {
  dateLabel: string;
  summary: ReturnType<typeof buildSummary>;
  showBenchmark: boolean;
}) {
  const headers = ['本月', '本季', '本年', '开仓至今'];
  return (
    <div className="border-b border-border">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <div className="text-sm font-semibold tracking-tight">历史业绩</div>
        <div className="text-[11px] text-muted-foreground tnum">{dateLabel}</div>
      </div>
      <div className="px-4 pb-3 pt-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="w-40 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wider whitespace-nowrap"></th>
                {headers.map((h) => (
                  <th key={h} className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showBenchmark && (
                <SummaryRow name="SPY 基准" swatch={BENCHMARK_STROKE} values={summary.spy} muted />
              )}
              <SummaryRow name="组合 NAV" swatch={PORTFOLIO_STROKE} values={summary.portfolio} bold />
              {showBenchmark && (
                <SummaryRow name="超额 vs SPY" values={summary.excess} dashed />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  name,
  values,
  swatch,
  bold = false,
  muted = false,
  dashed = false,
}: {
  name: string;
  values: number[];
  swatch?: string;
  bold?: boolean;
  muted?: boolean;
  dashed?: boolean;
}) {
  return (
    <tr>
      <td className="px-2 py-2">
        <span className="inline-flex items-center gap-2">
          {swatch ? (
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: swatch }}
            />
          ) : (
            <span
              aria-hidden
              className={cn(
                'inline-block h-0.5 w-3 rounded-sm bg-muted-foreground/40',
                dashed && 'border-t border-dashed border-muted-foreground/60 bg-transparent',
              )}
            />
          )}
          <span className={cn('text-foreground', muted && 'text-muted-foreground')}>{name}</span>
        </span>
      </td>
      {values.map((value, i) => (
        <td
          key={i}
          className={cn(
            'px-2 py-2 text-right tnum',
            bold && 'font-semibold',
            changeColor(value),
          )}
        >
          {formatSignedPct(value)}
        </td>
      ))}
    </tr>
  );
}

function PerformanceChart({ rows, showBenchmark }: { rows: ChartRow[]; showBenchmark: boolean }) {
  const domain = chartDomain(
    rows.flatMap((row) => [showBenchmark ? row.spyCumulativePct : 0, row.portfolioCumulativePct]),
  );

  return (
    <div className="h-[340px] px-2 pb-1 pt-4 sm:h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          key={showBenchmark ? 'with-benchmark' : 'portfolio-only'}
          data={rows}
          margin={{ top: 8, right: 14, left: 6, bottom: 24 }}
        >
          <CartesianGrid stroke={GRID_STROKE} strokeWidth={1} vertical={false} />
          <Tooltip
            cursor={<CrosshairCursor domain={domain} />}
            content={<PerformanceTooltip showBenchmark={showBenchmark} />}
            isAnimationActive={false}
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={28}
            tick={<AxisTick />}
            interval="preserveStartEnd"
            height={36}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: AXIS_FILL }}
            width={48}
            domain={domain}
            tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
          />
          {showBenchmark && (
            <Line
              type="linear"
              dataKey="spyCumulativePct"
              stroke={BENCHMARK_STROKE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: BENCHMARK_STROKE }}
              isAnimationActive={false}
            />
          )}
          <Line
            type="linear"
            dataKey="portfolioCumulativePct"
            stroke={PORTFOLIO_STROKE}
            strokeWidth={2.2}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 0, fill: PORTFOLIO_STROKE }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PerformanceTooltip({
  active,
  payload,
  label,
  showBenchmark,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; payload?: ChartRow }>;
  label?: string;
  showBenchmark: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-[12px] shadow-md min-w-[170px] max-w-[280px]">
      <div className="mb-1.5 text-[11px] text-muted-foreground tnum">{label ?? row.date}</div>
      <Row
        swatch={PORTFOLIO_STROKE}
        label="组合累计"
        value={row.portfolioCumulativeReturn}
        bold
      />
      {showBenchmark && (
        <Row swatch={BENCHMARK_STROKE} label="SPY累计" value={row.spyCumulativeReturn} />
      )}
      {showBenchmark && (
        <Row label="超额" value={row.excessCumulativeReturn} dashed />
      )}
      <div className="my-1 border-t border-border" />
      <Row label="组合当日" value={row.portfolioPeriodReturn} />
      {showBenchmark && (
        <Row label="SPY当日" value={row.spyPeriodReturn} />
      )}
    </div>
  );
}

function Row({
  swatch,
  label,
  value,
  bold,
  dashed,
}: {
  swatch?: string;
  label: string;
  value: number;
  bold?: boolean;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5 text-[12px]">
      <span className="inline-flex items-center gap-2">
        {swatch ? (
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: swatch }} />
        ) : (
          <span aria-hidden className={cn('inline-block h-0.5 w-3', dashed ? 'border-t border-dashed border-muted-foreground' : 'bg-muted-foreground/40')} />
        )}
        <span className="text-muted-foreground">{label}</span>
      </span>
      <span className={cn('tnum', bold && 'font-semibold', changeColor(value))}>
        {formatSignedPct(value)}
      </span>
    </div>
  );
}

function CrosshairCursor({
  points,
  left = 0,
  top = 0,
  width = 0,
  height = 0,
  domain,
  payload,
}: {
  points?: Array<{ x?: number; y?: number }>;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  domain?: [number, number];
  payload?: Array<{ payload?: ChartRow }>;
}) {
  const x = points?.[0]?.x;
  const row = payload?.[0]?.payload;
  const yValue = row?.portfolioCumulativePct;
  const [min, max] = domain ?? [0, 0];
  const y = typeof yValue === 'number' && max !== min
    ? top + ((max - yValue) / (max - min)) * height
    : undefined;

  if (typeof x !== 'number') return null;

  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={top} y2={top + height} stroke={CROSSHAIR_STROKE} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
      {typeof y === 'number' && (
        <line x1={left} x2={left + width} y1={y} y2={y} stroke={CROSSHAIR_STROKE} strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />
      )}
    </g>
  );
}

function PerformanceDetailTable({
  tableRows,
  showBenchmark,
  page,
  onPageChange,
}: {
  tableRows: PerfRow[];
  showBenchmark: boolean;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageSize = 10;
  const orderedRows = useMemo(() => tableRows.slice().reverse(), [tableRows]);
  const pageCount = Math.max(1, Math.ceil(orderedRows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = orderedRows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <div className="border-t border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface-elevated/50 text-muted-foreground">
              <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">日期</th>
              {showBenchmark && (
                <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">SPY 累计 %</th>
              )}
              <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">组合 累计 %</th>
              {showBenchmark && (
                <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">超额 %</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.date} className="border-b border-border last:border-0 hover:bg-surface-elevated/40">
                <td className="px-4 py-2 text-left tnum">{row.date}</td>
                {showBenchmark && (
                  <td className={cn('px-4 py-2 text-right tnum', changeColor(row.spyCumulativeReturn))}>
                    {formatSignedPct(row.spyCumulativeReturn)}
                  </td>
                )}
                <td className={cn('px-4 py-2 text-right font-medium tnum', changeColor(row.portfolioCumulativeReturn))}>
                  {formatSignedPct(row.portfolioCumulativeReturn)}
                </td>
                {showBenchmark && (
                  <td className={cn('px-4 py-2 text-right tnum', changeColor(row.excessCumulativeReturn))}>
                    {formatSignedPct(row.excessCumulativeReturn)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={safePage} pageCount={pageCount} onPageChange={onPageChange} />
    </div>
  );
}

function Pager({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2 text-[11px] text-muted-foreground">
      <span>第</span>
      <span className="tnum text-foreground">{page + 1}</span>
      <span>/</span>
      <span className="tnum">{pageCount}</span>
      <button
        type="button"
        className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface disabled:opacity-40"
        disabled={page === 0}
        onClick={() => onPageChange(Math.max(0, page - 1))}
        aria-label="上一页"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface disabled:opacity-40"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
        aria-label="下一页"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  if (x == null || y == null || !payload?.value) return null;
  const [year, month, day] = payload.value.split('-');
  return (
    <g transform={`translate(${x},${y + 8})`}>
      <text textAnchor="middle" fill={AXIS_FILL} fontSize={11}>
        <tspan x={0} dy={0}>{year}</tspan>
        <tspan x={0} dy={12}>{Number(month)}/{Number(day)}</tspan>
      </text>
    </g>
  );
}

function buildPerformanceRows(history: HistoryPoint[]): PerfRow[] {
  return history.map((point, index) => {
    const prev = index > 0 ? history[index - 1] : null;
    const spyPeriod = prev ? periodReturn(prev.returnPctSpy, point.returnPctSpy) : 0;
    const portfolioPeriod = prev ? periodReturn(prev.returnPctUser, point.returnPctUser) : 0;
    const excessCum = excessReturn(point.returnPctUser, point.returnPctSpy);
    return {
      date: point.date,
      spyPeriodReturn: spyPeriod,
      portfolioPeriodReturn: portfolioPeriod,
      spyCumulativeReturn: point.returnPctSpy,
      portfolioCumulativeReturn: point.returnPctUser,
      excessCumulativeReturn: excessCum,
    };
  });
}

function excessReturn(portfolio: number, benchmark: number): number {
  const denom = 1 + benchmark;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) return 0;
  const value = (1 + portfolio) / denom - 1;
  return Number.isFinite(value) ? value : 0;
}

function sliceRowsByRange(rows: PerfRow[], range: RangeKey): PerfRow[] {
  if (range === 'ALL' || rows.length === 0) return rows;
  const last = rows[rows.length - 1];
  const days = { '1M': 30, '3M': 92, '6M': 184, '1Y': 365 }[range];
  const cutoff = addDays(last.date, -days);
  return rows.filter((row) => row.date >= cutoff);
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function periodReturn(prevCumulative: number, currentCumulative: number): number {
  const base = 1 + prevCumulative;
  if (!Number.isFinite(base) || Math.abs(base) < 1e-9) return 0;
  const value = (1 + currentCumulative) / base - 1;
  return Number.isFinite(value) ? value : 0;
}

function buildSummary(rows: PerfRow[]) {
  const end = rows[rows.length - 1];
  const empty = [0, 0, 0, 0];
  if (!end) return { spy: empty, portfolio: empty, excess: empty };
  const portfolio = [
    returnSince(rows, startOfMonth(end.date), 'portfolioCumulativeReturn'),
    returnSince(rows, startOfQuarter(end.date), 'portfolioCumulativeReturn'),
    returnSince(rows, `${end.date.slice(0, 4)}-01-01`, 'portfolioCumulativeReturn'),
    end.portfolioCumulativeReturn,
  ];
  const spy = [
    returnSince(rows, startOfMonth(end.date), 'spyCumulativeReturn'),
    returnSince(rows, startOfQuarter(end.date), 'spyCumulativeReturn'),
    returnSince(rows, `${end.date.slice(0, 4)}-01-01`, 'spyCumulativeReturn'),
    end.spyCumulativeReturn,
  ];
  const excess = portfolio.map((p, i) => excessReturn(p, spy[i]));
  return { spy, portfolio, excess };
}

function returnSince(rows: PerfRow[], startDate: string, key: 'spyCumulativeReturn' | 'portfolioCumulativeReturn') {
  const end = rows[rows.length - 1]?.[key] ?? 0;
  let previous = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].date < startDate) {
      previous = rows[i][key];
      break;
    }
  }
  return periodReturn(previous, end);
}

function startOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function startOfQuarter(iso: string) {
  const year = iso.slice(0, 4);
  const month = Number(iso.slice(5, 7));
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(quarterStart).padStart(2, '0')}-01`;
}

function chartDomain(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [-1, 1];
  const min = Math.min(0, ...finite);
  const max = Math.max(0, ...finite);
  if (Math.abs(max - min) < 0.01) return [-1, 1];
  const pad = Math.max(0.25, (max - min) * 0.15);
  return [roundDown(min - pad), roundUp(max + pad)];
}

function roundDown(value: number) {
  return Math.floor(value * 2) / 2;
}

function roundUp(value: number) {
  return Math.ceil(value * 2) / 2;
}

function formatSignedPct(value: number) {
  if (!Number.isFinite(value)) return '—';
  const pct = value * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function downsampleChartRows(rows: ChartRow[], maxPoints: number) {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  const sampled: ChartRow[] = [];
  for (let i = 0; i < rows.length; i += step) sampled.push(rows[i]);
  const last = rows[rows.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}
