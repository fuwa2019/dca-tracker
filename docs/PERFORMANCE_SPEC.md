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
- benchmark cashflows buy benchmark units using the same adjusted-price logic.

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
- cashflows insert/update/delete
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
- deposit with no buy
- buy followed by partial/full sell
- weekend cashflow with next trading-day benchmark purchase
- missing daily price between two available closes
- public share token reading the same curve as the dashboard

`npm run test:finance` covers the smallest invariant fixtures for TWR and
Modified Dietz math. CI runs this fixture script, TypeScript checks, and the
production build on every push and pull request.
