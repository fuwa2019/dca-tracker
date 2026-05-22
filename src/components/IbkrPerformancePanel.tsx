import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import type { HistoryPoint, RangeKey } from '@/lib/calc/history';
import { cn } from '@/lib/utils';

const BLUE = '#0070C9';
const DEEP_BLUE = '#0057D8';
const GREEN = '#8BC34A';
const BORDER = '#DCDCDC';
const GRID = '#EEEEEE';
const TEXT = '#111111';
const SECONDARY = '#6B7280';
const PANEL = '#F5F8FC';

interface Props {
  history: HistoryPoint[];
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  availableRanges: RangeKey[];
  showBenchmark: boolean;
  onShowBenchmarkChange: (show: boolean) => void;
  loading?: boolean;
}

type PerfRow = {
  date: string;
  spyPeriodReturn: number;
  portfolioPeriodReturn: number;
  spyCumulativeReturn: number;
  portfolioCumulativeReturn: number;
};

type ChartRow = PerfRow & {
  spyPeriodPct: number;
  portfolioPeriodPct: number;
  spyCumulativePct: number;
  portfolioCumulativePct: number;
};

export function IbkrPerformancePanel({
  history,
  range,
  onRangeChange,
  availableRanges,
  showBenchmark,
  onShowBenchmarkChange,
  loading = false,
}: Props) {
  const [periodPage, setPeriodPage] = useState(0);
  const [cumulativePage, setCumulativePage] = useState(0);

  const performanceRows = useMemo(() => buildPerformanceRows(history), [history]);
  const visibleRows = useMemo(() => sliceRowsByRange(performanceRows, range), [performanceRows, range]);
  const chartRows = useMemo<ChartRow[]>(
    () =>
      visibleRows.map((row) => ({
        ...row,
        spyPeriodPct: row.spyPeriodReturn * 100,
        portfolioPeriodPct: row.portfolioPeriodReturn * 100,
        spyCumulativePct: row.spyCumulativeReturn * 100,
        portfolioCumulativePct: row.portfolioCumulativeReturn * 100,
      })),
    [visibleRows],
  );

  const summary = useMemo(() => buildSummary(performanceRows), [performanceRows]);
  const dateLabel = visibleRows.length > 0
    ? `${visibleRows[0].date} 至 ${visibleRows[visibleRows.length - 1].date}`
    : '暂无日期范围';

  if (history.length === 0) {
    return (
      <div className="border bg-white p-10 text-center text-[13px]" style={{ borderColor: BORDER, color: SECONDARY }}>
        {loading ? '正在拉取历史价格...' : '暂无数据 - 录入交易和资金流后会显示资产曲线'}
      </div>
    );
  }

  return (
    <section className="space-y-6 text-[13px]" style={{ color: TEXT }}>
      <FilterPanel
        range={range}
        availableRanges={availableRanges}
        onRangeChange={onRangeChange}
        showBenchmark={showBenchmark}
        onShowBenchmarkChange={onShowBenchmarkChange}
      />

      <SummaryTable dateLabel={dateLabel} summary={summary} showBenchmark={showBenchmark} />

      <div className="grid gap-8 xl:grid-cols-2">
        <PerformanceChartCard
          title="时间段基准比较"
          dateLabel={dateLabel}
          rows={chartRows}
          tableRows={visibleRows}
          chartKind="period"
          showBenchmark={showBenchmark}
          page={periodPage}
          onPageChange={setPeriodPage}
        />
        <PerformanceChartCard
          title="累积基准比较"
          dateLabel={dateLabel}
          rows={chartRows}
          tableRows={visibleRows}
          chartKind="cumulative"
          showBenchmark={showBenchmark}
          page={cumulativePage}
          onPageChange={setCumulativePage}
        />
      </div>

      <div className="border px-4 py-3 text-[12px] leading-5" style={{ borderColor: BORDER, background: PANEL, color: SECONDARY }}>
        业绩表现基于已录入交易、资金流和日线价格计算；收益率采用日链接时间加权回报。历史数据仅供分析参考，不构成投资建议。
      </div>
    </section>
  );
}

function FilterPanel({
  range,
  availableRanges,
  onRangeChange,
  showBenchmark,
  onShowBenchmarkChange,
}: {
  range: RangeKey;
  availableRanges: RangeKey[];
  onRangeChange: (range: RangeKey) => void;
  showBenchmark: boolean;
  onShowBenchmarkChange: (show: boolean) => void;
}) {
  const ranges: Array<{ key: RangeKey; label: string }> = [
    { key: '1M', label: '1月' },
    { key: '3M', label: '3月' },
    { key: '6M', label: '6月' },
    { key: '1Y', label: '1年' },
    { key: 'ALL', label: '开户至今' },
  ];

  return (
    <div className="flex min-h-[110px] flex-wrap items-start gap-x-8 gap-y-4 px-5 py-4" style={{ background: PANEL }}>
      <FilterGroup title="时间段">
        {ranges.map(({ key, label }) => {
          const ok = availableRanges.includes(key);
          return (
            <button
              key={key}
              type="button"
              disabled={!ok}
              onClick={() => ok && onRangeChange(key)}
              className={cn('h-6 border px-2.5 text-[12px] disabled:opacity-35')}
              style={buttonStyle(range === key)}
            >
              {label}
            </button>
          );
        })}
      </FilterGroup>

      <FilterGroup title="频率">
        <button type="button" className="h-6 border px-2.5 text-[12px]" style={buttonStyle(true)}>每日</button>
      </FilterGroup>

      <FilterGroup title="业绩表现衡量">
        <button type="button" className="h-6 border px-2.5 text-[12px]" style={buttonStyle(true)}>时间加权回报</button>
      </FilterGroup>

      <FilterGroup title="基准">
        <button
          type="button"
          onClick={() => onShowBenchmarkChange(!showBenchmark)}
          className="h-6 rounded-full border px-3 text-[12px]"
          style={{
            background: '#FFFFFF',
            borderColor: showBenchmark ? '#B8D8C0' : BORDER,
            color: showBenchmark ? '#1B7F3A' : SECONDARY,
          }}
        >
          {showBenchmark ? '✓ SPY' : 'SPY'}
        </button>
      </FilterGroup>

      <FilterGroup title="实时">
        <button type="button" className="h-6 border px-2.5 text-[12px]" style={buttonStyle(false)}>日线收盘价</button>
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[12px]" style={{ color: '#333333' }}>{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
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
  return (
    <div className="border bg-white" style={{ borderColor: BORDER, borderRadius: 3 }}>
      <div className="flex items-start justify-between px-4 py-3">
        <div>
          <div className="text-[16px] font-semibold" style={{ color: TEXT }}>历史业绩</div>
          <div className="mt-1 text-[11px]" style={{ color: SECONDARY }}>{dateLabel}</div>
        </div>
        <label className="flex items-center gap-2 text-[12px]" style={{ color: '#333333' }}>
          <input type="checkbox" className="h-3.5 w-3.5" />
          年化收益率
        </label>
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-t border-b" style={{ borderColor: '#E5E5E5' }}>
            <th className="px-4 py-2 text-left font-medium" />
            {['MTD %', 'QTD %', 'YTD %', '开户至今 %'].map((h) => (
              <th key={h} className="px-4 py-2 text-right font-medium" style={{ color: TEXT }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showBenchmark && <SummaryRow name="SPY" color={GREEN} values={summary.spy} />}
          <SummaryRow name="Consolidated" color={BLUE} values={summary.portfolio} />
        </tbody>
      </table>
    </div>
  );
}

function SummaryRow({ name, color, values }: { name: string; color: string; values: number[] }) {
  return (
    <tr className="border-b last:border-b-0" style={{ borderColor: '#E5E5E5' }}>
      <td className="px-4 py-2.5">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5" style={{ background: color }} />
          {name}
        </span>
      </td>
      {values.map((value, i) => (
        <td key={i} className="px-4 py-2.5 text-right tabular-nums" style={{ color: TEXT }}>
          {formatPct(value)}
        </td>
      ))}
    </tr>
  );
}

function PerformanceChartCard({
  title,
  dateLabel,
  rows,
  tableRows,
  chartKind,
  showBenchmark,
  page,
  onPageChange,
}: {
  title: string;
  dateLabel: string;
  rows: ChartRow[];
  tableRows: PerfRow[];
  chartKind: 'period' | 'cumulative';
  showBenchmark: boolean;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = tableRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const keys = chartKind === 'period'
    ? ['spyPeriodPct', 'portfolioPeriodPct'] as const
    : ['spyCumulativePct', 'portfolioCumulativePct'] as const;
  const domain = chartDomain(rows.flatMap((row) => [
    showBenchmark ? row[keys[0]] : 0,
    row[keys[1]],
  ]));

  return (
    <div className="overflow-hidden border bg-white" style={{ borderColor: BORDER, borderRadius: 3 }}>
      <div className="flex h-[72px] items-start justify-between border-b px-4 py-3" style={{ borderColor: '#E5E5E5' }}>
        <div>
          <div className="text-[16px] font-semibold" style={{ color: TEXT }}>{title}</div>
          <div className="mt-1 text-[11px]" style={{ color: SECONDARY }}>{dateLabel}</div>
        </div>
        <div
          className="flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none text-white"
          style={{ background: DEEP_BLUE }}
          title="时间加权收益率"
        >
          ?
        </div>
      </div>

      <div className="h-[380px] bg-white px-3 pb-2 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 12, right: 18, left: 6, bottom: 28 }}>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              minTickGap={28}
              tick={<IbkrXAxisTick />}
              interval="preserveStartEnd"
              height={42}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: SECONDARY }}
              width={56}
              domain={domain}
              tickFormatter={(value) => `${Number(value).toFixed(2)}%`}
            />
            {showBenchmark && (
              <Line
                type="linear"
                dataKey={keys[0]}
                stroke={GREEN}
                strokeWidth={2}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="linear"
              dataKey={keys[1]}
              stroke={BLUE}
              strokeWidth={2}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <PerformanceTable rows={pageRows} chartKind={chartKind} showBenchmark={showBenchmark} />
      <Pager page={safePage} pageCount={pageCount} onPageChange={onPageChange} />
    </div>
  );
}

function PerformanceTable({
  rows,
  chartKind,
  showBenchmark,
}: {
  rows: PerfRow[];
  chartKind: 'period' | 'cumulative';
  showBenchmark: boolean;
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-t border-b" style={{ borderColor: '#E5E5E5' }}>
          <th className="px-4 py-2 text-left font-medium" style={{ color: TEXT }}>日期</th>
          <th className="px-4 py-2 text-right font-medium" style={{ color: TEXT }}>
            <span className="inline-flex items-center justify-end gap-2">
              <span className="h-2.5 w-2.5" style={{ background: GREEN }} />
              SPY %
            </span>
          </th>
          <th className="px-4 py-2 text-right font-medium" style={{ color: TEXT, background: PANEL }}>
            <span className="inline-flex items-center justify-end gap-2">
              <span className="h-2.5 w-2.5" style={{ background: BLUE }} />
              Consolidated %
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const spy = chartKind === 'period' ? row.spyPeriodReturn : row.spyCumulativeReturn;
          const portfolio = chartKind === 'period' ? row.portfolioPeriodReturn : row.portfolioCumulativeReturn;
          return (
            <tr key={row.date} className="h-9 border-b" style={{ borderColor: '#E5E5E5' }}>
              <td className="px-4 text-left tabular-nums">{row.date}</td>
              <td className="px-4 text-right tabular-nums">{showBenchmark ? formatPct(spy) : '-'}</td>
              <td className="px-4 text-right tabular-nums" style={{ background: PANEL }}>{formatPct(portfolio)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
    <div className="flex h-8 items-center justify-between px-4 text-[12px]" style={{ color: '#333333' }}>
      <button type="button" className="h-6 border bg-white px-2" style={{ borderColor: BORDER, borderRadius: 3 }}>10结果</button>
      <div className="flex items-center gap-2">
        <span>页面</span>
        <span className="border bg-white px-2 py-0.5 tabular-nums" style={{ borderColor: BORDER, borderRadius: 3 }}>{page + 1}</span>
        <span>/</span>
        <span className="tabular-nums">{pageCount}</span>
        <button
          type="button"
          className="h-6 w-6 border bg-white disabled:opacity-35"
          style={{ borderColor: BORDER, borderRadius: 3 }}
          disabled={page === 0}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          &lt;
        </button>
        <button
          type="button"
          className="h-6 w-6 border bg-white disabled:opacity-35"
          style={{ borderColor: BORDER, borderRadius: 3 }}
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
        >
          &gt;
        </button>
      </div>
    </div>
  );
}

function IbkrXAxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  if (x == null || y == null || !payload?.value) return null;
  const [year, month, day] = payload.value.split('-');
  return (
    <g transform={`translate(${x},${y + 8})`}>
      <text textAnchor="middle" fill={SECONDARY} fontSize={11}>
        <tspan x={0} dy={0}>{year}</tspan>
        <tspan x={0} dy={13}>{Number(month)}/{Number(day)}</tspan>
      </text>
    </g>
  );
}

function buttonStyle(selected: boolean): CSSProperties {
  return {
    borderColor: selected ? '#4F86E8' : '#D5D9E0',
    borderRadius: 4,
    background: selected ? '#EAF2FF' : '#FFFFFF',
    color: selected ? DEEP_BLUE : '#333333',
  };
}

function buildPerformanceRows(history: HistoryPoint[]): PerfRow[] {
  return history.map((point, index) => {
    const prev = index > 0 ? history[index - 1] : null;
    const spyPeriod = prev ? periodReturn(prev.returnPctSpy, point.returnPctSpy) : 0;
    const portfolioPeriod = prev ? periodReturn(prev.returnPctUser, point.returnPctUser) : 0;
    return {
      date: point.date,
      spyPeriodReturn: spyPeriod,
      portfolioPeriodReturn: portfolioPeriod,
      spyCumulativeReturn: point.returnPctSpy,
      portfolioCumulativeReturn: point.returnPctUser,
    };
  });
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
  if (!end) return { spy: empty, portfolio: empty };
  return {
    spy: [
      returnSince(rows, startOfMonth(end.date), 'spyCumulativeReturn'),
      returnSince(rows, startOfQuarter(end.date), 'spyCumulativeReturn'),
      returnSince(rows, `${end.date.slice(0, 4)}-01-01`, 'spyCumulativeReturn'),
      end.spyCumulativeReturn,
    ],
    portfolio: [
      returnSince(rows, startOfMonth(end.date), 'portfolioCumulativeReturn'),
      returnSince(rows, startOfQuarter(end.date), 'portfolioCumulativeReturn'),
      returnSince(rows, `${end.date.slice(0, 4)}-01-01`, 'portfolioCumulativeReturn'),
      end.portfolioCumulativeReturn,
    ],
  };
}

function returnSince(rows: PerfRow[], startDate: string, key: 'spyCumulativeReturn' | 'portfolioCumulativeReturn') {
  const end = rows[rows.length - 1]?.[key] ?? 0;
  const previous = [...rows].reverse().find((row) => row.date < startDate)?.[key] ?? 0;
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

function formatPct(value: number) {
  if (!Number.isFinite(value)) return '-';
  return (value * 100).toFixed(2);
}
