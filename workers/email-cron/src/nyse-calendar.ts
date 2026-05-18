/**
 * NYSE full-closure dates (ISO YYYY-MM-DD) for 2026 / 2027 / 2028.
 * Source: NYSE Group official press release Dec 2025.
 *
 * Update yearly. Each year-end, append next year's holidays from
 * https://www.nyse.com/markets/hours-calendars
 */
export const NYSE_HOLIDAYS: Record<string, string[]> = {
  '2026': [
    '2026-01-01', // New Year's Day
    '2026-01-19', // MLK Day
    '2026-02-16', // Washington's Birthday
    '2026-04-03', // Good Friday
    '2026-05-25', // Memorial Day
    '2026-06-19', // Juneteenth
    '2026-07-03', // Independence Day observed
    '2026-09-07', // Labor Day
    '2026-11-26', // Thanksgiving
    '2026-12-25', // Christmas
  ],
  '2027': [
    '2027-01-01',
    '2027-01-18',
    '2027-02-15',
    '2027-03-26',
    '2027-05-31',
    '2027-06-18',
    '2027-07-05',
    '2027-09-06',
    '2027-11-25',
    '2027-12-24',
  ],
  '2028': [
    '2028-01-17',
    '2028-02-21',
    '2028-04-14',
    '2028-05-29',
    '2028-06-19',
    '2028-07-04',
    '2028-09-04',
    '2028-11-23',
    '2028-12-25',
    // Note: New Year's Day 2028 falls on Saturday — no observed market closure
  ],
};

/** Returns ISO date string in America/New_York for a given Date. */
export function isoDateInNewYork(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d); // en-CA gives YYYY-MM-DD
}

/** True if ISO date is a NYSE trading day (Mon-Fri, not a listed holiday). */
export function isNyseTradingDay(iso: string): boolean {
  const year = iso.slice(0, 4);
  const holidays = NYSE_HOLIDAYS[year] ?? [];
  if (holidays.includes(iso)) return false;
  // Day-of-week from ISO date (parse as UTC, compute weekday)
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return wd !== 0 && wd !== 6;
}

/** Returns ISO date of the next NYSE trading day strictly after `iso`. */
export function nextNyseTradingDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  for (let i = 1; i <= 14; i++) {
    const next = new Date(ms + i * 86_400_000);
    const nextIso = next.toISOString().slice(0, 10);
    if (isNyseTradingDay(nextIso)) return nextIso;
  }
  throw new Error(`could not find next trading day within 14 days of ${iso}`);
}

/** Returns ISO date of the first NYSE trading day of (year, month). */
export function firstNyseTradingDayOfMonth(year: number, month: number): string {
  for (let d = 1; d <= 7; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (isNyseTradingDay(iso)) return iso;
  }
  throw new Error(`no trading day in first week of ${year}-${month}`);
}
