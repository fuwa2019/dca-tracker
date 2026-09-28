import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from '@/components/icons';
import { Card } from '@/components/ui/card';
import { usePerformanceDailyPnl } from '@/hooks/usePerformanceDailyPnl';
import { LOCAL_MODE } from '@/lib/localMode';
import { LOCAL_BENCHMARK, localPriceMap } from '@/lib/localData';
import { normalizeSymbol } from '@/lib/symbols';
import type { HistoryPoint } from '@/lib/calc/history';
import {
  buildMonthCalendar,
  currentMonthKey,
  dailyPnlFromHistory,
  dailyReturnFromCumulative,
  monthDateRange,
  monthKey,
  shiftMonth,
} from '@/lib/calc/performanceCalendar';
import { changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五'];

export function MonthlyPerformanceCalendar({
  history,
  benchmark = 'SPY',
  amountsFromHistory = false,
}: {
  history: HistoryPoint[];
  benchmark?: string;
  /** The history carries real NAV and flows (ledger series): derive daily P&L locally. */
  amountsFromHistory?: boolean;
}) {
  const localAmounts = LOCAL_MODE || amountsFromHistory;
  const normalizedBenchmark = normalizeSymbol(benchmark) || 'SPY';
  const calendarHistory = useMemo(() => {
    if (!LOCAL_MODE) return history;
    const benchmarkDates = localPriceMap.get(normalizedBenchmark)?.keys()
      ?? localPriceMap.get(LOCAL_BENCHMARK)?.keys();
    if (!benchmarkDates) return history;
    const dates = new Set(benchmarkDates);
    return history.filter((point) => dates.has(point.date));
  }, [history, normalizedBenchmark]);

  const firstMonth = calendarHistory[0] ? monthKey(calendarHistory[0].date) : null;
  const latestMonth = calendarHistory.at(-1) ? monthKey(calendarHistory.at(-1)!.date) : null;
  const [month, setMonth] = useState(latestMonth ?? currentMonthKey());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (latestMonth) setMonth(latestMonth);
  }, [latestMonth]);

  const monthBounds = monthDateRange(month);
  const cells = useMemo(() => buildMonthCalendar(month), [month]);
  const monthPoints = useMemo(
    () => calendarHistory.filter((point) => monthKey(point.date) === month),
    [calendarHistory, month],
  );
  const pointByDate = useMemo(() => new Map(calendarHistory.map((point) => [point.date, point])), [calendarHistory]);
  const percentByDate = useMemo(() => {
    const values = new Map<string, number | null>();
    calendarHistory.forEach((point, index) => {
      const previous = index > 0 ? calendarHistory[index - 1].returnPctUser : null;
      values.set(point.date, dailyReturnFromCumulative(point.returnPctUser, previous));
    });
    return values;
  }, [calendarHistory]);
  const localPnlByDate = useMemo(
    () => dailyPnlFromHistory(calendarHistory),
    [calendarHistory],
  );
  const dailyPnlQuery = usePerformanceDailyPnl({
    benchmark: normalizedBenchmark,
    startDate: monthBounds.start,
    endDate: monthBounds.end,
    enabled: !localAmounts,
  });
  const remotePnlByDate = useMemo(
    () => new Map((dailyPnlQuery.data?.series ?? []).map((row) => [row.date, row.daily_pnl_user])),
    [dailyPnlQuery.data],
  );

  const canNavigate = !!firstMonth && !!latestMonth;
  const previousDisabled = !canNavigate || month <= firstMonth!;
  const nextDisabled = !canNavigate || month >= latestMonth!;
  const amountReady = localAmounts || !!dailyPnlQuery.data || dailyPnlQuery.isError;
  const amountError = !localAmounts && dailyPnlQuery.isError;
  const noPerformance = calendarHistory.length === 0;

  const pnlByDate = localAmounts ? localPnlByDate : remotePnlByDate;
  const selected = selectedDate?.startsWith(month) && pointByDate.has(selectedDate)
    ? selectedDate : monthPoints.at(-1)?.date;
  const monthAmounts = monthPoints.map((point) => pnlByDate.get(point.date));
  const monthReturns = monthPoints.map((point) => percentByDate.get(point.date));
  // Partial / missing data must not look like a complete monthly total.
  const monthPnl = monthAmounts.length && monthAmounts.every((value) => value != null && Number.isFinite(value))
    ? monthAmounts.reduce<number>((total, value) => total + value!, 0) : null;
  const monthReturn = monthReturns.length && monthReturns.every((value) => value != null && Number.isFinite(value))
    ? monthReturns.reduce<number>((total, value) => total * (1 + value!), 1) - 1 : null;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-4 sm:px-4">
        <h2 className="text-sm font-semibold tracking-tight">盈亏日历</h2>
        <div className="flex items-center gap-1 sm:gap-2">
          <MonthButton label="上一个业绩月份" disabled={previousDisabled} onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </MonthButton>
          <div className="min-w-[92px] text-center text-xs font-semibold tnum sm:text-sm" aria-live="polite">{formatMonth(month)}</div>
          <MonthButton label="下一个业绩月份" disabled={nextDisabled} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="h-3.5 w-3.5" />
          </MonthButton>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-2 px-3 pb-4 sm:px-4" aria-live="polite">
        <span className="text-xs text-muted-foreground">本月盈亏</span>
        <strong className={cn('font-num text-2xl tnum', monthPnl == null ? 'text-muted-foreground' : changeColor(monthPnl))}>{formatAmount(monthPnl, false)}</strong>
        <span className={cn('text-xs tnum', monthReturn == null ? 'text-muted-foreground' : changeColor(monthReturn))}>{formatPercent(monthReturn)}</span>
      </div>
      {amountError && <p className="border-y border-loss/30 bg-loss/5 px-4 py-2 text-xs text-loss">金额数据暂不可用，收益率仍可查看。</p>}
      <div className="px-2 pb-3 sm:px-4 sm:pb-4">
        <div className="grid grid-cols-5 gap-1 sm:gap-1.5">
          {WEEKDAYS.map((weekday) => <div key={weekday} className="px-1 pb-1 text-[10px] text-muted-foreground sm:px-2 sm:text-[11px]">{weekday}</div>)}
          {cells.map((date, index) => (
            <CalendarCell key={date ?? `blank-${index}`} date={date}
              point={date ? pointByDate.get(date) : undefined}
              amount={date ? pnlByDate.get(date) : undefined}
              percent={date ? percentByDate.get(date) : undefined}
              loading={!amountReady} selected={selected === date}
              onSelect={() => setSelectedDate(date)} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-1 text-[10px] text-muted-foreground sm:text-[11px]">
          <span>金额 USD · 收益率 TWR</span><span>淡绿盈利 / 淡红亏损 · 点选日期查看详情</span>
          {!localAmounts && dailyPnlQuery.isFetching && <span className="inline-flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" />读取金额缓存</span>}
        </div>
        <div className="mt-3 min-h-9 border-t border-border pt-3 text-xs" aria-live="polite">
          {selected ? <div className="flex flex-wrap gap-x-3 gap-y-1 tnum">
            <span className="text-muted-foreground">{selected}</span>
            <strong className={changeColor(pnlByDate.get(selected) ?? 0)}>{formatAmount(pnlByDate.get(selected), false)}</strong>
            <span className={changeColor(percentByDate.get(selected) ?? 0)}>{formatPercent(percentByDate.get(selected))}</span>
            <span className="text-muted-foreground">当日投资盈亏</span>
          </div> : <span className="text-muted-foreground">{noPerformance ? '暂无业绩数据' : '本月暂无业绩数据'}</span>}
        </div>
      </div>
    </Card>
  );
}

function MonthButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function CalendarCell({ date, point, amount, percent, loading, selected, onSelect }: {
  date: string | null;
  point?: HistoryPoint;
  amount?: number | null;
  percent?: number | null;
  loading: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const base = 'min-h-[82px] min-w-0 rounded-md px-1 py-2 text-left sm:min-h-[88px] sm:px-2';
  if (!date) return <div className={base} aria-hidden="true" />;
  if (!point) return <div className={cn(base, 'bg-surface-elevated/40 text-[10px] text-muted-foreground')}><span>{Number(date.slice(-2))}</span></div>;
  const value = amount != null && Number.isFinite(amount) ? amount : percent;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      aria-label={`${date}，盈亏 ${loading ? '读取中' : formatAmount(amount, false)}，收益率 ${formatPercent(percent)}`}
      className={cn(base, 'border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        value != null && value > 0 ? 'bg-gain/10' : value != null && value < 0 ? 'bg-loss/10' : 'bg-surface-elevated/40',
        selected && 'border-brand ring-1 ring-brand')}>
      <span className="mb-2 block text-[10px] text-muted-foreground tnum sm:text-[11px]">{Number(date.slice(-2))}</span>
      <span className={cn('block font-num text-[11px] font-semibold leading-tight tnum sm:text-sm', changeColor(amount ?? 0))}>
        {loading ? '…' : <><span className="hidden sm:inline">{formatAmount(amount, false)}</span><span className="sm:hidden">{formatCompactAmount(amount)}</span></>}
      </span>
      <span className={cn('mt-1 block font-num text-[10px] leading-tight tnum sm:text-xs', changeColor(percent ?? 0))}>{formatPercent(percent)}</span>
    </button>
  );
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function formatAmount(value: number | null | undefined, compact: boolean): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (compact) return `$${sign}${compactNumber(absolute)}`;
  return `${sign}$${absolute.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCompactAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}$${compactNumber(Math.abs(value))}`;
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(1).replace(/\.0$/, '');
}
