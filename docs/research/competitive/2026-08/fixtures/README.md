# Synthetic Competitive Fixtures

These files are synthetic and contain no real account or brokerage data. They
are format-shaped inputs for the fixed-version competitive study and future
adapter tests. The canonical semantics live in `../reconciliation.md` and
`canonical-ledger.json`.

- `canonical-ledger.json`: normalized expected events and values;
- `ordinary-close-prices.json`: frozen ordinary-close prices for calculation
  reconciliation;
- `schwab-synthetic.tsv`: Schwab-shaped tab-delimited export;
- `ibkr-transaction-history-en.csv`: English IBKR-shaped export;
- `ibkr-transaction-history-zh.csv`: Chinese IBKR-shaped export;
- `ibkr-activity-statement-official-en.csv`: official Trades column shape;
- `ibkr-activity-statement-official-zh.csv`: Chinese official column shape;
- `tradingview-portfolio.csv`: six-column TradingView Portfolio Analyzer-shaped
  export with cash activities.
- `portfolio-performance-portfolio.csv`: Portfolio Performance `账目` target
  with synthetic ETF trades, fees, precision and account mappings;
- `portfolio-performance-account.csv`: Portfolio Performance `转账记录`
  target with deposits, dividend, interest, withdrawal, tax and fee events.
- `wealthfolio-incremental.csv`: one new VGT activity for the Wealthfolio T04
  append test.
- `portfolio-performance-stored-ledger.json`: what Portfolio Performance 0.86.0
  actually stored after importing the two CSVs above, decoded from the `PPPBV1`
  protobuf in its saved `.portfolio` files — money in cents, shares in 1e-8
  units, plus the T07 figures it displayed. This is an observation of the
  application, not another shaped input: `test:finance` replays it through the
  shipped engine and must reproduce the displayed value, TTWROR and IRR. Do not
  edit it to make a check pass; re-decode a saved file instead.

Do not replace these with a real broker export. Add a new synthetic fixture when
a provider-specific edge case is needed.

The Schwab-shaped file includes a synthetic `LITE` common-stock row. It is
intentionally absent from the canonical retained ETF ledger and must be
explicitly ignored or blocked by asset confirmation.
