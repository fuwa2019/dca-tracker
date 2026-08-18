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

`npm run test:finance` now includes an independent daily-flow formula reference
against the canonical ledger. This is an S3 mathematical gate aligned with the
Portfolio Performance formula, not a claim that the fixed Portfolio Performance
application has already been run; the application export remains pending in
`observations.md`.

TradingView's six-column format has no independent `Amount` field. Its trade
cash is therefore a documented quantity-times-price-plus/minus-commission
fallback, and the preview must expose that basis instead of presenting it as a
broker-settled value.
