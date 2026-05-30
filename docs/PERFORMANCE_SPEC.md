# Performance Calculation Spec

This project uses an IBKR PortfolioAnalyst-style performance curve for the
dashboard and public share view. The UI is intentionally report-like; the
important contract is that the dashboard chart and share chart read the same
sanitized performance cache.

## Core Terms

- NAV on dashboard cards is current holdings market value plus uninvested cash.
- Cash is deposits minus buys plus sells.
- Cost basis defaults to average cost in product UI.
- Performance chart uses daily-linked TWR.
- Performance chart uses the trading-performance view: it starts on the first
  transaction date and ignores idle cash before the first trade.
- Performance chart points are emitted only on benchmark trading dates: the
  cache uses dates where SPY has an actual persisted adjusted/close price.
  Weekends, NYSE holidays, and other non-trading days are not shown as flat
  carry-forward points.
- XIRR is separate money-weighted performance and is not used for the chart.
- The default benchmark is SPY.
- Historical chart points use daily prices. The current dashboard cards use
  latest quote snapshots/live quotes where available.

## Performance Cache

`performance_history_cache` stores only public-safe curve fields:

- `date`
- `return_pct_user`
- `return_pct_spy`

It does not store absolute USD NAV, deposits, cashflows, trade notes, or
transaction detail. That keeps public share reads cheap and prevents leaking
amounts through share links.

`portfolio_history_cache` remains as a legacy compatibility mirror, but new
code should prefer:

- authenticated dashboard: `performance_history()`
- public share view: `shared_performance_history(token)`
- authenticated refresh: `refresh_performance_history_cache()`
- share-owner refresh/debug: `refresh_shared_history_cache(token)`

## Price Basis

`daily_prices.close` stores the ordinary daily close.

`daily_prices.adjusted_close` stores Yahoo adjusted close when available. The
performance curve uses an adjusted-close total-return proxy:

- buys and sells are converted into per-ticker performance units using the
  adjusted price around the trade date;
- each day values those units using the latest adjusted price available on or
  before that day;
- benchmark units are bought from inferred trade-funding flows using the same
  adjusted-price logic.

`daily_prices.trade_date` is always the US trading date in
`America/New_York`. `daily_prices.as_of_timestamp` records when the provider
observed the price. If the historical adjusted-close candle has not appeared
after the close, the quote Worker stores a quote-based row with
`is_provisional = true`. A later history sync replaces it with the final candle.
Public-safe cache points include `trading_date`, `as_of_timestamp`, and
`is_provisional` so the UI can label a provisional latest point without
exposing amounts.

The chart calendar is anchored to the benchmark (`SPY` by default). A trade
entered on a non-trading day is applied on the next SPY price date for
performance-series purposes. This keeps dashboard and share charts from
counting holidays or weekends as performance observations while preserving the
original transaction date in the transaction ledger.

Trade-funding flows are inferred from transactions, not deposit rows. Sell
proceeds fund later buys first; only the unfunded portion of a buy is treated
as a new external flow. This keeps the curve focused on trading performance and
prevents an early deposit with no trade from starting the SPY clock.

This is closer to total-return reporting for ETFs such as SPY/QQQ than raw
close-only curves. It is still a proxy, not a broker statement: true IBKR
results can differ when dividends, withholding tax, fees, FX, intraday fills,
corporate actions, or broker-specific rounding are involved.

## Cache Lifecycle

Dashboard reads cached performance first. If the cache is marked `dirty`, the
frontend shows the old curve and refreshes in the background.

Share views never recompute performance anonymously. They read the sanitized
cache only. If no cache exists, the share view returns an empty public history
state rather than running a long SQL calculation.

Source changes mark cache dirty:

- transactions insert/update/delete
- daily price insert/update/delete

The next authenticated refresh regenerates the cache.

The Data Health page exposes the operational checks used before trusting a
curve: input counts, price coverage, adjusted-close coverage, cache dirty
status, refresh errors, and share-link access audit fields.

Nightly price sync can call `refresh_due_performance_caches()` with the
service-role key to refresh dirty caches in bounded batches.

## Required Regression Fixtures

Use these cases when comparing against IBKR or changing SQL:

- single buy on one date
- transaction-only import with no cashflow rows
- monthly 60 USD QQQ DCA over 10 years
- deposit with no buy does not create a performance curve
- buy followed by partial/full sell
- sell proceeds reused for later buys without double-counting new capital
- missing daily price between two available closes
- public share token reading the same curve as the dashboard

`npm run test:finance` covers the smallest invariant fixtures for TWR and
Modified Dietz math. CI runs this fixture script, TypeScript checks, and the
production build on every push and pull request.
