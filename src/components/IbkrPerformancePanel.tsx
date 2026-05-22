import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CartesianGrid,
  Tooltip,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import type { HistoryPoint, RangeKey } from '@/lib/calc/history';
import { fetchHistory, type HistorySeries } from '@/lib/quote';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const BLUE = '#0070C9';
const DEEP_BLUE = '#0057D8';
const GREEN = '#8BC34A';
const BORDER = '#DCDCDC';
const GRID = '#EEEEEE';
const TEXT = '#111111';
const SECONDARY = '#6B7280';
const PANEL = '#F5F8FC';
const DEMO_NOTE = '[DCA_TEST_10Y_60_QQQ]';
const LEGACY_DEMO_NOTE = '[DCA_TEST_10Y_60_VOO]';
const DEMO_TICKER = 'QQQ';
const DEMO_MONTHLY_USD = 60;
const DEMO_RATE = 7.2;

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
  const [cumulativePage, setCumulativePage] = useState(0);
  const demoData = useDemoDcaData();

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

  useEffect(() => setCumulativePage(0), [range, history.length]);

  return (
    <section className="space-y-6 text-[13px]" style={{ color: TEXT }}>
      <FilterPanel
        range={range}
        availableRanges={availableRanges}
        onRangeChange={onRangeChange}
        showBenchmark={showBenchmark}
        onShowBenchmarkChange={onShowBenchmarkChange}
        demoData={demoData}
      />

      {history.length === 0 ? (
        <div className="border bg-white p-10 text-center text-[13px]" style={{ borderColor: BORDER, color: SECONDARY }}>
          {loading ? '正在拉取历史价格...' : '暂无数据 - 录入交易和资金流后会显示资产曲线'}
        </div>
      ) : (
        <>
          <SummaryTable dateLabel={dateLabel} summary={summary} showBenchmark={showBenchmark} />

          <PerformanceChartCard
            title="累积基准比较"
            dateLabel={dateLabel}
            rows={chartRows}
            tableRows={visibleRows}
            showBenchmark={showBenchmark}
            page={cumulativePage}
            onPageChange={setCumulativePage}
          />
        </>
      )}

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
  demoData,
}: {
  range: RangeKey;
  availableRanges: RangeKey[];
  onRangeChange: (range: RangeKey) => void;
  showBenchmark: boolean;
  onShowBenchmarkChange: (show: boolean) => void;
  demoData: ReturnType<typeof useDemoDcaData>;
}) {
  const ranges: Array<{ key: RangeKey; label: string }> = [
    { key: '1M', label: '1月' },
    { key: '3M', label: '3月' },
    { key: '6M', label: '6月' },
    { key: '1Y', label: '1年' },
    { key: 'ALL', label: '开仓至今' },
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

      <FilterGroup title="测试数据">
        <button
          type="button"
          disabled={demoData.busy}
          onClick={() => demoData.seed()}
          className="h-6 border px-2.5 text-[12px] disabled:opacity-45"
          style={buttonStyle(false)}
        >
          {demoData.seeding ? '生成中...' : '生成10年定投'}
        </button>
        <button
          type="button"
          disabled={demoData.busy}
          onClick={() => demoData.clear()}
          className="h-6 border px-2.5 text-[12px] disabled:opacity-45"
          style={buttonStyle(false)}
        >
          {demoData.clearing ? '清除中...' : '清除测试'}
        </button>
        {demoData.message && (
          <span className="ml-1 self-center text-[11px]" style={{ color: SECONDARY }}>{demoData.message}</span>
        )}
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
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-t border-b" style={{ borderColor: '#E5E5E5' }}>
            <th className="px-4 py-2 text-left font-medium" />
            {['MTD %', 'QTD %', 'YTD %', '开仓至今 %'].map((h) => (
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
  showBenchmark,
  page,
  onPageChange,
}: {
  title: string;
  dateLabel: string;
  rows: ChartRow[];
  tableRows: PerfRow[];
  showBenchmark: boolean;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = tableRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const [infoOpen, setInfoOpen] = useState(false);
  const domain = chartDomain(rows.flatMap((row) => [
    showBenchmark ? row.spyCumulativePct : 0,
    row.portfolioCumulativePct,
  ]));

  return (
    <div className="overflow-hidden border bg-white" style={{ borderColor: BORDER, borderRadius: 3 }}>
      <div className="relative flex h-[72px] items-start justify-between border-b px-4 py-3" style={{ borderColor: '#E5E5E5' }}>
        <div>
          <div className="text-[16px] font-semibold" style={{ color: TEXT }}>{title}</div>
          <div className="mt-1 text-[11px]" style={{ color: SECONDARY }}>{dateLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => setInfoOpen((open) => !open)}
          className="flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none text-white"
          style={{ background: DEEP_BLUE }}
          aria-label="查看累积基准比较说明"
        >
          ?
        </button>
        {infoOpen && (
          <div
            className="absolute right-4 top-10 z-20 w-[320px] border bg-white p-3 text-[12px] leading-5"
            style={{ borderColor: BORDER, color: TEXT }}
          >
            累积基准比较展示从当前筛选起点开始，组合与 SPY 基准的累计时间加权收益率。今日点优先使用实时行情；历史日期使用日线收盘价。
          </div>
        )}
      </div>

      <div className="h-[380px] bg-white px-3 pb-2 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 12, right: 18, left: 6, bottom: 28 }}>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
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
                dataKey="spyCumulativePct"
                stroke={GREEN}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: GREEN }}
                isAnimationActive={false}
              />
            )}
            <Line
              type="linear"
              dataKey="portfolioCumulativePct"
              stroke={BLUE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: BLUE }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <PerformanceTable rows={pageRows} showBenchmark={showBenchmark} />
      <Pager page={safePage} pageCount={pageCount} onPageChange={onPageChange} />
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
    <div className="border bg-white px-3 py-2 text-[12px] shadow-none" style={{ borderColor: BORDER, color: TEXT }}>
      <div className="mb-1 tabular-nums" style={{ color: SECONDARY }}>日期 {label ?? row.date}</div>
      {showBenchmark && (
        <div className="flex min-w-[230px] justify-between gap-4 tabular-nums">
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5" style={{ background: GREEN }} />SPY</span>
          <span>累计 {formatPct(row.spyCumulativeReturn)}%</span>
        </div>
      )}
      {showBenchmark && (
        <div className="flex min-w-[230px] justify-between gap-4 tabular-nums" style={{ color: SECONDARY }}>
          <span>SPY 当日</span>
          <span>{formatPct(row.spyPeriodReturn)}%</span>
        </div>
      )}
      <div className="flex min-w-[230px] justify-between gap-4 tabular-nums">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5" style={{ background: BLUE }} />Consolidated</span>
        <span>累计 {formatPct(row.portfolioCumulativeReturn)}%</span>
      </div>
      <div className="flex min-w-[230px] justify-between gap-4 tabular-nums" style={{ color: SECONDARY }}>
        <span>Consolidated 当日</span>
        <span>{formatPct(row.portfolioPeriodReturn)}%</span>
      </div>
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
      <line x1={x} x2={x} y1={top} y2={top + height} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="3 3" />
      {typeof y === 'number' && (
        <line x1={left} x2={left + width} y1={y} y2={y} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="3 3" />
      )}
    </g>
  );
}

function PerformanceTable({
  rows,
  showBenchmark,
}: {
  rows: PerfRow[];
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
          return (
            <tr key={row.date} className="h-9 border-b" style={{ borderColor: '#E5E5E5' }}>
              <td className="px-4 text-left tabular-nums">{row.date}</td>
              <td className="px-4 text-right tabular-nums">{showBenchmark ? formatPct(row.spyCumulativeReturn) : '-'}</td>
              <td className="px-4 text-right tabular-nums" style={{ background: PANEL }}>{formatPct(row.portfolioCumulativeReturn)}</td>
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

function useDemoDcaData() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  async function clearDemoRows() {
    if (!user) throw new Error('请先登录');
    const tx = await supabase
      .from('transactions')
      .delete()
      .eq('user_id', user.id)
      .in('note', [DEMO_NOTE, LEGACY_DEMO_NOTE]);
    if (tx.error) throw tx.error;
    const cf = await supabase
      .from('cashflows')
      .delete()
      .eq('user_id', user.id)
      .in('note', [DEMO_NOTE, LEGACY_DEMO_NOTE]);
    if (cf.error) throw cf.error;
  }

  const clearMutation = useMutation({
    mutationFn: clearDemoRows,
    onSuccess: async () => {
      setMessage('测试数据已清除');
      await invalidatePortfolioQueries(qc);
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : '清除失败'),
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('请先登录');
      setMessage(null);
      await clearDemoRows();

      const history = await fetchHistory([DEMO_TICKER, 'SPY'], '10y');
      const prices = seriesToPriceMap(history, DEMO_TICKER);
      const tradeRows = buildMonthlyDemoTrades(prices);
      if (tradeRows.length === 0) throw new Error('没有拿到 QQQ 历史价格');

      const cashflows = tradeRows.map((row) => ({
        user_id: user.id,
        cny_out_date: row.date,
        cny_amount: Number((DEMO_MONTHLY_USD * DEMO_RATE).toFixed(2)),
        usd_in_date: row.date,
        usd_amount: DEMO_MONTHLY_USD,
        target_rate: DEMO_RATE,
        fees_cny: 0,
        fees_usd: 0,
        note: DEMO_NOTE,
      }));
      const transactions = tradeRows.map((row) => ({
        user_id: user.id,
        trade_date: row.date,
        ticker: DEMO_TICKER,
        side: 'buy' as const,
        price: row.close,
        shares: Number((DEMO_MONTHLY_USD / row.close).toFixed(6)),
        kind: 'dca' as const,
        note: DEMO_NOTE,
      }));

      const cf = await supabase.from('cashflows').insert(cashflows);
      if (cf.error) throw cf.error;
      const tx = await supabase.from('transactions').insert(transactions);
      if (tx.error) throw tx.error;
      return tradeRows.length;
    },
    onSuccess: async (count) => {
      setMessage(`已生成 ${count} 期`);
      await invalidatePortfolioQueries(qc);
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : '生成失败'),
  });

  return {
    seed: () => seedMutation.mutate(),
    clear: () => clearMutation.mutate(),
    seeding: seedMutation.isPending,
    clearing: clearMutation.isPending,
    busy: seedMutation.isPending || clearMutation.isPending,
    message,
  };
}

async function invalidatePortfolioQueries(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['transactions'] }),
    qc.invalidateQueries({ queryKey: ['cashflows'] }),
    qc.invalidateQueries({ queryKey: ['portfolio_history'] }),
    qc.invalidateQueries({ queryKey: ['daily_prices'] }),
  ]);
}

function seriesToPriceMap(series: HistorySeries[], ticker: string) {
  const row = series.find((s) => s.ticker.toUpperCase() === ticker);
  return new Map((row?.points ?? []).map((p) => [p.date, p.close]));
}

function buildMonthlyDemoTrades(prices: Map<string, number>) {
  const months = buildMonthlyStarts();
  const dates = [...prices.keys()].sort();
  return months.flatMap((monthStart) => {
    const month = monthStart.slice(0, 7);
    const tradeDate = dates.find((date) => date >= monthStart && date.startsWith(month));
    const close = tradeDate ? prices.get(tradeDate) : null;
    return tradeDate && close ? [{ date: tradeDate, close }] : [];
  });
}

function buildMonthlyStarts() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear() - 10, now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const out: string[] = [];
  for (let d = start; d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
