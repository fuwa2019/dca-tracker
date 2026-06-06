import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/0031_tracked_symbols_registry.sql', import.meta.url), 'utf8');
const universeMigration = readFileSync(new URL('../supabase/migrations/0034_price_universe_required_coverage.sql', import.meta.url), 'utf8');
const health = readFileSync(new URL('../src/app/data-health.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/app/dashboard.tsx', import.meta.url), 'utf8');
const tracked = readFileSync(new URL('../src/lib/trackedSymbols.ts', import.meta.url), 'utf8');
const symbols = readFileSync(new URL('../src/lib/symbols.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../workers/quote/src/index.ts', import.meta.url), 'utf8');
const quote = readFileSync(new URL('../src/lib/quote.ts', import.meta.url), 'utf8');

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
assert.match(tracked, /startDate: input\.firstTradeDate \?\? oneYearAgoIso\(\)/, 'new IBIT backfill starts from first trade date or one-year fallback, not listing date');
assert.doesNotMatch(tracked, /fetchHistory\(\[symbol\], 'max', \{ persist: 'sync' \}\)/, 'addTrackedSymbol no longer enqueues max full-history backfill');
assert.match(health, /supabase\.rpc\('tracked_symbol_coverage', \{ p_benchmark: selectedBenchmark \}\)/, 'health page reads benchmark-aware coverage RPC');
assert.doesNotMatch(health, /supabase\.rpc\('daily_price_coverage_v2'/, 'health page no longer derives rows from existing prices');
assert.match(health, /row\.backfill_status === 'pending' \? 'warn' : 'bad'/, 'zero-row symbols remain visible as pending or missing');
assert.match(dashboard, /registerTrackedSymbols\(symbols, 'dashboard'\)/, 'dashboard quote symbols register with the same registry');
assert.match(worker, /updateTrackedSymbolBackfill\(env, item\.ticker, backfillFailureStatus\(failure\)/, 'worker records failed backfills');
assert.match(worker, /series\.points\.length > 0 \? 'ok' : 'missing'/, 'worker records zero-row backfills as missing');

assert.match(universeMigration, /returns table \(\s*symbol text,\s*current_position text,\s*required_start date,\s*required_end date/s, 'price universe exposes required_start and status');
assert.match(universeMigration, /when 'benchmark' then 1[\s\S]*when 'active' then 2[\s\S]*when 'watchlist' then 3[\s\S]*else 4/, 'benchmark/active/watchlist/closed status priority is explicit');
assert.match(universeMigration, /t\.first_trade_date as required_start/, 'traded ticker required_start is first transaction date');
assert.match(universeMigration, /coalesce\(p\.first_calc_date, current_date - interval '1 year'\)::date/, 'benchmark required_start follows portfolio earliest calculation date, not QQQ listing date');
assert.match(universeMigration, /where u\.current_position in \('active', 'benchmark', 'watchlist'\)/, 'closed symbols stay out of active monitor universe');
assert.match(universeMigration, /dp\.trade_date between u\.required_start and u\.required_end/, 'coverage counts only required date range');
assert.match(universeMigration, /ps\.price_min_date/, 'health output exposes database price_min_date separately');
assert.match(universeMigration, /ps\.price_max_date/, 'health output exposes database price_max_date separately');

assert.match(worker, /const HISTORY_MAX_PROVIDER_FETCHES_PER_INVOCATION = 10/, 'worker has hard history provider fetch limit');
assert.match(worker, /allSymbols\.slice\(cursor, cursor \+ limit\)/, 'history endpoint processes one cursor page per invocation');
assert.match(worker, /hasMore: nextCursor < allSymbols\.length/, 'history endpoint returns hasMore progress');
assert.match(worker, /nextCursor: nextCursor < allSymbols\.length \? String\(nextCursor\) : null/, 'history endpoint returns nextCursor');
assert.match(worker, /fetchHistoryFromProvider\(env, s, range, historyParamsForSymbol/, 'worker applies per-symbol start/end date bounds');
assert.match(worker, /period1/, 'Yahoo history uses period1/period2 when startDate is provided');
assert.match(worker, /active_monitor_universe/, 'cron sync uses active monitor universe before falling back');

assert.match(quote, /cursor\?: string \| number \| null/, 'frontend history client accepts cursor');
assert.match(tracked, /localStorage\.setItem\(backfillCursorKey/, 'frontend persists backfill cursor across failures');
assert.match(tracked, /fetchHistoryPage\(symbols, options\.range \?\? '1y'/, 'frontend loops paged history endpoint');
assert.match(health, /const requiredStart = row\.required_start/, 'health page displays required_start from RPC');
assert.match(health, /const priceMinDate = row\.price_min_date/, 'health page displays price_min_date from RPC');
assert.match(health, /const priceMaxDate = row\.price_max_date/, 'health page displays price_max_date from RPC');

console.log('Tracked symbol registry checks passed');
