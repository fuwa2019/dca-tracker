import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHWAB_HEADERS } from '../src/lib/schwabTransactions.ts';
import {
  applyRowFix,
  detectPortfolioImportAdapter,
  ibkrImportAdapter,
  isRowFixable,
  rebuildPreviewAfterRowFix,
  rowFieldEdits,
  schwabImportAdapter,
  tradingViewImportAdapter,
} from '../src/lib/import/index.ts';

const fixtureDir = 'docs/research/competitive/2026-08/fixtures';
const read = (name: string) => readFileSync(`${fixtureDir}/${name}`, 'utf8');

const schwabText = read('schwab-synthetic.tsv');
const ibkrEnglishText = read('ibkr-transaction-history-en.csv');
const ibkrChineseText = read('ibkr-transaction-history-zh.csv');
const ibkrHeaderDataText = read('ibkr-transaction-history-header-data-multicurrency.csv');
const tradingViewText = read('tradingview-portfolio.csv');

const schwabPreview = schwabImportAdapter.audit({ text: schwabText, fileName: 'schwab-synthetic.tsv' });
assert.equal(schwabPreview.detection.supported, true);
assert.ok(schwabPreview.trades.length >= 3);
assert.ok(schwabPreview.cash_events.length >= 1);
assert.equal(schwabPreview.status_counts.ignore, 0, 'known Schwab cash actions are not silently ignored');
assert.equal(schwabPreview.status_counts.block, 1, 'the malformed Schwab row must remain blocked');
assert.ok(schwabPreview.warnings.some((warning) => warning.includes('source ordinal')));
assert.ok(schwabPreview.reconciliation.ending_shares.VGT);
assert.ok(schwabPreview.reconciliation.ending_cash_usd);
assert.equal(schwabPreview.trades.find((row) => row.ticker === 'VGT')?.usd_amount, '-200.3703703670');
assert.ok(schwabPreview.trades.some((row) => row.source_action === 'Reinvest Shares'));
assert.deepEqual(
  new Set(schwabPreview.cash_events.map((row) => row.event_type)),
  new Set(['broker_deposit', 'dividend', 'interest', 'broker_withdrawal', 'tax', 'fee']),
);
const schwabExport = schwabImportAdapter.export?.({
  trades: schwabPreview.trades,
  cash_events: schwabPreview.cash_events,
}) ?? '';
assert.match(schwabExport, /Date\tAction\tSymbol/);
const schwabRoundTrip = schwabImportAdapter.audit({ text: schwabExport, fileName: 'schwab-round-trip.tsv' });
assert.equal(schwabRoundTrip.errors.length, 0, 'Schwab export must re-import without blocked rows');
assert.equal(schwabRoundTrip.trades.length, schwabPreview.trades.length);
assert.equal(schwabRoundTrip.cash_events.length, schwabPreview.cash_events.length);

const schwabActionFixture = [
  SCHWAB_HEADERS.join('\t'),
  '01/10/2026\tCash Dividend\tVGT\tSynthetic dividend\t\t\t\t$1.25',
  '01/10/2026\tReinvest Dividend\tVGT\tSynthetic reinvested dividend\t\t\t\t$1.25',
  '01/10/2026\tQual Div Reinvest\tVGT\tSynthetic qualified reinvested dividend\t\t\t\t$0.50',
  '01/10/2026\tReinvest Shares\tVGT\tSynthetic reinvested shares\t0.0125\t$100.00\t\t-$1.25',
  '01/11/2026\tBank Interest\t\tSynthetic interest\t\t\t\t$0.07',
  '01/12/2026\tMoneyLink Transfer\t\tSynthetic inbound\t\t\t\t$50.00',
  '01/13/2026\tMoneyLink Transfer\t\tSynthetic outbound\t\t\t\t-$5.00',
  '01/14/2026\tNRA Tax Adj\t\tSynthetic tax\t\t\t\t-$0.13',
  '01/15/2026\tFee\t\tSynthetic fee\t\t\t\t-$0.07',
].join('\n');
const schwabActions = schwabImportAdapter.audit({ text: schwabActionFixture, fileName: 'schwab-actions.tsv' });
assert.equal(schwabActions.errors.length, 0);
assert.equal(schwabActions.status_counts.block, 0);
assert.ok(schwabActions.cash_events.some((row) => row.source_action === 'Reinvest Dividend' && row.event_type === 'dividend'));
assert.ok(schwabActions.cash_events.some((row) => row.source_action === 'Qual Div Reinvest' && row.event_type === 'dividend'));
assert.ok(schwabActions.cash_events.some((row) => row.source_action === 'MoneyLink Transfer' && row.event_type === 'broker_withdrawal' && row.usd_amount === '-5.0000000000'));
assert.ok(schwabActions.cash_events.some((row) => row.source_action === 'NRA Tax Adj' && row.event_type === 'tax'));

const schwabIndividualStockFixture = [
  SCHWAB_HEADERS.join('\t'),
  '01/16/2026\tBuy\tAAPL\tApple Inc.\t1\t$150.00\t$0.00\t-$150.00',
].join('\n');
const schwabIndividualStock = schwabImportAdapter.audit({ text: schwabIndividualStockFixture, fileName: 'schwab-individual-stock.tsv' });
assert.equal(schwabIndividualStock.errors.length, 0);
assert.equal(schwabIndividualStock.status_counts.import, 1, 'unified Schwab import retains individual stocks');
assert.equal(schwabIndividualStock.status_counts.ignore, 0, 'individual stocks are not silently ignored');
assert.equal(schwabIndividualStock.trades[0]?.ticker, 'AAPL');

const ibkrPreview = ibkrImportAdapter.audit({ text: ibkrEnglishText, fileName: 'ibkr-transaction-history-en.csv' });
assert.equal(ibkrPreview.detection.supported, true);
assert.ok(ibkrPreview.trades.some((row) => row.ticker === 'SMH'));
assert.ok(ibkrPreview.cash_events.some((row) => row.event_type === 'dividend'));
assert.ok(ibkrPreview.cash_events.some((row) => row.event_type === 'tax'));
assert.ok(ibkrPreview.status_counts.block >= 2, 'non-USD and malformed rows must block');
assert.equal(ibkrPreview.trades.find((row) => row.ticker === 'VGT')?.usd_amount, '-200.3703703670');
assert.ok(ibkrPreview.reconciliation.cash_by_kind.dividend);

const ibkrChinesePreview = ibkrImportAdapter.audit({ text: ibkrChineseText, fileName: 'ibkr-transaction-history-zh.csv' });
assert.equal(ibkrChinesePreview.detection.supported, true);
assert.ok(ibkrChinesePreview.trades.some((row) => row.ticker === 'VGT'));
assert.ok(ibkrChinesePreview.cash_events.some((row) => row.event_type === 'interest'));
assert.ok(ibkrChinesePreview.status_counts.block >= 2);

// IBKR's localized transaction-history export also uses one-character and
// translated cash/FX actions. These must not be confused with the longer
// labels used by the official activity-statement shape.
const ibkrShortChineseText = [
  '日期,操作,代码,数量,价格,手续费,金额,币种,说明',
  '2026-02-01,存款,,1,1,0,1000,USD,合成存款',
  '2026-02-02,买,VGT,2,100,0,-200,USD,合成买入',
  '2026-02-03,卖,VGT,1,110,0,110,USD,合成卖出',
  '2026-02-04,外汇交易组成部分,,1,1,0,-100,USD,合成换汇组成部分',
].join('\n');
const ibkrShortChinesePreview = ibkrImportAdapter.audit({ text: ibkrShortChineseText, fileName: 'localized-transaction-history.csv' });
assert.equal(ibkrShortChinesePreview.errors.length, 0);
assert.equal(ibkrShortChinesePreview.status_counts.block, 0, 'localized short actions should parse');
assert.equal(ibkrShortChinesePreview.trades.filter((row) => row.side === 'buy').length, 1);
assert.equal(ibkrShortChinesePreview.trades.filter((row) => row.side === 'sell').length, 1);
assert.ok(ibkrShortChinesePreview.cash_events.some((row) => row.event_type === 'broker_deposit'));
assert.ok(ibkrShortChinesePreview.cash_events.some((row) => row.event_type === 'fx_transfer'));

const ibkrHeaderDataPreview = ibkrImportAdapter.audit({ text: ibkrHeaderDataText, fileName: 'U00000000.TRANSACTIONS.YTD.csv' });
assert.equal(ibkrHeaderDataPreview.detection.supported, true);
assert.equal(ibkrHeaderDataPreview.format, 'ibkr-transaction-history-header-data');
assert.equal(ibkrHeaderDataPreview.detection.delimiter, ',');
assert.equal(ibkrHeaderDataPreview.status_counts.import, 6);
assert.equal(ibkrHeaderDataPreview.status_counts.block, 1, 'metadata-like rows with a date stay visible for review');
assert.equal(ibkrHeaderDataPreview.trades.find((row) => row.ticker === 'BHP.AX')?.source_currency, 'AUD');
assert.equal(ibkrHeaderDataPreview.trades.find((row) => row.ticker === 'BHP.AX')?.source_price, '35.000000000000');
assert.equal(ibkrHeaderDataPreview.trades.find((row) => row.ticker === 'BHP.AX')?.price, '22.750000000000');
assert.equal(ibkrHeaderDataPreview.trades.find((row) => row.ticker === 'BHP.AX')?.usd_amount, '-228.1500000000');
assert.equal(ibkrHeaderDataPreview.trades.find((row) => row.ticker === '700.HK')?.usd_amount, '25.5360000000');
assert.ok(ibkrHeaderDataPreview.cash_events.some((row) => row.source_currency === 'EUR' && row.usd_amount === '108.0000000000'));
assert.ok(ibkrHeaderDataPreview.cash_events.some((row) => row.event_type === 'fx_transfer' && row.usd_amount === '-108.0000000000'));

const ibkrBaseCurrencyText = [
  'Transaction History,Header,日期,账户,说明,交易类型,代码,数量,价格,Price Currency,总额,佣金,净额,子类型,汇率,交易费用,乘数',
  'Transaction History,Data,2026-01-02,U***33918,SMH sell,卖,SMH,-0.8105,550.65,USD,446.301825,-0.359773647,445.942051353,Trade,1.0,-,1',
  'Transaction History,Data,2026-01-03,U***33918,QQQM buy,买,QQQM,2,100,USD,-200,-4.9004E-5,-200.000049004,Trade,1,-,1',
  'Transaction History,Data,2026-01-04,U***33918,SIVE sell,卖,SIVE,-6,102.5,SEK,64.6734,-1.8520732403800002,62.82132675962,Trade,0.10516,-,1',
  'Transaction History,Data,2026-01-05,U***33918,FX component,外汇交易组成部分,-,-,-,CNH,-,-,-1.8014172E-4,Forex,0.14885,-,1',
  'Transaction History,Data,2026-01-06,U***33918,Deposit,存款,-,-,-,-,100,-,100,Cash,0.14887,-,1',
  'Transaction History,Data,2026-01-07,U***33918,FX Translations P&L,调整,-,-,-,-,0.4112441618782201,-,0.4112441618782201,Adjustment,1,-,1',
  'Transaction History,Data,2026-01-08,U***33918,Manual adjustment,调整,-,-,-,-,0.01,-,0.01,Adjustment,1,-,1',
].join('\n');
const ibkrBaseCurrencyPreview = ibkrImportAdapter.audit({ text: ibkrBaseCurrencyText, fileName: 'localized-base-currency.csv' });
assert.equal(ibkrBaseCurrencyPreview.detection.supported, true);
assert.equal(ibkrBaseCurrencyPreview.format, 'ibkr-transaction-history-header-data');
assert.ok(ibkrBaseCurrencyPreview.detection.warnings.some((warning) => warning.includes('Base Currency')));
assert.equal(ibkrBaseCurrencyPreview.status_counts.import, 5);
assert.equal(ibkrBaseCurrencyPreview.status_counts.ignore, 1, 'FX translation P&L is a non-cash valuation adjustment');
assert.equal(ibkrBaseCurrencyPreview.status_counts.block, 1);
const baseTickers = new Set(ibkrBaseCurrencyPreview.trades.map((row) => row.ticker));
assert.deepEqual(baseTickers, new Set(['SMH', 'QQQM', 'SIVE']));
const baseSiveTrade = ibkrBaseCurrencyPreview.trades.find((row) => row.ticker === 'SIVE');
assert.equal(baseSiveTrade?.source_currency, 'SEK');
assert.equal(baseSiveTrade?.source_price, '102.500000000000');
assert.equal(baseSiveTrade?.price, '10.778900000000');
assert.equal(baseSiveTrade?.usd_amount, '62.8213267596');
assert.equal(baseSiveTrade?.fees_usd, '1.8520732404');
const baseQqqmTrade = ibkrBaseCurrencyPreview.trades.find((row) => row.ticker === 'QQQM');
assert.equal(baseQqqmTrade?.fees_usd, '0.0000490040');
assert.equal(baseQqqmTrade?.usd_amount, '-200.0000490040');
assert.ok(ibkrBaseCurrencyPreview.cash_events.some((row) => row.event_type === 'fx_transfer' && row.source_currency === 'CNH'));
assert.ok(ibkrBaseCurrencyPreview.cash_events.some((row) => row.event_type === 'broker_deposit' && row.usd_amount === '100.0000000000'));
assert.equal(ibkrBaseCurrencyPreview.rows.find((row) => row.status === 'ignore')?.reason, 'IBKR FX Translations P&L 为非现金汇兑估值调整，不写入现金账本。');
assert.equal(ibkrBaseCurrencyPreview.cash_events.some((row) => row.source_description === 'FX Translations P&L'), false, 'ignored FX translation must not enter the cash ledger');
assert.equal(ibkrBaseCurrencyPreview.rows.find((row) => row.source_index === 8)?.reason, '操作类型无法映射', 'other Adjustment rows must remain blocked');
const officialIbkrShape = read('ibkr-activity-statement-official-en.csv');
const officialIbkrPreview = ibkrImportAdapter.audit({ text: officialIbkrShape, fileName: 'activity-statement-trades.csv' });
assert.equal(officialIbkrPreview.errors.length, 0, 'official IBKR Trades aliases should parse');
assert.equal(officialIbkrPreview.trades[0]?.usd_amount, '-200.3703703670', 'Proceeds plus commission becomes net settlement');
const officialIbkrChineseShape = read('ibkr-activity-statement-official-zh.csv');
const officialIbkrChinesePreview = ibkrImportAdapter.audit({ text: officialIbkrChineseShape, fileName: 'activity-statement-trades-zh.csv' });
assert.equal(officialIbkrChinesePreview.errors.length, 0, 'official Chinese IBKR aliases should parse');
assert.equal(officialIbkrChinesePreview.trades[0]?.usd_amount, '-200.3703703670');

const tradingViewPreview = tradingViewImportAdapter.audit({ text: tradingViewText, fileName: 'tradingview-portfolio.csv' });
assert.equal(tradingViewPreview.detection.supported, true);
assert.ok(tradingViewPreview.trades.some((row) => row.ticker === 'VGT'));
assert.ok(tradingViewPreview.cash_events.some((row) => row.event_type === 'broker_withdrawal'));
assert.ok(tradingViewPreview.cash_events.some((row) => row.source_action === 'Taxes and fees'));
assert.ok(tradingViewPreview.status_counts.block >= 1);
assert.ok(tradingViewPreview.warnings.some((warning) => warning.includes('没有独立 Amount')));
assert.equal(tradingViewPreview.trades.find((row) => row.ticker === 'VGT')?.usd_amount, '-200.3703703670');
assert.ok(tradingViewPreview.reconciliation.investor_outflows_usd.startsWith('100.'));
const tradingViewExport = tradingViewImportAdapter.export?.({
  trades: tradingViewPreview.trades,
  cash_events: tradingViewPreview.cash_events,
});
assert.match(tradingViewExport ?? '', /^Symbol,Side,Qty,Fill Price,Commission,Closing Time/);
assert.match(tradingViewExport ?? '', /Taxes and fees/);
assert.match(tradingViewExport ?? '', /Withdrawal/);
const tradingViewRoundTrip = tradingViewImportAdapter.audit({ text: tradingViewExport ?? '' });
assert.equal(tradingViewRoundTrip.errors.length, 0, 'TradingView export must re-import without blocked rows');
assert.equal(tradingViewRoundTrip.trades.length, tradingViewPreview.trades.length);
assert.equal(tradingViewRoundTrip.cash_events.length, tradingViewPreview.cash_events.length);

const duplicateKey = ibkrPreview.trades.find((row) => row.ticker === 'VGT')?.import_key;
assert.ok(duplicateKey);
const duplicatePreview = ibkrImportAdapter.audit(
  { text: ibkrEnglishText },
  { existing_import_keys: new Set([duplicateKey!]) },
);
assert.ok(duplicatePreview.status_counts.duplicate >= 1, 'existing source identity must become duplicate');

assert.equal(
  detectPortfolioImportAdapter({ text: tradingViewText })?.source,
  'tradingview',
  'six-column TradingView must win before the legacy Schwab-compatible parser',
);
assert.equal(detectPortfolioImportAdapter({ text: ibkrEnglishText })?.source, 'ibkr');
assert.equal(detectPortfolioImportAdapter({ text: schwabText })?.source, 'schwab');

// Inline row fixing: the fixture carries exactly one blocked TradingView row
// (a Withdrawal with a non-numeric amount) alongside 13 importable rows.
const fixablePreview = tradingViewImportAdapter.audit({ text: tradingViewText, fileName: 'tradingview-portfolio.csv' });
assert.equal(fixablePreview.status_counts.block, 1, 'fixture keeps exactly one blocked row');
const blockedRow = fixablePreview.rows.find((row) => row.status === 'block');
assert.ok(blockedRow, 'fixture must produce a blocked row');
assert.equal(blockedRow!.source_fields?.quantity, 'not-a-number', 'source_fields captures the raw offending value');
assert.equal(isRowFixable(tradingViewImportAdapter, blockedRow!), true, 'a parse-error TradingView row is fixable');
assert.equal(isRowFixable(schwabImportAdapter, blockedRow!), true, 'native Schwab rows are fixable through the adapter');

const edits = rowFieldEdits(blockedRow!);
assert.ok(edits.some((edit) => edit.field === 'quantity' && edit.original === 'not-a-number'), 'edit view exposes the original raw text');

const fixedPreview = rebuildPreviewAfterRowFix(
  tradingViewImportAdapter,
  fixablePreview,
  blockedRow!.source_index,
  { quantity: '-50' },
  { mode: 'append' },
);
assert.ok(fixedPreview, 'a valid correction produces a rebuilt preview');
assert.equal(fixedPreview!.status_counts.block, 0, 'the fixed row is no longer blocked');
assert.equal(fixedPreview!.status_counts.import, fixablePreview.status_counts.import + 1, 'the fixed row becomes importable');
assert.equal(fixedPreview!.rows.length, fixablePreview.rows.length, 'total row count is unchanged by a fix');
const fixedRow = fixedPreview!.rows.find((row) => row.source_index === blockedRow!.source_index);
assert.equal(fixedRow?.source_fields?.quantity, 'not-a-number', 'the original source text stays visible after a fix, never overwritten');
assert.equal((fixedRow?.item as { usd_amount?: string } | undefined)?.usd_amount, '-50.0000000000');

// A fix that reproduces another row's identity is refused, not silently
// merged: the row stays blocked with a reason naming the collision.
const collidingRow = fixablePreview.rows.find((row) => row.item && 'side' in row.item && row.item.ticker === 'VGT' && row.item.side === 'buy');
assert.ok(collidingRow?.item, 'fixture has a VGT buy row to collide with');
const collisionResult = applyRowFix(tradingViewImportAdapter, fixablePreview, blockedRow!.source_index, {
  symbol: 'NASDAQ:VGT',
  action: 'Buy',
  quantity: (collidingRow!.item as { shares: string }).shares,
  price: (collidingRow!.item as { price: string }).price,
  fees: (collidingRow!.item as { fees_usd: string }).fees_usd,
  date: '2026-01-02 09:01:00',
});
assert.equal(collisionResult?.collision_source_index, collidingRow!.source_index, 'a fix reproducing another row is flagged as a collision, not applied');
assert.equal(collisionResult?.row.default_status, 'block', 'a colliding fix stays blocked rather than reaching the RPC payload');
assert.equal(collisionResult?.row.source_fields?.quantity, 'not-a-number', 'the pristine source text survives even a refused fix');

// IBKR blocked rows are fixable too, and reparseRow must honor the same
// file-level gross-vs-net amount context a full parse used (carried on
// ImportDetection.context, since a single row can't re-derive it).
const badDateRow = ibkrPreview.rows.find((row) => row.status === 'block' && row.source_fields?.date === 'bad-date');
assert.ok(badDateRow, 'IBKR fixture has a malformed-date blocked row');
assert.equal(isRowFixable(ibkrImportAdapter, badDateRow!), true);
const ibkrFixed = rebuildPreviewAfterRowFix(
  ibkrImportAdapter,
  ibkrPreview,
  badDateRow!.source_index,
  { date: '2026-01-16' },
  { mode: 'append' },
);
assert.ok(ibkrFixed);
const ibkrFixedRow = ibkrFixed!.rows.find((row) => row.source_index === badDateRow!.source_index);
assert.equal(ibkrFixedRow?.status, 'import', 'a corrected date makes the IBKR row importable');
assert.equal(ibkrFixedRow?.source_fields?.date, 'bad-date', 'the original malformed date stays visible after the fix');
assert.equal((ibkrFixedRow?.item as { effective_date?: string } | undefined)?.effective_date, '2026-01-16');

// Native Schwab eight-column rows capture raw fields and support the same
// inline correction path as the other V2 adapters.
const schwabBlockedRow = schwabPreview.rows.find((row) => row.status === 'block');
assert.ok(schwabBlockedRow, 'Schwab fixture has a blocked row');
assert.equal(schwabBlockedRow!.source_fields?.date, 'bad-date', 'source_fields captures the raw offending value');
assert.equal(isRowFixable(schwabImportAdapter, schwabBlockedRow!), true, 'native Schwab rows support inline fixing');
const schwabFixed = rebuildPreviewAfterRowFix(
  schwabImportAdapter,
  schwabPreview,
  schwabBlockedRow!.source_index,
  { date: '2026-01-16' },
  { mode: 'append' },
);
assert.ok(schwabFixed);
assert.equal(schwabFixed!.status_counts.block, 0, 'a corrected Schwab date makes the row importable');
assert.equal(schwabFixed!.status_counts.import, schwabPreview.status_counts.import + 1);
const schwabFixedRow = schwabFixed!.rows.find((row) => row.source_index === schwabBlockedRow!.source_index);
assert.equal(schwabFixedRow?.source_fields?.date, 'bad-date', 'the original malformed date stays visible after the fix');
assert.equal((schwabFixedRow?.item as { effective_date?: string } | undefined)?.effective_date, '2026-01-16');

console.log('portfolio import adapter checks passed');
