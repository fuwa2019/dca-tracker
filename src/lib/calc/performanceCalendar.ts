import type { HistoryPoint } from '@/lib/calc/history';

export type CalendarHistoryPoint = Pick<HistoryPoint, 'date' | 'invested' | 'navUser' | 'returnPctUser'>;

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthDateRange(month: string): { start: string; end: string; days: number } {
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(days).padStart(2, '0')}`,
    days,
  };
}

/** Monday-to-Friday columns. US equities do not trade on weekends. */
export const CALENDAR_COLUMNS = 5;

/**
 * A month's weekdays span at most five Monday-first weeks: a sixth week only
 * appears when the month starts on a Saturday or Sunday, and then the first
 * week holds no weekday at all.
 */
export const CALENDAR_CELLS = 25;

/**
 * Monday-to-Friday calendar cells, including leading/trailing blanks.
 *
 * Weekends are left out: the ledger rolls weekend events onto the next trading
 * day, so a Saturday or Sunday never carries its own daily result.
 *
 * Always `CALENDAR_CELLS` long, even for a month that fits in four rows. The
 * grid is then the same height for every month, so the calendar cannot change
 * size when the selected month moves — which it does on load, from the current
 * month to the last month with performance data. That jump was a real layout
 * shift of exactly one row.
 */
export function buildMonthCalendar(month: string): Array<string | null> {
  const { days } = monthDateRange(month);
  const [year, monthNumber] = month.split('-').map(Number);
  const cells: Array<string | null> = [];
  for (let day = 1; day <= days; day += 1) {
    const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (cells.length === 0) {
      for (let blank = 1; blank < weekday; blank += 1) cells.push(null);
    }
    cells.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length < CALENDAR_CELLS) cells.push(null);
  return cells;
}

export function dailyReturnFromCumulative(current: number, previous: number | null): number | null {
  if (previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const denominator = 1 + previous;
  if (denominator <= 0) return null;
  const result = (1 + current) / denominator - 1;
  return Number.isFinite(result) ? result : null;
}

/** Calculate private-mode daily PnL from the same NAV and cumulative flow fields. */
export function dailyPnlFromHistory(history: CalendarHistoryPoint[]): Map<string, number | null> {
  const result = new Map<string, number | null>();
  let previous: CalendarHistoryPoint | null = null;

  for (const point of history) {
    if (!previous || !Number.isFinite(point.navUser) || !Number.isFinite(point.invested)
      || !Number.isFinite(previous.navUser) || !Number.isFinite(previous.invested)) {
      result.set(point.date, null);
    } else {
      const dailyFlow = point.invested - previous.invested;
      result.set(point.date, point.navUser - dailyFlow - previous.navUser);
    }
    previous = point;
  }

  return result;
}
