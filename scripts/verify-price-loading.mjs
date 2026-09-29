import assert from 'node:assert/strict';
import { fetchHistoryPages, symbolsNeedingBackfill } from '../src/lib/priceBackfill.ts';

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
console.log('price loading checks passed');
