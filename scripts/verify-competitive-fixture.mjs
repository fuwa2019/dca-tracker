import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixtureDir = resolve(root, 'docs/research/competitive/2026-08/fixtures');
const canonicalPath = resolve(fixtureDir, 'canonical-ledger.json');
const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8'));
const prices = JSON.parse(readFileSync(resolve(fixtureDir, 'ordinary-close-prices.json'), 'utf8'));
const SCALE = 10n;
const UNIT = 10n ** SCALE;

function parseFixed(value) {
  const text = String(value).trim();
  const negative = text.startsWith('-');
  const unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  assert.match(whole, /^\d+$/, `invalid fixed value: ${value}`);
  assert.match(fraction, /^\d*$/, `invalid fixed value: ${value}`);
  assert.ok(fraction.length <= Number(SCALE), `too many decimal places: ${value}`);
  const scaled = BigInt(whole) * UNIT + BigInt(fraction.padEnd(Number(SCALE), '0') || '0');
  return negative ? -scaled : scaled;
}

function formatFixed(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / UNIT;
  const fraction = String(absolute % UNIT).padStart(Number(SCALE), '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

assert.equal(canonical.fixture_id, 'dca-competitive-2026-08-v1');
assert.equal(canonical.base_currency, 'USD');
assert.ok(Array.isArray(canonical.events) && canonical.events.length >= 10);
assert.equal(prices.fixture_id, canonical.fixture_id);
assert.equal(prices.basis, 'ordinary_close_usd');
assert.ok(Array.isArray(prices.prices) && prices.prices.length >= 5);
assert.ok(prices.prices.every((row) => row.VGT && row.SMH));

const eventIds = new Set();
const cashByKind = new Map();
const shares = new Map();
let endingCash = 0n;
for (const event of canonical.events) {
  assert.ok(!eventIds.has(event.event_id), `duplicate canonical event id: ${event.event_id}`);
  eventIds.add(event.event_id);
  assert.match(event.effective_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof event.sequence, 'number');
  const amount = parseFixed(event.usd_amount);
  endingCash += amount;
  cashByKind.set(event.kind, (cashByKind.get(event.kind) ?? 0n) + amount);
  if (event.kind === 'trade') {
    assert.ok(event.ticker);
    const quantity = parseFixed(event.shares);
    const direction = event.side === 'buy' ? 1n : event.side === 'sell' ? -1n : 0n;
    assert.notEqual(direction, 0n, `invalid trade side: ${event.side}`);
    shares.set(event.ticker, (shares.get(event.ticker) ?? 0n) + direction * quantity);
  }
}

assert.equal(formatFixed(endingCash), canonical.expected.ending_cash_usd);
assert.equal(formatFixed(shares.get('VGT')), canonical.expected.ending_shares.VGT);
assert.equal(formatFixed(shares.get('SMH')), canonical.expected.ending_shares.SMH);
assert.equal(formatFixed(cashByKind.get('broker_deposit')), canonical.expected.investor_deposits_usd);
assert.equal(formatFixed(cashByKind.get('broker_withdrawal')), canonical.expected.investor_withdrawals_usd);
assert.equal(formatFixed(cashByKind.get('dividend')), canonical.expected.dividends_usd);
assert.equal(formatFixed(cashByKind.get('interest')), canonical.expected.interest_usd);
assert.equal(formatFixed(cashByKind.get('tax')), canonical.expected.taxes_usd);
assert.equal(formatFixed(cashByKind.get('fee')), canonical.expected.independent_fees_usd);

const requiredKinds = ['broker_deposit', 'broker_withdrawal', 'dividend', 'interest', 'tax', 'fee'];
for (const kind of requiredKinds) assert.ok(cashByKind.has(kind), `missing cash event kind: ${kind}`);

const sourceFiles = [
  'schwab-synthetic.tsv',
  'ibkr-transaction-history-en.csv',
  'ibkr-transaction-history-zh.csv',
  'ibkr-activity-statement-official-en.csv',
  'ibkr-activity-statement-official-zh.csv',
  'tradingview-portfolio.csv',
  'ordinary-close-prices.json',
];
const sourceText = new Map(sourceFiles.map((name) => [name, readFileSync(resolve(fixtureDir, name), 'utf8')]));
assert.match(sourceText.get('schwab-synthetic.tsv'), /Cash Dividend/);
assert.match(sourceText.get('schwab-synthetic.tsv'), /bad-date/);
assert.match(sourceText.get('ibkr-transaction-history-en.csv'), /Blocked non-USD event/);
assert.match(sourceText.get('ibkr-transaction-history-en.csv'), /exact duplicate/);
assert.match(sourceText.get('ibkr-transaction-history-zh.csv'), /预扣税/);
assert.match(sourceText.get('ibkr-activity-statement-official-en.csv'), /Date\/Time,Quantity,T\. Price,Proceeds/);
assert.match(sourceText.get('ibkr-activity-statement-official-zh.csv'), /日期\/时间,数量,成交价格,收益/);
assert.match(sourceText.get('tradingview-portfolio.csv'), /Taxes and fees/);
assert.match(sourceText.get('tradingview-portfolio.csv'), /not-a-number/);

const hashes = sourceFiles.map((name) => {
  const hash = createHash('sha256').update(sourceText.get(name)).digest('hex');
  return `${name}=${hash}`;
});
console.log('competitive fixture ok');
console.log(hashes.join('\n'));
