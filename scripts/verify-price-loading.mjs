import assert from 'node:assert/strict';
import { fetchAllRows, fetchHistoryPages, symbolsNeedingBackfill } from '../src/lib/priceBackfill.ts';

const today = '2026-09-29';
const prices = new Map([
  ['HELD', new Map([['2026-01-02', 10], ['2026-09-28', 11]])],
  ['SOLD', new Map([['2026-01-02', 10], ['2026-02-02', 12]])],
]);
const bounds = new Map([
  ['HELD', { startDate: '2026-01-02', endDate: today }],
  ['SOLD', { startDate: '2026-01-02', endDate: '2026-02-02' }],
]);
assert.deepEqual(symbolsNeedingBackfill(prices, ['HELD', 'SOLD'], '2026-01-02', today, bounds), []);
assert.deepEqual(symbolsNeedingBackfill(prices, ['HELD', 'SOLD', 'MISSING'], '2026-01-02', today, bounds), ['MISSING']);
assert.deepEqual(symbolsNeedingBackfill(new Map([['HELD', new Map([['2026-01-02', 10]])]]), ['HELD'], '2026-01-02', today, bounds), ['HELD']);

const symbols = Array.from({ length: 12 }, (_, i) => `T${i}`);
const batches = [];
const pages = await fetchHistoryPages(symbols, '1y', async (params) => {
  const batch = params.get('symbols').split(',');
  batches.push(batch);
  return {
    series: batch.map((ticker) => ({ ticker })),
  };
});
assert.deepEqual(batches, [symbols.slice(0, 10), symbols.slice(10)]);
assert.deepEqual(pages.flatMap((page) => page.series.map((row) => row.ticker)), symbols);

let resolveSlow;
const slow = fetchHistoryPages(['HELD'], '1y', () => new Promise((resolve) => { resolveSlow = resolve; }));
assert.equal(typeof resolveSlow, 'function', 'slow request remains pending without blocking other work');
resolveSlow({ series: [{ ticker: 'HELD' }], hasMore: false });
assert.equal((await slow)[0].series[0].ticker, 'HELD');

await assert.rejects(fetchHistoryPages(['HELD'], '1y', async () => { throw new Error('provider failed'); }), /provider failed/);
await assert.rejects(fetchHistoryPages(['HELD'], '1y', async () => new Promise((_, reject) => {
  setTimeout(() => reject(new Error('timeout')), 10);
})), /timeout/);
const partial = new Map([['HELD', prices.get('HELD')]]);
assert.deepEqual(symbolsNeedingBackfill(partial, ['HELD', 'MISSING'], '2026-01-02', today, bounds), ['MISSING']);
// Short window whose stored series ends before the window starts (truncated read).
const stale = new Map([['QLD', new Map([['2026-05-13', 90], ['2026-09-22', 97.82]])]]);
const shortBounds = new Map([['QLD', { startDate: '2026-10-26', endDate: '2026-10-28' }]]);
assert.deepEqual(symbolsNeedingBackfill(stale, ['QLD'], '2026-05-13', '2026-10-28', shortBounds), ['QLD']);
// Short window with fresh coverage, or a start on a weekend, is not flagged.
const fresh = new Map([['QLD', new Map([['2026-10-23', 90], ['2026-10-27', 88.03]])]]);
assert.deepEqual(symbolsNeedingBackfill(fresh, ['QLD'], '2026-05-13', '2026-10-28', shortBounds), []);
const weekend = new Map([['QLD', new Map([['2026-10-23', 90]])]]);
assert.deepEqual(symbolsNeedingBackfill(weekend, ['QLD'], '2026-10-24', '2026-10-25', new Map([['QLD', { startDate: '2026-10-24', endDate: '2026-10-25' }]])), []);

// Paging: full pages continue, a short page (or an exact-multiple empty page) ends.
const all = Array.from({ length: 2500 }, (_, i) => i);
const ranges = [];
const read = (rows) => fetchAllRows(async (from, to) => { ranges.push([from, to]); return rows.slice(from, to + 1); });
assert.deepEqual(await read(all), all);
assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
ranges.length = 0;
assert.equal((await read(all.slice(0, 2000))).length, 2000);
assert.equal(ranges.length, 3);
await assert.rejects(fetchAllRows(async () => { throw new Error('page failed'); }), /page failed/);

console.log('price loading checks passed');
