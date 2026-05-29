import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const source = readFileSync('src/lib/quoteStatus.ts', 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
  },
});

const dir = mkdtempSync(join(tmpdir(), 'quote-status-'));
const modulePath = join(dir, 'quoteStatus.mjs');
writeFileSync(modulePath, transpiled.outputText);

const {
  getQuoteStatusLabel,
  getQuoteStatusText,
  getQuoteTimeLabel,
  getQuoteStatusSummary,
} = await import(modulePath);

const fetchedAt = '2026-05-29T14:00:00Z';
const asOf = '2026-05-29T14:35:00Z';

assert.equal(
  getQuoteStatusLabel({ source: 'schwab', price: 100, fetchedAt, realtime: true }),
  'Schwab · 实时',
);

assert.equal(
  getQuoteStatusLabel({ source: 'schwab', price: 100, fetchedAt, realtime: false, delayMinutes: 15 }),
  'Schwab · 延迟 15min',
);

assert.equal(
  getQuoteStatusLabel({ source: 'schwab', price: 100, fetchedAt }),
  'Schwab · 实时性未知',
);

assert.equal(
  getQuoteStatusLabel({ source: 'yahoo', price: 100, fetchedAt, fallback: false }),
  'Yahoo · 可能延迟',
);

assert.equal(
  getQuoteStatusLabel({ source: 'yahoo', price: 100, fetchedAt, fallback: true }),
  'Yahoo 备用行情 · 可能延迟',
);

const asOfTimeLabel = getQuoteTimeLabel({ source: 'schwab', price: 100, fetchedAt, asOf });
assert.match(asOfTimeLabel, /^行情 /);
assert.doesNotMatch(asOfTimeLabel, /^拉取 /);

const fetchedTimeLabel = getQuoteTimeLabel({ source: 'schwab', price: 100, fetchedAt });
assert.match(fetchedTimeLabel, /^拉取 /);

const statusText = getQuoteStatusText({ source: 'schwab', price: 100, fetchedAt, realtime: false, delayMinutes: 15 });
assert.doesNotMatch(statusText, /行情延迟 ~15min/);

const mixedSummary = getQuoteStatusSummary([
  { ticker: 'VOO', source: 'schwab', price: 100, prevClose: 99, change: 1, changePct: 0.01, marketState: 'REGULAR', fetchedAt, realtime: true },
  { ticker: 'QQQM', source: 'yahoo', price: 50, prevClose: 49, change: 1, changePct: 0.02, marketState: 'REGULAR', fetchedAt, fallback: true },
]);
assert.match(mixedSummary.text, /^Schwab \+ Yahoo 备用 · 部分可能延迟 · /);

console.log('quote status checks passed');
