import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cashEventChip, ledgerEventChip, tradeEventChip, LEDGER_EVENT_KINDS } from '../src/lib/ledgerEvents.ts';
import { countLedgerEventKinds, retainedRowReasons, summarizeImportReceipt } from '../src/lib/import/receipt.ts';

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
assert.match(performance, /相对 \$\{selectedBenchmark\}/, 'performance summary uses selected benchmark');
assert.doesNotMatch(performance, /相对 SPY。/, 'performance summary must not hard-code SPY');
assert.match(performance, /MonthlyPerformanceCalendar/, 'performance page includes the monthly calendar');

const calendar = readFileSync(new URL('../src/components/MonthlyPerformanceCalendar.tsx', import.meta.url), 'utf8');
assert.match(calendar, /金额/, 'calendar has amount mode');
assert.match(calendar, /百分比/, 'calendar has percentage mode');
assert.match(calendar, /本月暂无业绩数据/, 'calendar has an empty-month state');

const dailyPnlMigration = readFileSync(new URL('../supabase/migrations/0042_private_performance_daily_pnl.sql', import.meta.url), 'utf8');
assert.match(dailyPnlMigration, /create table if not exists public\.performance_daily_pnl_cache/, 'private daily PnL cache exists');
assert.match(dailyPnlMigration, /\(select auth\.uid\(\)\) is not null and \(select auth\.uid\(\)\) = user_id/, 'private cache is owner-scoped');
assert.match(dailyPnlMigration, /p_end_date - p_start_date > 41/, 'daily PnL RPC caps requests at 42 days');
assert.match(dailyPnlMigration, /revoke all on function public\.performance_daily_pnl\(date, date, text\) from public, anon, authenticated/, 'daily PnL RPC is not public');
assert.match(dailyPnlMigration, /grant execute on function public\.performance_daily_pnl\(date, date, text\) to authenticated/, 'daily PnL RPC is authenticated-only');
assert.match(dailyPnlMigration, /v_history := v_history - 'warnings'/, 'public cache strips amount-bearing diagnostics');

const cashflow = readFileSync(new URL('../src/components/CashflowForm.tsx', import.meta.url), 'utf8');
assert.match(cashflow, /fetchCurrentExchangeRate/, 'cashflow form fetches current FX rate');
assert.match(cashflow, /rateTouched/, 'cashflow form tracks touched FX field');

const txn = readFileSync(new URL('../src/components/TxnForm.tsx', import.meta.url), 'utf8');
assert.match(txn, /useQuotes\(\[normalizedTicker\]\)/, 'transaction form fetches current symbol quote');
assert.match(txn, /priceTouched/, 'transaction form tracks touched price field');
assert.match(txn, /手续费 \(USD，可选\)/, 'transaction form supports optional USD fees');
assert.match(txn, /买入总支出/, 'transaction form shows fee-aware buy total');
assert.match(txn, /卖出净收入/, 'transaction form shows fee-aware sell proceeds');
assert.match(txn, /id="price"[\s\S]*?step="0\.000000000001"/, 'transaction form preserves 12-decimal prices');
assert.match(txn, /id="shares"[\s\S]*?step="0\.0000000001"/, 'transaction form preserves 10-decimal quantities');
assert.match(txn, /id="fees-usd"[\s\S]*?step="0\.0000000001"/, 'transaction form preserves 10-decimal fees');

const transactionTools = readFileSync(new URL('../src/components/SchwabTransactionTools.tsx', import.meta.url), 'utf8');
assert.match(transactionTools, /新增导入/, 'Schwab import supports append mode');
assert.match(transactionTools, /清空全部后导入/, 'Schwab import supports full reset mode');
assert.match(transactionTools, /className="sr-only"/, 'Schwab file input uses the custom accessible picker');
assert.match(transactionTools, /确认清空全部组合数据/, 'reset requires a visible full-reset confirmation');
assert.match(
  transactionTools,
  /p_cashflows:\s*\[[\s\S]*?cashPlan\.deposits\.map[\s\S]*?cashPlan\.allocations\.map/,
  'Schwab import sends original deposits and dated stock allocations',
);
assert.match(transactionTools, /selectedRows[\s\S]*confirmedEtfSymbols\.has/, 'Schwab import keeps confirmed ETF trades only');
assert.match(transactionTools, /excludedStockRows[\s\S]*confirmedStockSymbols\.has/, 'individual-stock trades are explicitly excluded');
assert.match(transactionTools, /buildSchwabEtfCashPlan/, 'the import preview uses the retained-ETF cash ledger');
assert.match(transactionTools, /cashPlan\.warnings/, 'temporary cash gaps are presented separately from blocking errors');
assert.match(transactionTools, /现金历史存在暂时缺口，不阻止导入/, 'temporary cash gaps remain explicitly non-blocking');
assert.match(transactionTools, /含个股、存款或个股划转的文件必须清空全部后导入/, 'cash reconstruction blocks append mode');
assert.match(transactionTools, /resetCoverageConfirmed[\s\S]*border-warn\/50 bg-warn-soft/, 'ETF reset confirmation has a selected state');
assert.match(transactionTools, /全部交易、全部现金流和资金批次将先清除/, 'reset explicitly clears all portfolio input data');
assert.match(transactionTools, /手工交易、手工现金流和资金批次也会删除/, 'strict reset does not preserve manual portfolio data');
assert.match(transactionTools, /确认清空并导入/, 'full reset has a second confirmation');
assert.match(transactionTools, /打开数据健康/, 'successful import points to price coverage health');
assert.match(transactionTools, /exportSchwabTransactions/, 'transaction tools expose Schwab-format export');
assert.match(transactionTools, /exportSchwabTransactions\([\s\S]*?exportRows,[\s\S]*?exportCashflows\.map/, 'Schwab export contains ETF trades and cash events');
assert.match(transactionTools, /Schwab_Transactions_/, 'combined export uses a transaction-history filename');

const portfolioImport = readFileSync(new URL('../src/components/PortfolioImportTools.tsx', import.meta.url), 'utf8');
assert.match(portfolioImport, /import_portfolio_ledger/, 'source-neutral preview writes through the generic ledger RPC');
assert.match(portfolioImport, /replace_source/, 'source-neutral preview exposes source replacement');
assert.match(portfolioImport, /reset_all/, 'source-neutral preview exposes full reset mode');
assert.match(portfolioImport, /导入/, 'source-neutral preview labels import rows');
assert.match(portfolioImport, /重复/, 'source-neutral preview labels duplicate rows');
assert.match(portfolioImport, /忽略/, 'source-neutral preview labels ignored rows');
assert.match(portfolioImport, /阻止/, 'source-neutral preview labels blocked rows');
assert.match(portfolioImport, /role="table"/, 'source-neutral preview exposes a semantic row table');
assert.match(portfolioImport, /aria-live/, 'source-neutral preview announces status changes');
assert.match(portfolioImport, /sm:grid-cols-\[3\.5rem_8rem_5rem/, 'row details collapse into a mobile layout');
assert.match(portfolioImport, /本地演示模式只展示预览，不写入数据库/, 'local mode never writes through the preview');
assert.match(portfolioImport, /资产确认/, 'source-neutral preview exposes asset confirmation');
assert.match(portfolioImport, /个股，忽略/, 'asset confirmation can explicitly ignore stocks');
assert.match(portfolioImport, /ETF，导入/, 'asset confirmation can explicitly retain ETFs');
assert.match(portfolioImport, /导入前对账/, 'preview exposes normalized reconciliation totals');
assert.match(portfolioImport, /cash_by_kind/, 'preview exposes cash-event reconciliation categories');

const localMode = readFileSync(new URL('../src/lib/localMode.ts', import.meta.url), 'utf8');
assert.match(localMode, /VITE_LEDGER_IMPORT_V2/, 'ledger preview has an explicit rollout flag');

const quote = readFileSync(new URL('../src/lib/quote.ts', import.meta.url), 'utf8');
assert.match(quote, /limitedFetchJson<\{ quotes: Quote\[\] \}>\('quote'/, 'quote requests pass through the unified rate limiter');
assert.match(quote, /rateLimited\('history'/, 'history requests pass through the unified rate limiter');
assert.match(quote, /fetchCurrentExchangeRate/, 'FX lookup reuses the quote provider');

const exposure = readFileSync(new URL('../src/app/exposure.tsx', import.meta.url), 'utf8');
assert.match(exposure, /刷新敞口/, 'exposure page has a manual refresh action');
assert.match(exposure, /refreshEtfHoldings/, 'exposure refresh calls the authenticated Worker flow');
assert.match(exposure, /部分刷新失败/, 'exposure page reports partial provider failures');

const quoteWorker = readFileSync(new URL('../workers/quote/src/index.ts', import.meta.url), 'utf8');
assert.match(quoteWorker, /\/api\/etf-holdings\/refresh/, 'quote Worker exposes the ETF refresh route');
assert.match(quoteWorker, /Access-Control-Allow-Headers': 'Authorization, Content-Type'/, 'Worker CORS permits bearer authorization');

// --- Ledger event-type chips -------------------------------------------------

// Gain-coloured events: buy, deposit, dividend, interest.
for (const kind of ['buy', 'broker_deposit', 'dividend', 'interest']) {
  assert.equal(ledgerEventChip(kind).tone, 'ok', `${kind} uses the gain tone`);
  assert.equal(ledgerEventChip(kind).direction, 'gain', `${kind} is a cash-positive event`);
}
// Loss-coloured events: sell, withdrawal, tax, fee.
for (const kind of ['sell', 'broker_withdrawal', 'tax', 'fee']) {
  assert.equal(ledgerEventChip(kind).tone, 'bad', `${kind} uses the loss tone`);
  assert.equal(ledgerEventChip(kind).direction, 'loss', `${kind} is a cash-negative event`);
}
// Transfers move existing money and stay outside the gain/loss pair.
assert.equal(ledgerEventChip('fx_transfer').direction, 'neutral', 'FX transfer is not a gain or loss event');
assert.equal(ledgerEventChip('stock_allocation').direction, 'neutral', 'stock allocation is not a gain or loss event');
assert.equal(ledgerEventChip('buy').label, '买入');
assert.equal(ledgerEventChip('sell').label, '卖出');
assert.equal(ledgerEventChip('broker_deposit').label, '入金');
assert.equal(ledgerEventChip('broker_withdrawal').label, '提款');
assert.equal(ledgerEventChip('dividend').label, '股息');
assert.equal(ledgerEventChip('interest').label, '利息');
assert.equal(ledgerEventChip('tax').label, '税款');
assert.equal(ledgerEventChip('fee').label, '费用');
assert.equal(tradeEventChip('sell').kind, 'sell', 'sell rows use the sell chip');
assert.equal(tradeEventChip('buy').kind, 'buy', 'buy rows use the buy chip');
assert.equal(tradeEventChip(null).kind, 'buy', 'a missing side falls back to buy, matching the stored default');
assert.equal(cashEventChip('dividend').group, 'cash', 'dividends are cash events');
// An unknown kind stays visible instead of being relabelled as a known event.
assert.equal(ledgerEventChip('not_a_kind').label, '未知事件', 'unknown kinds are labelled, not silently mapped');
assert.equal(ledgerEventChip(undefined).label, '未知事件', 'a missing kind is labelled, not silently mapped');
assert.equal(LEDGER_EVENT_KINDS.length, 10, 'every trade side and cashflow kind has a chip');

const txnList = readFileSync(new URL('../src/components/TxnList.tsx', import.meta.url), 'utf8');
assert.match(txnList, /tradeEventChip/, 'transaction rows use the shared event chip');
assert.doesNotMatch(txnList, /isSell \? '卖出' : '买入'/, 'transaction rows no longer inline the side label');
assert.match(txnList, /text-right font-medium tnum/, 'transaction amount column is right-aligned tabular-nums');

const cashflows = readFileSync(new URL('../src/app/cashflows.tsx', import.meta.url), 'utf8');
assert.match(cashflows, /cashEventChip\(c\.cashflow_kind\)/, 'cash rows resolve a chip from the stored event kind');
assert.match(cashflows, /w-28 shrink-0 text-right font-medium tnum/, 'cash amount column is right-aligned tabular-nums');
assert.match(cashflows, /cashEventDetail/, 'cash rows keep their source detail visible');
assert.doesNotMatch(cashflows, /\? '嘉信入金'/, 'cash rows no longer hard-code two deposit labels for every kind');

// --- Import receipt: imported / duplicates / skipped / total ------------------

const previewRows = [
  { source_index: 2, action: 'Buy', category: 'trade', default_status: 'import', status: 'import', item: { side: 'buy', ticker: 'VGT', shares: '1', usd_amount: '-100' } },
  { source_index: 3, action: 'Buy', category: 'trade', default_status: 'import', status: 'duplicate', item: { side: 'buy', ticker: 'VGT', shares: '1', usd_amount: '-100' } },
  { source_index: 4, action: 'Dividend', category: 'cash_event', default_status: 'import', status: 'import', item: { event_type: 'dividend', ticker: 'VGT', usd_amount: '1.25' } },
  { source_index: 5, action: 'Buy', category: 'ignored', default_status: 'ignore', status: 'ignore', item: { side: 'buy', ticker: 'AAPL', shares: '1', usd_amount: '-10' }, reason: '证券类型为个股，不属于单组合 ETF 账本。' },
  { source_index: 6, action: 'Withdrawal', category: 'error', default_status: 'block', status: 'block', reason: '金额无法解析。' },
];
const statusCounts = { import: 2, duplicate: 1, ignore: 1, block: 1 };

// The reference receipt shape: 0 imported / 13 duplicates / 14 skipped / 14 total.
const repeatImport = summarizeImportReceipt({
  result: { added: 0, unchanged: 13, removed: 0 },
  status_counts: { import: 0, duplicate: 13, ignore: 0, block: 1 },
  total_rows: 14,
});
assert.deepEqual(
  { imported: repeatImport.imported, duplicates: repeatImport.duplicates, skipped: repeatImport.skipped, total: repeatImport.total },
  { imported: 0, duplicates: 13, skipped: 14, total: 14 },
  'a repeat import reproduces the reference four-number receipt',
);

const firstImport = summarizeImportReceipt({
  result: { added: 2, unchanged: 1, removed: 0 },
  status_counts: statusCounts,
  total_rows: previewRows.length,
});
assert.equal(firstImport.total, 5, 'total counts every source row');
assert.equal(firstImport.imported, 2, 'imported comes from the database receipt');
assert.equal(firstImport.duplicates, 1, 'duplicates come from the database receipt');
assert.equal(firstImport.skipped, 3, 'skipped is every row that produced no new record');
assert.equal(firstImport.imported + firstImport.skipped, firstImport.total, 'the four numbers reconcile');
assert.equal(firstImport.ignored, 1, 'ignored rows stay separately reported');
assert.equal(firstImport.blocked, 1, 'blocked rows stay separately reported');

// A receipt can never claim more imported rows than the file supplied.
const overreport = summarizeImportReceipt({
  result: { added: 9, unchanged: 0, removed: 0 },
  status_counts: { import: 1, duplicate: 0, ignore: 0, block: 0 },
  total_rows: 1,
});
assert.equal(overreport.imported, 1, 'imported is clamped to the source row count');
assert.equal(overreport.skipped, 0, 'skipped never goes negative');

assert.deepEqual(
  countLedgerEventKinds(previewRows, ['import', 'duplicate']),
  [{ kind: 'buy', count: 2 }, { kind: 'dividend', count: 1 }],
  'event composition groups committed rows by trade side and cash-event type',
);
assert.deepEqual(countLedgerEventKinds(previewRows), [{ kind: 'buy', count: 1 }, { kind: 'dividend', count: 1 }], 'the default composition covers importable rows only');

const reasons = retainedRowReasons(previewRows);
assert.equal(reasons.length, 2, 'blocked and ignored rows keep a visible reason');
assert.deepEqual(reasons.map((row) => row.status), ['ignore', 'block'], 'reasons keep their row status');
assert.ok(reasons.every((row) => row.reason.length > 0), 'no retained row loses its reason text');

assert.match(portfolioImport, /summarizeImportReceipt/, 'the receipt derives the four-number summary');
assert.match(portfolioImport, /已导入 imported/, 'receipt reports imported');
assert.match(portfolioImport, /重复 duplicates/, 'receipt reports duplicates');
assert.match(portfolioImport, /未写入 skipped/, 'receipt reports skipped');
assert.match(portfolioImport, /源文件总行 total/, 'receipt reports total');
assert.match(portfolioImport, /新增交易/, 'receipt keeps the existing ledger-record counts');
assert.match(portfolioImport, /retainedRowReasons/, 'receipt keeps blocked and ignored reasons visible');
assert.match(portfolioImport, /不做静默修正/, 'receipt states that nothing is silently corrected');
assert.match(portfolioImport, /事件类型构成/, 'preview groups rows by event type');
assert.match(portfolioImport, /ledgerEventChip/, 'preview rows carry a coloured event-type chip');
assert.doesNotMatch(portfolioImport, /p_trades:\s*preview\.rows/, 'the RPC payload still sends normalized ledger items');

// --- Dialog keyboard focus return (C2) ---------------------------------------
// Controlled dialogs without a DialogTrigger (import preview, row edit/delete)
// previously dropped keyboard focus to <body> on close. The shared primitive
// must remember the invoker in onOpenAutoFocus, while it still holds focus,
// and return to it in onCloseAutoFocus without clobbering call-site handlers.
const dialogUi = readFileSync(new URL('../src/components/ui/dialog.tsx', import.meta.url), 'utf8');
assert.match(dialogUi, /onOpenAutoFocus=\{\(event\) => \{\s*if \(document\.activeElement instanceof HTMLElement/, 'dialog remembers the invoker before Radix moves focus');
assert.match(dialogUi, /onCloseAutoFocus=\{\(event\) => \{\s*onCloseAutoFocus\?\.\(event\);/, 'dialog runs the call-site close handler first');
assert.match(dialogUi, /!event\.defaultPrevented && target && target\.isConnected/, 'dialog only restores focus to a still-mounted invoker');

console.log('UI behavior checks passed');
