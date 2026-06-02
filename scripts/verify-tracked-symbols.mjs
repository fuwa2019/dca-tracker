import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/0031_tracked_symbols_registry.sql', import.meta.url), 'utf8');
const health = readFileSync(new URL('../src/app/data-health.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/app/dashboard.tsx', import.meta.url), 'utf8');
const tracked = readFileSync(new URL('../src/lib/trackedSymbols.ts', import.meta.url), 'utf8');
const symbols = readFileSync(new URL('../src/lib/symbols.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../workers/quote/src/index.ts', import.meta.url), 'utf8');

function normalizeSymbol(symbol) {
  return symbol.trim().toUpperCase();
}

assert.equal(normalizeSymbol('ibit'), 'IBIT', 'lowercase IBIT normalizes');
assert.equal(normalizeSymbol('IBIT'), 'IBIT', 'uppercase IBIT stays stable');
assert.equal(normalizeSymbol(' ibit '), 'IBIT', 'whitespace is trimmed');

assert.match(migration, /create table if not exists public\.tracked_symbols/, 'tracked_symbols registry exists');
assert.match(migration, /create unique index if not exists daily_prices_ticker_trade_date_unique\s+on public\.daily_prices \(ticker, trade_date\)/, 'daily_prices keeps one row per symbol and date');
assert.match(migration, /check \(ticker <> '' and ticker = public\.normalize_symbol\(ticker\)\)/, 'daily_prices stores uppercase symbols');
assert.match(migration, /from public\.tracked_symbols ts\s+left join public\.daily_prices dp/s, 'health coverage starts from tracked symbols with LEFT JOIN');
assert.match(migration, /when c\.daily_rows = 0 and c\.backfill_status = 'ok' then 'missing'/, 'zero-row symbols cannot silently report ok');
assert.match(migration, /perform public\._upsert_tracked_symbol\(new\.ticker, null, null, 'transaction', new\.trade_date\)/, 'transactions register symbols');
assert.match(migration, /watchlist \|\| benchmarks \|\| array\[selected_benchmark\]/, 'settings watchlist and benchmarks seed the registry');

assert.match(symbols, /symbol\.trim\(\)\.toUpperCase\(\)/, 'frontend has one normalizeSymbol implementation');
assert.match(tracked, /addTrackedSymbol/, 'frontend exposes addTrackedSymbol workflow');
assert.match(tracked, /fetchHistory\(\[symbol\], 'max', \{ persist: 'sync' \}\)/, 'addTrackedSymbol enqueues sync daily backfill');
assert.match(health, /supabase\.rpc\('tracked_symbol_coverage'\)/, 'health page reads tracked symbol coverage RPC');
assert.doesNotMatch(health, /supabase\.rpc\('daily_price_coverage_v2'/, 'health page no longer derives rows from existing prices');
assert.match(health, /row\.backfill_status === 'pending' \? 'warn' : 'bad'/, 'zero-row symbols remain visible as pending or missing');
assert.match(dashboard, /registerTrackedSymbols\(symbols, 'dashboard'\)/, 'dashboard quote symbols register with the same registry');
assert.match(worker, /updateTrackedSymbolBackfill\(env, item\.ticker, backfillFailureStatus\(failure\)/, 'worker records failed backfills');
assert.match(worker, /series\.points\.length > 0 \? 'ok' : 'missing'/, 'worker records zero-row backfills as missing');

console.log('Tracked symbol registry checks passed');
