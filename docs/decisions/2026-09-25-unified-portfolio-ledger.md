# Unified portfolio ledger: one cash-flow series for every return

Date: 2026-09-25
Status: accepted

## Problem

Three engines produced the private figures, each with its own idea of which
money was external:

| Figure | Old source | External flows |
|---|---|---|
| Total return, cash, net invested | `usePortfolio` hooks | deposits + stock allocations only; dividends, tax, FX, withdrawals ignored |
| TWR, excess, share page | SQL V1 cache (`adjusted_proxy_v1`) | inferred from trades ("unfunded buy"), deposits ignored |
| XIRR | `buildXirrEvents` | deposits + allocations; withdrawals ignored |

On the owner's real IBKR ledger this produced TWR −73.74% next to a positive
total return. The curve fell from −0.24% to −58.37% on 2026-06-04, the day of
the first SIVE buy: V1 compared that day's NAV against the previous NAV of
$3.03 (a sliver of SGOV) while treating the $99.61 buy as a same-day flow, so
any gap between the fill and the valuation price was charged to the $3 base.
The NAV bridge read amounts from the percentage-only cache, found zeros
everywhere, and reported "恒等式校验通过".

## Decision

`src/lib/calc/portfolioLedger.ts` is the single engine:

- `buildLedger` normalizes transactions and cashflows into one dated ledger
  and classifies every cash row as external (deposit, withdrawal, stock
  allocation), internal (dividend, interest, tax, fee, FX conversion P&L) or
  excluded (manual CNY transfers once broker deposits exist).
- `buildLedgerSeries` values each benchmark trading day: external inflows
  count at the start of the day, outflows at the end, foreign positions at
  native close × USD rate (daily FX when supplied, otherwise the trade rate,
  flagged).
- `summarizeLedger` derives NAV, cash, net invested, total return, TWR, XIRR
  and benchmark excess from that series; `summarizeLedgerWindow` builds the
  NAV bridge and reports `unverifiable` instead of passing an empty window.
- `src/lib/calc/ledgerChecks.ts` reconciles cash (to the cent), positions,
  funding order, price coverage, return-sign consistency and the share cache.
  A failed blocking check marks figures "数据未对账".

The private pages compute in the browser from the owner's rows through
`useLedger`. The quote Worker imports the same module to write the
percentage-only `ledger_twr_v2` share cache, and the owner can refresh it on
demand (`POST /api/ledger-performance/refresh`). The old draft engine
(`ledgerTwr.ts`) and cache-reading NAV bridge (`navBridge.ts`) were removed.

The engine is gated in `npm run test:finance` by hand-checkable fixtures
(golden: +10% then −5% with a mid-period deposit → TWR +4.50%) and by
reproducing Portfolio Performance 0.86.0's displayed final value, TTWROR and
IRR from its own stored ledger.

## Consequences

- Dashboard and share now agree once the owner's `performance_method` is
  `ledger_twr_v2`; until then the health page flags the share cache as the
  old method (`share_cache` check). Switching is a production data change
  and needs explicit authorization.
- TWR can legitimately be negative while total return and XIRR are positive
  (small early capital, large later deposits). The consistency check warns
  but does not block, and the pages show both measures side by side.
- The SQL V1 engine stays for accounts that remain on `adjusted_proxy_v1`;
  it is no longer read by any private page.
