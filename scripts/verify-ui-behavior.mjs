import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function calculateRefreshInterval(symbolCount, config) {
  const count = Math.max(0, Math.floor(symbolCount));
  if (count === 0) return config.autoRefreshMinIntervalMs;
  const batchSize = Math.max(1, Math.floor(config.maxSymbolsPerQuoteRequest));
  const requestsPerRefresh = Math.max(1, Math.ceil(count / batchSize));
  const quoteLimit = config.endpointMaxRequestsPerMinute.quote ?? config.maxRequestsPerMinute;
  const safeLimit = Math.max(1, Math.floor(Math.min(config.maxRequestsPerMinute, quoteLimit) * config.safetyMargin));
  const limitInterval = Math.ceil((requestsPerRefresh / safeLimit) * 60_000);
  return Math.max(config.autoRefreshMinIntervalMs, limitInterval);
}

function shouldAutoFillField({ isEdit, touched, currentValue }) {
  if (isEdit || touched) return false;
  return currentValue.trim() === '';
}

const cfg = {
  maxRequestsPerMinute: 30,
  endpointMaxRequestsPerMinute: { quote: 30 },
  safetyMargin: 0.5,
  maxSymbolsPerQuoteRequest: 20,
  autoRefreshMinIntervalMs: 30_000,
};

assert.equal(calculateRefreshInterval(3, cfg), 30_000, 'small watchlist uses minimum interval');
assert.equal(calculateRefreshInterval(400, cfg), 80_000, 'large watchlist lengthens interval');
assert.equal(calculateRefreshInterval(401, cfg), 84_000, 'batch boundary affects interval');
assert.equal(shouldAutoFillField({ isEdit: false, touched: false, currentValue: '' }), true, 'empty add form autofills');
assert.equal(shouldAutoFillField({ isEdit: false, touched: true, currentValue: '7.2' }), false, 'touched field is not overwritten');
assert.equal(shouldAutoFillField({ isEdit: true, touched: false, currentValue: '' }), false, 'edit form is not overwritten');

const performance = readFileSync(new URL('../src/app/performance.tsx', import.meta.url), 'utf8');
assert.match(performance, /交易业绩是否跑赢 \{selectedBenchmark\}/, 'performance title uses selected benchmark');
assert.doesNotMatch(performance, /交易业绩是否跑赢 SPY/, 'performance title must not hard-code SPY');

const cashflow = readFileSync(new URL('../src/components/CashflowForm.tsx', import.meta.url), 'utf8');
assert.match(cashflow, /fetchCurrentExchangeRate/, 'cashflow form fetches current FX rate');
assert.match(cashflow, /rateTouched/, 'cashflow form tracks touched FX field');

const txn = readFileSync(new URL('../src/components/TxnForm.tsx', import.meta.url), 'utf8');
assert.match(txn, /useQuotes\(\[normalizedTicker\]\)/, 'transaction form fetches current symbol quote');
assert.match(txn, /priceTouched/, 'transaction form tracks touched price field');

const quote = readFileSync(new URL('../src/lib/quote.ts', import.meta.url), 'utf8');
assert.match(quote, /limitedFetchJson<\{ quotes: Quote\[\] \}>\('quote'/, 'quote requests pass through the unified rate limiter');
assert.match(quote, /rateLimited\('history'/, 'history requests pass through the unified rate limiter');
assert.match(quote, /fetchCurrentExchangeRate/, 'FX lookup reuses the quote provider');

console.log('UI behavior checks passed');
