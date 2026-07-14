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

/** Monday-first calendar cells, including leading/trailing blanks. */
export function buildMonthCalendar(month: string): Array<string | null> {
  const { days } = monthDateRange(month);
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const leadingBlanks = firstWeekday === 0 ? 6 : firstWeekday - 1;
  const cells: Array<string | null> = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
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
