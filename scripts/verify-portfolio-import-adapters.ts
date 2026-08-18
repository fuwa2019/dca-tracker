import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectPortfolioImportAdapter, ibkrImportAdapter, schwabImportAdapter, tradingViewImportAdapter } from '../src/lib/import/index.ts';

const fixtureDir = 'docs/research/competitive/2026-08/fixtures';
const read = (name: string) => readFileSync(`${fixtureDir}/${name}`, 'utf8');

const schwabText = read('schwab-synthetic.tsv');
const ibkrEnglishText = read('ibkr-transaction-history-en.csv');
const ibkrChineseText = read('ibkr-transaction-history-zh.csv');
const tradingViewText = read('tradingview-portfolio.csv');

const schwabPreview = schwabImportAdapter.audit({ text: schwabText, fileName: 'schwab-synthetic.tsv' });
assert.equal(schwabPreview.detection.supported, true);
assert.ok(schwabPreview.trades.length >= 3);
assert.ok(schwabPreview.cash_events.length >= 1);
assert.ok(schwabPreview.status_counts.ignore >= 1);
assert.ok(schwabPreview.status_counts.block >= 1);
assert.ok(schwabPreview.warnings.some((warning) => warning.includes('source ordinal')));
assert.ok(schwabPreview.reconciliation.ending_shares.VGT);
assert.ok(schwabPreview.reconciliation.ending_cash_usd);
assert.equal(schwabPreview.trades.find((row) => row.ticker === 'VGT')?.usd_amount, '-200.3703703670');
assert.match(schwabImportAdapter.export?.({ trades: schwabPreview.trades, cash_events: schwabPreview.cash_events }) ?? '', /Date\tAction\tSymbol/);

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

console.log('portfolio import adapter checks passed');
