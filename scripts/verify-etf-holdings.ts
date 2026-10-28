import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  fetchEtfHoldingSnapshot,
  fetchEtfHoldingSnapshotWithFallback,
  normalizeConstituentTicker,
  parseEtfHoldingSource,
  staticEtfHoldingSnapshot,
} from '../workers/quote/src/etfHoldings.ts';
import { computeLookThrough, resolveLeveragedEtf, type EtfHoldingsData } from '../src/lib/calc/lookThrough.ts';

const csv = `Portfolio composition as of 08/04/2026
Ticker,Security Name,% of Net Assets
NVDA,NVIDIA,30%
AAPL,Apple,25%
MSFT,Microsoft,20%
BRK/B,Berkshire,15%
GOOGL,Alphabet,10%
`;
const csvResult = parseEtfHoldingSource('VOO', 'vanguard', 'https://example.test/voo', csv);
assert.equal(csvResult.asOf, '2026-08-04');
assert.equal(csvResult.holdings.length, 5);
assert.equal(csvResult.holdings.find((row) => row.ticker === 'BRK.B')?.weight, 0.15);

const html = `
<h2>Daily Holdings (%) as of 08/04/2026</h2><table>
<tr><th>Ticker</th><th>Holding</th><th>% of Net Assets</th></tr>
<tr><td>NVDA</td><td>Nvidia</td><td>30.00%</td></tr>
<tr><td>TSM</td><td>Taiwan Semi</td><td>25.00%</td></tr>
<tr><td>AVGO</td><td>Broadcom</td><td>20.00%</td></tr>
<tr><td>AMD</td><td>AMD</td><td>15.00%</td></tr>
<tr><td>MU</td><td>Micron</td><td>9.95%</td></tr>
<tr><td>-USD CASH-</td><td>Cash</td><td>0.05%</td></tr>
</table>`;
const htmlResult = parseEtfHoldingSource('SMH', 'vaneck', 'https://example.test/smh', html);
assert.equal(htmlResult.holdings.length, 5);
assert.ok(Math.abs(htmlResult.holdings.reduce((sum, row) => sum + row.weight, 0) - 0.9995) < 1e-10);

const stockAnalysisHtml = `
<div>As of Jul 30, 2026</div><table>
<tr><th>Symbol</th><th>Description</th><th>% Portfolio Weight</th></tr>
<tr><td>NVDA</td><td>Nvidia</td><td>21.70%</td></tr>
<tr><td>TSM</td><td>Taiwan Semi</td><td>9.51%</td></tr>
<tr><td>AVGO</td><td>Broadcom</td><td>6.73%</td></tr>
<tr><td>AMD</td><td>AMD</td><td>5.43%</td></tr>
<tr><td>ASML</td><td>ASML</td><td>5.12%</td></tr>
<tr><td>MU</td><td>Micron</td><td>15.00%</td></tr>
<tr><td>TXN</td><td>Texas Instruments</td><td>12.00%</td></tr>
<tr><td>ADI</td><td>Analog Devices</td><td>10.00%</td></tr>
<tr><td>AMAT</td><td>Applied Materials</td><td>10.00%</td></tr>
<tr><td>QCOM</td><td>Qualcomm</td><td>5.00%</td></tr>
</table>`;
const stockAnalysisResult = parseEtfHoldingSource('SMH', 'stockanalysis', 'https://example.test/smh/holdings', stockAnalysisHtml);
assert.equal(stockAnalysisResult.asOf, '2026-07-30');
assert.equal(stockAnalysisResult.holdings.length, 10);

const vaneckFixture = await readFile(new URL('../tests/fixtures/etf-holdings/vaneck-smh-current.json', import.meta.url), 'utf8');
const vaneckResult = parseEtfHoldingSource('SMH', 'vaneck', 'https://example.test/smh.json', vaneckFixture);
assert.equal(vaneckResult.asOf, '2026-08-14');
assert.equal(vaneckResult.holdings.length, 25);
assert.equal(vaneckResult.holdings[0]?.ticker, 'NVDA');
assert.ok(Math.abs((vaneckResult.holdings[0]?.weight ?? 0) - 0.2204) < 1e-10);
assert.ok(Math.abs(vaneckResult.holdings.reduce((sum, row) => sum + row.weight, 0) - 0.9999) < 1e-10);

const originalFetch = globalThis.fetch;
let vaneckRequest: Request | undefined;
globalThis.fetch = async (input, init) => {
  vaneckRequest = new Request(input, init);
  return new Response(vaneckFixture, { status: 200, headers: { 'content-type': 'application/json' } });
};
try {
  const fetchedVaneck = await fetchEtfHoldingSnapshot('SMH');
  assert.equal(fetchedVaneck.holdings.length, 25);
  assert.match(vaneckRequest?.url ?? '', /stockanalysis\.com\/etf\/smh\/holdings/);
} finally {
  globalThis.fetch = originalFetch;
}

const staticData = JSON.parse(await readFile(new URL('../src/data/etf-holdings.json', import.meta.url), 'utf8')) as {
  etfs: Record<string, Array<{ ticker: string; weight: number }>>;
};
assert.deepEqual(staticEtfHoldingSnapshot('SMH')?.holdings, staticData.etfs.SMH);
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try {
  const fallback = await fetchEtfHoldingSnapshotWithFallback('SMH');
  assert.equal(fallback.mode, 'static-fallback');
  assert.equal(fallback.warning, 'provider_unavailable');
  assert.equal(fallback.snapshot.asOf, '2026-08-18');
  assert.equal(fallback.snapshot.holdings.length, 25);
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async () => new Response(vaneckFixture, { status: 200, headers: { 'content-type': 'application/json' } });
try {
  const stale = await fetchEtfHoldingSnapshotWithFallback('SMH');
  assert.equal(stale.mode, 'static-fallback');
  assert.equal(stale.warning, 'provider_stale');
  assert.equal(stale.snapshot.asOf, '2026-08-18');
} finally {
  globalThis.fetch = originalFetch;
}

const json = JSON.stringify({
  asOf: '2026-08-03',
  holdings: [
    { symbol: 'NVDA', weight: 30 }, { symbol: 'AAPL', weight: 25 },
    { symbol: 'MSFT', weight: 20 }, { symbol: 'AMZN', weight: 15 },
    { symbol: 'GOOGL', weight: 10 },
  ],
});
const jsonResult = parseEtfHoldingSource('QQQ', 'invesco', 'https://example.test/qqq', json);
assert.equal(jsonResult.asOf, '2026-08-03');
assert.equal(jsonResult.holdings.length, 5);

assert.equal(normalizeConstituentTicker('$BRK/B'), 'BRK.B');
assert.equal(normalizeConstituentTicker('-USD CASH-'), null);
assert.throws(() => parseEtfHoldingSource('QQQM', 'invesco', 'x', csv.replace('AAPL,Apple,25%', 'NVDA,Apple,25%')), /duplicate_ticker/);
assert.throws(() => parseEtfHoldingSource('VGT', 'vanguard', 'x', csv.replace('30%', '3%')), /invalid_weight_total/);
assert.throws(() => parseEtfHoldingSource('VGT', 'vanguard', 'x', csv.replace('08/04/2026', 'unknown')), /missing_as_of/);

const near = (actual: number | undefined, expected: number) => assert.ok(Math.abs((actual ?? NaN) - expected) < 1e-9, `${actual} != ${expected}`);
const leveragedData: EtfHoldingsData = {
  _meta: {
    cashLike: ['SGOV'],
    asOf: { QQQ: '2026-03-31', QQQM: '2026-10-20' },
    leveraged: { QLD: { underlying: ['QQQ', 'QQQM'], leverage: 2 } },
  },
  etfs: {
    QQQ: [{ ticker: 'NVDA', weight: 0.5 }],
    QQQM: [{ ticker: 'NVDA', weight: 0.1 }, { ticker: 'AAPL', weight: 0.4 }],
  },
};
// 取成分表最新的标的(QQQM 比 QQQ 新),QLD 不再被当成单票。
assert.equal(resolveLeveragedEtf('qld', leveragedData)?.underlying, 'QQQM');
assert.equal(resolveLeveragedEtf('QQQM', leveragedData), null);
const qld = computeLookThrough({
  holdings: [{ ticker: 'QLD', value: 100 }, { ticker: 'SGOV', value: 50 }],
  uninvestedCash: 50,
  data: leveragedData,
  lines: [{ id: 'nvda', label: '', labelEn: '', tickers: ['NVDA'], ceiling: 0.12, basis: 'nav', description: '' }],
});
assert.equal(qld.totalNav, 200);
assert.equal(qld.cashValue, 100);
assert.equal(qld.leverageFinancing, 100);
assert.equal(qld.equityValue, 200);
assert.equal(qld.stocks.some((stock) => stock.ticker === 'QLD'), false);
const qldNvda = qld.stocks.find((stock) => stock.ticker === 'NVDA');
near(qldNvda?.value, 20);
near(qldNvda?.weightNav, 0.1);
near(qldNvda?.weightEquity, 0.1);
assert.deepEqual(qldNvda?.sources.map((source) => source.via), ['QLD']);
near(qld.stocks.find((stock) => stock.ticker === 'AAPL')?.value, 80);
near(qld.unclassifiedValue, 100);
near(qld.lines[0]?.pct, 0.1);
// 已穿透 + 长尾 + 现金 = 总净值 + 杠杆融资。
near(qld.stocks.reduce((sum, stock) => sum + stock.value, 0) + qld.unclassifiedValue + qld.cashValue, qld.totalNav + qld.leverageFinancing);
const unlevered = computeLookThrough({ holdings: [{ ticker: 'QQQM', value: 100 }], data: leveragedData, lines: [] });
assert.equal(unlevered.leverageFinancing, 0);
assert.equal(unlevered.equityValue, 100);
assert.equal(resolveLeveragedEtf('QLD', staticData as EtfHoldingsData)?.leverage, 2);

console.log('ETF holdings parser checks passed.');
