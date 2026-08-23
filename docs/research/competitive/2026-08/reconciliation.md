# Calculation Reconciliation Contract

The same canonical ledger under `fixtures/canonical-ledger.json` is the
reference input for all products. The expected values below are independent of
any product's display rounding.

## Canonical Semantics

- Base currency: USD.
- A broker-supplied settled amount is the cash authority for that trade.
- `dividend`, `interest`, `tax`, and `fee` are explicit cash events.
- A dividend reinvestment has both a dividend cash event and a buy activity;
  the two same-day events must not create or destroy cash.
- Deposits and withdrawals are investor cash flows for XIRR/IRR.
- Dividend, interest, tax, fee, buy, and sell activity remains internal to the
  portfolio for portfolio-level TWR/TTWROR, unless the product explicitly
  documents a different security-level view.
- Same-day order must be stable and visible in the audit trail.

## Expected Ledger Values

| Value | Expected |
|---|---:|
| VGT shares at end | `1.5123456789` |
| SMH shares at end | `1.0000000000` |
| Ending cash | `554.6562962998` USD |
| Investor deposits | `1000.0000000001` USD |
| Investor withdrawals | `-100.0000000000` USD |
| Explicit dividend | `1.2500000000` USD |
| Explicit interest | `0.0700000000` USD |
| Explicit tax | `-0.1300000000` USD |
| Independent fee event | `-0.0700000000` USD |

The ending cash is calculated from the signed source settlement amounts, not
from a rounded quantity-times-price reconstruction. The fixture intentionally
includes a sub-cent precision difference and an independent fee event.

## Performance Checks

For each product export the daily valuation or the closest available report.
Recompute independently with:

- investor cash flows only for XIRR/IRR;
- daily start-of-day inflows and end-of-day outflows for portfolio TTWROR;
- dividends and sale proceeds retained inside the portfolio;
- ordinary close prices from the frozen price fixture, not adjusted close plus
  an additional dividend adjustment;
- identical date and timezone rules for all products.

The acceptance tolerance is one basis point for XIRR and TTWROR after matching
the product's documented annualization convention. If a product cannot export
enough information to reproduce the calculation, record `not reproducible`
rather than treating the displayed percentage as verified.

`npm run test:finance` includes two Portfolio Performance gates.

The first is an independent daily-flow formula reference against the canonical
ledger — an S3 mathematical gate aligned with the documented formula.

The second, added 2026-08-23, is the **application** gate. Portfolio Performance
0.86.0's own saved state was decoded from the `PPPBV1` protobuf container of the
synthetic `.portfolio` files, giving its stored integers rather than a reading
of its screen: money in cents, shares in 1e-8 units. Those integers are pinned
in `fixtures/portfolio-performance-stored-ledger.json`. Feeding them to the
shipped `computeLedgerTwr` and `computeXirr` reproduces all three figures the
application displayed in T07:

| Figure | Application | Our engine on its stored ledger |
|---|---:|---:|
| Portfolio value | `$921.53` | `921.5322` → `$921.53` |
| TTWROR | `2.15%` | `2.1532%` → `2.15%` |
| IRR | `3.83%` | `3.8324%` → `3.83%` |

Two behaviours had to be read correctly for this to close, and both are now
recorded rather than inferred:

- **Valuation without a quote provider.** The application values a security at
  the gross price of its most recent transaction — net plus fees for a sale,
  net minus fees for a purchase, over the stored share count. The canonical
  sale of `0.5` VGT settles at `5516` cents with a `1` cent fee, so VGT is
  carried at `110.34`, not at the frozen `111.00` close.
- **Report period end.** The period runs from the first transaction to the run
  date (2026-08-18), not to the last ledger date. Prices do not move after
  2026-01-15, so TTWROR is unaffected, but the IRR annualization window is 228
  days rather than 13. Annualizing over 13 days would have shown `81.86%`; the
  displayed `3.83%` is what the longer window gives.

The remaining difference between this run and our own `2.5527%` is therefore
entirely the price input — `0.3994` percentage points, all of it explained by
the missing quote history and the application's cents rounding — and not a
disagreement about the formula. The B1 target is met by reconciling against the
application's stored state, which is a stronger source than the CSV export that
was originally planned for it.

Not reconciled: the same report's maximum drawdown (`0.02%`) and volatility
(`1.81%`). They are outside the B1 target and are recorded as observations
only.

TradingView's six-column format has no independent `Amount` field. Its trade
cash is therefore a documented quantity-times-price-plus/minus-commission
fallback, and the preview must expose that basis instead of presenting it as a
broker-settled value.
