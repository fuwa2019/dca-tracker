# Performance and Privacy Architecture

## Sources and Metrics

Transactions and adjusted daily prices are the source of truth for trading
performance. Cashflows remain the source of truth for account NAV and XIRR.

- NAV: holdings market value plus uninvested cash.
- XIRR: money-weighted account return.
- Chart performance: daily-linked TWR with Modified-Dietz sub-periods and
  inferred trade-funding flows.
- Benchmark: selected benchmark adjusted close as a total-return proxy.

The detailed calculation contract is in `docs/PERFORMANCE_SPEC.md`.

## Shared Cache Contract

Authenticated dashboard and public share views read the same cumulative-return
series from `performance_history_cache`. The cache stores only public-safe
dates, labels, warnings, and return percentages. It does not store public NAV,
cashflows, or trade detail.

Refresh entry points are intentionally limited:

- authenticated read and refresh RPCs;
- share-owner refresh;
- cache-only public share read;
- service-role batch refresh from the quote Worker.

Do not add a public recomputation path. Anonymous recomputation increases cost
and can disclose private portfolio structure through intermediate data.

## Dirty and Backfill Flow

Writes to transaction or price inputs mark affected cache state dirty. The
dashboard may show a stale cached curve while an authenticated refresh runs.

For explicit price backfill:

1. Fetch history with synchronous persistence.
2. Wait for `daily_prices` upsert completion.
3. Refresh the performance cache.
4. Invalidate and refetch price coverage, cache status, and portfolio history.

## Public Share Boundary

The public share RPCs may expose:

- holding labels and percentage weights;
- cash weight percentage;
- dates;
- portfolio and benchmark return percentages;
- public-safe warning/state labels.

They must not expose:

- absolute USD or CNY values;
- deposits, withdrawals, funding batches, or transaction detail;
- exchange loss;
- private account, contact, or authentication fields;
- intermediate values that allow amounts to be reconstructed.

Every new share field must be traced to a public-safe database/RPC value and
covered by privacy-focused review.
