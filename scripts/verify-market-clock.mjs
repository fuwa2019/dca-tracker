import assert from 'node:assert/strict';
import {
  formatEtWindowInZone,
  getNewYorkClock,
  newYorkWallTime,
  zoneOffsetMinutes,
} from '../src/lib/marketClock.ts';
import { usMarketSessionAt, lastCompletedNyseTradingDate } from '../workers/quote/src/nyseCalendar.ts';

// New York offsets on either side of the 2026 transitions (03-08 and 11-01).
assert.equal(zoneOffsetMinutes(new Date('2026-07-01T12:00:00Z'), 'America/New_York'), -240);
assert.equal(zoneOffsetMinutes(new Date('2026-12-01T12:00:00Z'), 'America/New_York'), -300);
assert.equal(zoneOffsetMinutes(new Date('2026-12-01T12:00:00Z'), 'Asia/Shanghai'), 480);

// ET wall time resolves to the right instant in both seasons and on change days.
assert.equal(newYorkWallTime('2026-07-01', 9 * 60 + 30).toISOString(), '2026-07-01T13:30:00.000Z');
assert.equal(newYorkWallTime('2026-12-01', 9 * 60 + 30).toISOString(), '2026-12-01T14:30:00.000Z');
assert.equal(newYorkWallTime('2026-11-01', 9 * 60 + 30).toISOString(), '2026-11-01T14:30:00.000Z', 'fall-back day opens on EST');
assert.equal(newYorkWallTime('2026-03-08', 9 * 60 + 30).toISOString(), '2026-03-08T13:30:00.000Z', 'spring-forward day opens on EDT');
assert.equal(newYorkWallTime('2026-10-30', 28 * 60).toISOString(), '2026-10-31T08:00:00.000Z', 'minutes past 24h reach the next day');

// DST label and the upcoming change.
const summer = getNewYorkClock(new Date('2026-07-01T16:00:00Z'));
assert.deepEqual(summer, { isDst: true, label: '夏令时', utcOffset: 'UTC-4', nextChange: null });
const winter = getNewYorkClock(new Date('2026-12-01T16:00:00Z'));
assert.deepEqual(winter, { isDst: false, label: '冬令时', utcOffset: 'UTC-5', nextChange: null });
assert.deepEqual(getNewYorkClock(new Date('2026-10-28T16:00:00Z')).nextChange, { date: '2026-11-01', label: '冬令时' });
assert.deepEqual(getNewYorkClock(new Date('2027-03-16T16:00:00Z')).nextChange, null, 'change already past');
assert.deepEqual(getNewYorkClock(new Date('2027-03-08T16:00:00Z')).nextChange, { date: '2027-03-14', label: '夏令时' });
assert.equal(getNewYorkClock(new Date('2026-11-01T05:30:00Z')).label, '夏令时', '01:30 EDT before fall-back');
assert.equal(getNewYorkClock(new Date('2026-11-01T06:30:00Z')).label, '冬令时', '01:30 EST after fall-back');

// Regular session in Beijing shifts by an hour; New York viewers get no local copy.
const regular = (startDate) => ({ startDate, start: 9 * 60 + 30, end: 16 * 60 });
assert.equal(formatEtWindowInZone(regular('2026-07-01'), 'Asia/Shanghai'), '21:30-次日04:00');
assert.equal(formatEtWindowInZone(regular('2026-12-01'), 'Asia/Shanghai'), '22:30-次日05:00');
assert.equal(formatEtWindowInZone(regular('2026-07-01'), 'America/New_York'), null);
assert.equal(formatEtWindowInZone(regular('2026-07-01'), 'America/Toronto'), null);
assert.equal(formatEtWindowInZone({ startDate: '2026-12-01', start: 4 * 60, end: 9 * 60 + 30 }, 'Asia/Shanghai'), '17:00-22:30');
assert.equal(formatEtWindowInZone({ startDate: '2026-12-01', start: 20 * 60, end: 4 * 60 }, 'Asia/Shanghai'), '09:00-17:00', 'overnight crosses ET midnight');
assert.equal(formatEtWindowInZone({ startDate: '2026-10-31', start: 20 * 60, end: 4 * 60 }, 'Asia/Shanghai'), '08:00-17:00', 'overnight spanning fall-back is 9h');
// Europe changes a week before New York: London is ET+4h for that week.
assert.equal(formatEtWindowInZone(regular('2026-10-28'), 'Europe/London'), '13:30-20:00');
assert.equal(formatEtWindowInZone(regular('2026-11-04'), 'Europe/London'), '14:30-21:00');

// Worker session boundaries follow the New York wall clock in both seasons.
assert.equal(usMarketSessionAt(new Date('2026-07-01T13:29:00Z')), 'pre_market');
assert.equal(usMarketSessionAt(new Date('2026-07-01T13:30:00Z')), 'regular');
assert.equal(usMarketSessionAt(new Date('2026-12-01T13:30:00Z')), 'pre_market', '13:30Z is 08:30 EST');
assert.equal(usMarketSessionAt(new Date('2026-12-01T14:30:00Z')), 'regular');
assert.equal(usMarketSessionAt(new Date('2026-12-01T20:59:00Z')), 'regular', '20:59Z is 15:59 EST');
assert.equal(usMarketSessionAt(new Date('2026-12-01T21:00:00Z')), 'after_hours');
assert.equal(usMarketSessionAt(new Date('2026-11-02T14:30:00Z')), 'regular', 'Monday after fall-back');

// Cron triggers: 22:15Z lands after the close in both seasons, and the
// 04:10/05:10Z pair always sees the previous session as completed.
assert.equal(lastCompletedNyseTradingDate(new Date('2026-07-01T22:15:00Z')), '2026-07-01');
assert.equal(lastCompletedNyseTradingDate(new Date('2026-12-01T22:15:00Z')), '2026-12-01');
assert.equal(lastCompletedNyseTradingDate(new Date('2026-07-02T04:10:00Z')), '2026-07-01');
assert.equal(lastCompletedNyseTradingDate(new Date('2026-12-02T05:10:00Z')), '2026-12-01');

console.log('market clock DST checks passed');
