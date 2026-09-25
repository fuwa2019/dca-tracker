import assert from 'node:assert/strict';
import {
  buildMonthCalendar,
  dailyPnlFromHistory,
  dailyReturnFromCumulative,
  monthDateRange,
  shiftMonth,
} from '../src/lib/calc/performanceCalendar.ts';

assert.equal(monthDateRange('2024-02').end, '2024-02-29', 'leap February has 29 days');
assert.equal(monthDateRange('2025-02').days, 28, 'non-leap February has 28 days');
assert.equal(monthDateRange('2025-04').days, 30, 'April has 30 days');
assert.equal(monthDateRange('2025-01').days, 31, 'January has 31 days');
assert.equal(shiftMonth('2025-01', -1), '2024-12', 'month navigation crosses years backward');
assert.equal(shiftMonth('2024-12', 1), '2025-01', 'month navigation crosses years forward');
assert.equal(buildMonthCalendar('2024-02').length, 25, 'a four-row month still fills five rows');
assert.equal(buildMonthCalendar('2026-08').length, 25, 'a month spanning six calendar weeks still fits five weekday rows');
assert.equal(buildMonthCalendar('2025-09').at(0), '2025-09-01', 'month starting on Monday has no leading blank');
assert.equal(buildMonthCalendar('2026-08').at(0), '2026-08-03', 'month starting on Saturday begins with its first Monday');
assert.equal(buildMonthCalendar('2026-05').slice(0, 5).join(), ',,,,2026-05-01', 'month starting on Friday has four leading blanks');
for (const month of ['2024-02', '2025-03', '2026-05', '2026-08', '2026-09']) {
  const cells = buildMonthCalendar(month);
  assert.ok(
    cells.every((date) => date == null || ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())),
    `${month} has no weekend cells`,
  );
  cells.forEach((date, index) => {
    if (date) assert.equal(new Date(`${date}T00:00:00Z`).getUTCDay(), (index % 5) + 1, `${date} sits in its weekday column`);
  });
}
assert.equal(buildMonthCalendar('2025-03').filter(Boolean).length, 21, 'every weekday of the month is present');
assert.deepEqual(
  buildMonthCalendar('2025-03').slice(21),
  Array.from({ length: 4 }, () => null),
  'trailing padding is blank, so the extra row renders as empty cells',
);

const history = [
  { date: '2025-01-02', invested: 100, navUser: 100, returnPctUser: 0 },
  { date: '2025-01-03', invested: 100, navUser: 110, returnPctUser: 0.1 },
  { date: '2025-01-06', invested: 200, navUser: 210, returnPctUser: 0.1 },
  { date: '2025-01-07', invested: 200, navUser: 215, returnPctUser: 0.15 },
];
const pnl = dailyPnlFromHistory(history);
assert.equal(pnl.get('2025-01-02'), null, 'first trading day shows no amount baseline');
assert.equal(pnl.get('2025-01-03'), 10, 'price move becomes daily PnL');
assert.equal(pnl.get('2025-01-06'), 0, 'new funding without price movement is zero PnL');
assert.equal(pnl.get('2025-01-07'), 5, 'price move after funding excludes the flow');
assert.ok(Math.abs((dailyReturnFromCumulative(0.15, 0.1) ?? 0) - 0.04545454545454545) < 1e-12, 'percentage mode uses adjacent cumulative TWR points');

console.log('performance calendar checks passed');
