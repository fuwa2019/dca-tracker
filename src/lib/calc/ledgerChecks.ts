/**
 * Accounting checks over the unified ledger. Pure: the Data Health page and
 * the "数据未对账" markers both render the same list.
 *
 * `blocking` checks guard the displayed numbers: when one fails, overview and
 * performance figures are marked unreconciled instead of being shown silently.
 */
import {
  ledgerCashBalance,
  tradeShareBalances,
  type Ledger,
  type LedgerSeries,
  type LedgerSummary,
} from './portfolioLedger.ts';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'unavailable';

export interface LedgerCheck {
  id:
    | 'cash_reconciliation'
    | 'statement_cash'
    | 'position_reconciliation'
    | 'funding_before_buy'
    | 'flow_basis'
    | 'price_coverage'
    | 'return_consistency'
    | 'share_cache';
  label: string;
  status: CheckStatus;
  blocking: boolean;
  message: string;
  /** Signed difference in USD or shares, when the check compares numbers. */
  difference?: number;
}

export interface StatementCash {
  /** Account or source label, for example "IBKR". */
  label: string;
  asOf: string;
  statementCashUsd: number;
  /** Ledger cash for the same account up to `asOf`. */
  ledgerCashUsd: number;
}

export interface LedgerCheckInput {
  ledger: Ledger;
  series: LedgerSeries;
  summary: LedgerSummary;
  /** Cash as shown on the overview; must equal the ledger's cash. */
  displayedCashUsd?: number | null;
  /** Current shares as shown by the holdings view (average-cost aggregation). */
  displayedShares?: ReadonlyMap<string, number>;
  statementCash?: readonly StatementCash[];
  /** Last cumulative return in the public share cache, as a fraction. */
  shareCacheReturn?: number | null;
}

export const CASH_TOLERANCE_USD = 0.01;
const SHARE_TOLERANCE = 1e-6;

export function runLedgerChecks(input: LedgerCheckInput): LedgerCheck[] {
  const { ledger, series, summary } = input;
  const checks: LedgerCheck[] = [];
  const hasRows = ledger.trades.length > 0 || ledger.cash.length > 0;

  // 1. Cash: opening cash (0) + every cash event + every trade = cash balance.
  const ledgerCash = ledgerCashBalance(ledger);
  const seriesCash = summary.cashUsd;
  const displayed = input.displayedCashUsd;
  const cashDiffs = [seriesCash - ledgerCash, displayed == null ? 0 : displayed - ledgerCash];
  const cashDiff = cashDiffs.reduce((worst, value) => (Math.abs(value) > Math.abs(worst) ? value : worst), 0);
  checks.push(
    !hasRows
      ? unavailable('cash_reconciliation', '现金对账', '还没有交易或现金事件。', true)
      : Math.abs(cashDiff) > CASH_TOLERANCE_USD
        ? {
            id: 'cash_reconciliation',
            label: '现金对账',
            status: 'fail',
            blocking: true,
            difference: cashDiff,
            message: `期初现金 + 现金事件 + 交易现金 = ${fmt(ledgerCash)}，但显示的现金余额相差 ${fmt(cashDiff)}。`,
          }
        : {
            id: 'cash_reconciliation',
            label: '现金对账',
            status: 'pass',
            blocking: true,
            difference: cashDiff,
            message: `期初 $0.00 + 现金事件 + 交易现金 = ${fmt(ledgerCash)}，与显示余额一致。`,
          },
  );

  // 2. Broker statement cash, when an import carried one.
  const statements = input.statementCash ?? [];
  if (statements.length === 0) {
    checks.push(unavailable('statement_cash', '券商对账单现金', '导入文件未提供期末现金；导入含现金汇总的 IBKR 报表后自动核对。', false));
  } else {
    const worst = statements
      .map((row) => ({ row, diff: row.ledgerCashUsd - row.statementCashUsd }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
    const ok = Math.abs(worst.diff) <= CASH_TOLERANCE_USD;
    checks.push({
      id: 'statement_cash',
      label: '券商对账单现金',
      status: ok ? 'pass' : 'fail',
      blocking: true,
      difference: worst.diff,
      message: ok
        ? statements.map((row) => `${row.label} ${row.asOf} 对账单 ${fmt(row.statementCashUsd)}，账本 ${fmt(row.ledgerCashUsd)}`).join('；')
        : `${worst.row.label} ${worst.row.asOf} 对账单现金 ${fmt(worst.row.statementCashUsd)}，账本 ${fmt(worst.row.ledgerCashUsd)}，差额 ${fmt(worst.diff)}。`,
    });
  }

  // 3. Positions: Σbuy − Σsell per ticker, never negative, equal to holdings.
  const { shares, oversells } = tradeShareBalances(ledger.trades);
  const mismatches: string[] = [];
  if (input.displayedShares) {
    const tickers = new Set([...shares.keys(), ...input.displayedShares.keys()]);
    for (const ticker of tickers) {
      const expected = shares.get(ticker) ?? 0;
      const shown = input.displayedShares.get(ticker) ?? 0;
      if (Math.abs(expected - shown) > SHARE_TOLERANCE) mismatches.push(`${ticker} 账本 ${expected} / 显示 ${shown}`);
    }
  }
  checks.push(
    ledger.trades.length === 0
      ? unavailable('position_reconciliation', '持仓对账', '还没有交易。', true)
      : oversells.length > 0 || mismatches.length > 0
        ? {
            id: 'position_reconciliation',
            label: '持仓对账',
            status: 'fail',
            blocking: true,
            message: [
              ...oversells.map((o) => `${o.ticker} 在 ${o.date} 卖出超过持有数量（余 ${o.shares}）`),
              ...mismatches,
            ].join('；'),
          }
        : {
            id: 'position_reconciliation',
            label: '持仓对账',
            status: 'pass',
            blocking: true,
            message: `${shares.size} 个标的：买入 − 卖出 = 当前股数，且从未超卖。`,
          },
  );

  // 4. Funding: a buy before the first deposit, or cash below zero.
  const firstBuy = ledger.trades.find((trade) => trade.side === 'buy')?.date ?? null;
  const firstInflow = ledger.cash.find((event) => event.role === 'external' && event.amountUsd > 0 && !event.inferred)?.date ?? null;
  const fundingIssues: string[] = [];
  if (firstBuy && ledger.flowBasis !== 'inferred_from_trades' && (!firstInflow || firstInflow > firstBuy)) {
    fundingIssues.push(`首笔买入 ${firstBuy} 之前没有入金记录`);
  }
  if (series.minCashUsd < -CASH_TOLERANCE_USD) {
    fundingIssues.push(`现金在 ${series.minCashDate} 最低为 ${fmt(series.minCashUsd)}`);
  }
  checks.push(
    fundingIssues.length > 0
      ? { id: 'funding_before_buy', label: '入金先于买入', status: 'warn', blocking: false, message: `${fundingIssues.join('；')}。可能缺少入金或导入不完整。` }
      : { id: 'funding_before_buy', label: '入金先于买入', status: firstBuy ? 'pass' : 'unavailable', blocking: false, message: firstBuy ? '每笔买入前都有足够现金。' : '还没有买入。' },
  );

  // 5. Where the external flows came from.
  checks.push(
    ledger.flowBasis === 'explicit'
      ? { id: 'flow_basis', label: '外部资金流', status: 'pass', blocking: false, message: `使用券商入金/出金记录：净投入 ${fmt(summary.netInvestedUsd)}。` }
      : ledger.flowBasis === 'legacy_fx_transfer'
        ? { id: 'flow_basis', label: '外部资金流', status: 'warn', blocking: false, message: '没有券商入金记录，暂以手工换汇到账作为入金。' }
        : { id: 'flow_basis', label: '外部资金流', status: hasRows ? 'warn' : 'unavailable', blocking: false, message: hasRows ? '没有任何入金记录，TWR 以“未被卖出款覆盖的买入”推断资金流。' : '还没有数据。' },
  );

  // 6. Prices behind the valuation.
  const priceWarnings = series.warnings.filter((w) => w.code === 'missing_price' || w.code === 'fx_trade_rate');
  checks.push(
    priceWarnings.length === 0
      ? { id: 'price_coverage', label: '估值价格', status: hasRows ? 'pass' : 'unavailable', blocking: false, message: '每个持仓日都有收盘价与汇率。' }
      : { id: 'price_coverage', label: '估值价格', status: 'warn', blocking: false, message: priceWarnings.map((w) => w.message).join(' ') },
  );

  // 7. Time-weighted vs money-weighted sanity.
  const simple = summary.totalReturnOnInvested;
  const twr = summary.twr;
  if (simple === null || twr === null) {
    checks.push(unavailable('return_consistency', '收益口径一致性', '数据不足，无法比较。', false));
  } else {
    const opposite = Math.sign(simple) !== Math.sign(twr) && Math.abs(simple) > 0.005 && Math.abs(twr) > 0.005;
    const far = Math.abs(simple - twr) > 0.25;
    checks.push(
      opposite || far
        ? {
            id: 'return_consistency',
            label: '收益口径一致性',
            status: 'warn',
            blocking: false,
            message: `TWR ${pct(twr)} 与 总收益/净投入 ${pct(simple)} ${opposite ? '符号相反' : '差距较大'}。收益口径可能不一致；若早期本金很小而后期大额入金，这是时间加权与金额加权的正常差异，请核对入金日期。`,
          }
        : { id: 'return_consistency', label: '收益口径一致性', status: 'pass', blocking: false, message: `TWR ${pct(twr)} 与 总收益/净投入 ${pct(simple)} 方向一致。` },
    );
  }

  // 8. Public share cache vs this engine.
  if (input.shareCacheReturn === undefined) {
    // Not requested by the caller.
  } else if (input.shareCacheReturn === null || twr === null) {
    checks.push(unavailable('share_cache', '分享页口径', '分享缓存尚未生成。', false));
  } else {
    const diff = input.shareCacheReturn - twr;
    checks.push({
      id: 'share_cache',
      label: '分享页口径',
      status: Math.abs(diff) <= 0.0005 ? 'pass' : 'warn',
      blocking: false,
      difference: diff,
      message: Math.abs(diff) <= 0.0005
        ? `分享页累计 ${pct(input.shareCacheReturn)}，与账本一致。`
        : `分享页累计 ${pct(input.shareCacheReturn)}，账本 ${pct(twr)}；分享缓存仍使用旧口径或尚未刷新。`,
    });
  }

  return checks;
}

export function hasBlockingFailure(checks: readonly LedgerCheck[]): boolean {
  return checks.some((check) => check.blocking && check.status === 'fail');
}

function unavailable(id: LedgerCheck['id'], label: string, message: string, blocking: boolean): LedgerCheck {
  return { id, label, status: 'unavailable', blocking, message };
}

function fmt(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function pct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}
