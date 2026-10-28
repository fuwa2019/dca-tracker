/**
 * New York daylight-saving state and ET session windows shown in the viewer's
 * own time zone. Session boundaries themselves are New York wall-clock times
 * (see getUsMarketSession); only their local rendering shifts with DST.
 */
const NEW_YORK = 'America/New_York';
const DAY_MS = 86_400_000;

/** Minutes east of UTC for `timeZone` at `at` (New York: -240 EDT, -300 EST). */
export function zoneOffsetMinutes(at: Date, timeZone?: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((wallAsUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Instant of a New York wall-clock time; `minutes` may exceed 24h to reach the next day. */
export function newYorkWallTime(etDate: string, minutes: number): Date {
  const wallAsUtc = Date.parse(`${etDate}T00:00:00Z`) + minutes * 60_000;
  let offset = zoneOffsetMinutes(new Date(wallAsUtc + 300 * 60_000), NEW_YORK);
  const corrected = zoneOffsetMinutes(new Date(wallAsUtc - offset * 60_000), NEW_YORK);
  if (corrected !== offset) offset = corrected;
  return new Date(wallAsUtc - offset * 60_000);
}

export interface NewYorkClock {
  isDst: boolean;
  /** 夏令时 (EDT, UTC-4) or 冬令时 (EST, UTC-5). */
  label: '夏令时' | '冬令时';
  utcOffset: string;
  /** Next New York clock change within `lookaheadDays`, as an ET date. */
  nextChange: { date: string; label: '夏令时' | '冬令时' } | null;
}

const clockLabel = (offset: number) => (offset === -240 ? '夏令时' : '冬令时');

export function getNewYorkClock(now = new Date(), lookaheadDays = 7): NewYorkClock {
  const offset = zoneOffsetMinutes(now, NEW_YORK);
  const etDate = new Date(now.getTime() + offset * 60_000).toISOString().slice(0, 10);
  let nextChange: NewYorkClock['nextChange'] = null;
  for (let day = 1; day <= lookaheadDays; day++) {
    const date = addDays(etDate, day);
    // Clocks change at 02:00 ET, so noon already carries the new offset.
    const noonOffset = zoneOffsetMinutes(newYorkWallTime(date, 12 * 60), NEW_YORK);
    if (noonOffset !== offset) {
      nextChange = { date, label: clockLabel(noonOffset) };
      break;
    }
  }
  return {
    isDst: offset === -240,
    label: clockLabel(offset),
    utcOffset: `UTC${offset / 60}`,
    nextChange,
  };
}

/** A session window as New York wall-clock minutes; `end` <= `start` crosses midnight. */
export interface EtWindow {
  startDate: string;
  start: number;
  end: number;
}

function wallParts(at: Date, timeZone?: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Render an ET window in `timeZone` (default: the viewer's zone), e.g.
 * 09:30-16:00 ET → "21:30-次日04:00" in Beijing during 夏令时. Returns null when
 * the zone currently shares New York's offset, so the ET text already says it.
 */
export function formatEtWindowInZone(window: EtWindow, timeZone?: string): string | null {
  const startAt = newYorkWallTime(window.startDate, window.start);
  const end = window.end > window.start ? window.end : window.end + 24 * 60;
  const endAt = newYorkWallTime(window.startDate, end);
  if (zoneOffsetMinutes(startAt, timeZone) === zoneOffsetMinutes(startAt, NEW_YORK)) return null;
  const from = wallParts(startAt, timeZone);
  const to = wallParts(endAt, timeZone);
  return `${from.time}-${to.date === from.date ? '' : '次日'}${to.time}`;
}

/** Short name for the viewer's zone in session copy. */
export function localZoneLabel(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  return timeZone === 'Asia/Shanghai' || timeZone === 'Asia/Chongqing' ? '北京' : '本地';
}
