import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
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

type CalendarMode = 'amount' | 'percent';

const MODE_OPTIONS: ReadonlyArray<{ value: CalendarMode; label: string }> = [
  { value: 'amount', label: '金额' },
  { value: 'percent', label: '百分比' },
];

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function MonthlyPerformanceCalendar({ history, benchmark = 'SPY' }: { history: HistoryPoint[]; benchmark?: string }) {
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
  const [mode, setMode] = useState<CalendarMode>('amount');

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
    enabled: mode === 'amount',
  });
  const remotePnlByDate = useMemo(
    () => new Map((dailyPnlQuery.data?.series ?? []).map((row) => [row.date, row.daily_pnl_user])),
    [dailyPnlQuery.data],
  );

  const canNavigate = !!firstMonth && !!latestMonth;
  const previousDisabled = !canNavigate || month <= firstMonth!;
  const nextDisabled = !canNavigate || month >= latestMonth!;
  const amountReady = LOCAL_MODE || !!dailyPnlQuery.data || dailyPnlQuery.isError;
  const amountError = mode === 'amount' && dailyPnlQuery.isError;
  const noPerformance = calendarHistory.length === 0;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-border bg-surface-elevated/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold tracking-tight">月度盈亏日历</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            只显示 {normalizedBenchmark} 实际价格日；周末、休市日和未来日期留空。
          </p>
        </div>
        <div className="grid w-full grid-cols-[2rem_minmax(5.75rem,1fr)_2rem_auto] items-center gap-2 sm:flex sm:w-auto">
          <MonthButton
            label="上一个业绩月份"
            disabled={previousDisabled}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </MonthButton>
          <div className="min-w-0 text-center text-sm font-semibold tnum sm:min-w-[104px]" aria-live="polite">
            {formatMonth(month)}
          </div>
          <MonthButton
            label="下一个业绩月份"
            disabled={nextDisabled}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </MonthButton>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={MODE_OPTIONS}
            size="sm"
            name="performance-calendar-mode"
            ariaLabel="选择日历显示模式"
            className="ml-0 sm:ml-1"
          />
        </div>
      </div>

      {amountError && (
        <div className="flex items-start gap-2 border-b border-loss/30 bg-loss/5 px-4 py-3 text-xs">
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-loss" />
          <div>
            <div className="font-medium text-loss">金额数据暂不可用</div>
            <p className="mt-0.5 text-muted-foreground">可以切换到“百分比”继续查看；金额缓存不会影响业绩曲线。</p>
          </div>
        </div>
      )}

      <div className="px-2 py-3 min-[380px]:px-3 sm:px-4 sm:py-4">
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="bg-surface-elevated px-1 py-2 text-center text-[10px] font-medium text-muted-foreground sm:text-[11px]">
              {weekday}
            </div>
          ))}
          {cells.map((date, index) => {
            const point = date ? pointByDate.get(date) : undefined;
            const percentValue = date ? percentByDate.get(date) : undefined;
            const amountValue = date
              ? (LOCAL_MODE ? localPnlByDate.get(date) : remotePnlByDate.get(date))
              : undefined;
            return (
              <CalendarCell
                key={date ?? `blank-${index}`}
                date={date}
                point={point}
                value={mode === 'amount' ? amountValue : percentValue}
                displayMode={mode}
                loading={mode === 'amount' && !amountReady && !!point}
              />
            );
          })}
        </div>

        {noPerformance ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">暂无业绩数据，录入交易并生成业绩缓存后会显示在这里。</p>
        ) : monthPoints.length === 0 ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">本月暂无业绩数据</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{mode === 'amount' ? '金额币种：USD' : '百分比按相邻累计 TWR 点计算'}</span>
            {mode === 'amount' && !LOCAL_MODE && dailyPnlQuery.isFetching && (
              <span className="inline-flex items-center gap-1 text-brand"><RefreshCw className="h-3 w-3 animate-spin" />读取金额缓存</span>
            )}
          </div>
        )}
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

function CalendarCell({
  date,
  point,
  value,
  displayMode,
  loading,
}: {
  date: string | null;
  point?: HistoryPoint;
  value?: number | null;
  displayMode: CalendarMode;
  loading: boolean;
}) {
  if (!date) return <div className="min-h-[58px] bg-surface/35 sm:min-h-[76px]" aria-hidden="true" />;

  const hasValue = value !== undefined;
  const tone = hasValue && value != null ? changeColor(value) : 'text-muted-foreground';
  const fullLabel = displayMode === 'amount'
    ? formatAmount(value, false)
    : formatPercent(value);
  const title = point ? `${date} · ${fullLabel}` : date;

  return (
    <div className="min-h-[58px] overflow-hidden bg-surface px-1 py-1.5 min-[380px]:px-1.5 sm:min-h-[76px] sm:px-2 sm:py-2" title={title}>
      <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground sm:text-[11px]">
        <span className="tnum">{Number(date.slice(-2))}</span>
        {point && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60" aria-label="交易日" />}
      </div>
      {point && (
        <div className={cn('mt-2 truncate font-mono text-[9px] font-semibold leading-tight tracking-tight tnum min-[380px]:text-[10px] sm:text-xs sm:tracking-normal', tone)}>
          {loading ? '…' : displayMode === 'amount' ? (
            <>
              <span className="hidden sm:inline">{formatAmount(value, false)}</span>
              <span className="sm:hidden">{formatCompactAmount(value)}</span>
            </>
          ) : (
            <>
              <span className="hidden sm:inline">{formatPercent(value)}</span>
              <span className="sm:hidden">{formatCompactPercent(value)}</span>
            </>
          )}
        </div>
      )}
    </div>
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

function formatCompactPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const percent = value * 100;
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '';
  return `${sign}${Math.abs(percent).toFixed(1)}%`;
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(1).replace(/\.0$/, '');
}
