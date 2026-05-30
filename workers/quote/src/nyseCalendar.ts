/**
 * NYSE full-closure dates (ISO YYYY-MM-DD) for 2026 / 2027 / 2028.
 * Keep in sync with workers/email-cron/src/nyse-calendar.ts.
 */
export const NYSE_HOLIDAYS: Record<string, string[]> = {
  '2026': [
    '2026-01-01',
    '2026-01-19',
    '2026-02-16',
    '2026-04-03',
    '2026-05-25',
    '2026-06-19',
    '2026-07-03',
    '2026-09-07',
    '2026-11-26',
    '2026-12-25',
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
  ],
};

const NEW_YORK_CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function isoDateInNewYork(d: Date): string {
  const parts = newYorkParts(d);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isNyseTradingDay(iso: string): boolean {
  if (NYSE_HOLIDAYS[iso.slice(0, 4)]?.includes(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function previousNyseTradingDay(iso: string): string {
  for (let daysBack = 1; daysBack <= 14; daysBack++) {
    const candidate = addDays(iso, -daysBack);
    if (isNyseTradingDay(candidate)) return candidate;
  }
  throw new Error(`could not find previous NYSE trading day within 14 days of ${iso}`);
}

/**
 * Return the most recent completed regular NYSE session using the New York
 * calendar. A quote may promote this date to a provisional daily close.
 */
export function lastCompletedNyseTradingDate(now = new Date()): string {
  const parts = newYorkParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (isNyseTradingDay(today) && minutes >= 16 * 60) return today;
  return previousNyseTradingDay(today);
}

export function isQuoteEligibleForProvisionalClose(asOf: string | undefined, tradingDate: string): boolean {
  if (!asOf || !isNyseTradingDay(tradingDate)) return false;
  const timestamp = new Date(asOf);
  if (!Number.isFinite(timestamp.getTime())) return false;
  const parts = newYorkParts(timestamp);
  const quoteDate = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return quoteDate === tradingDate && minutes >= 16 * 60;
}

function newYorkParts(d: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const parts = Object.fromEntries(
    NEW_YORK_CLOCK
      .formatToParts(d)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}
