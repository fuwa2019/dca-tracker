# Schwab Transaction Import and Export

## Scope

- Add browser-only parsing for Schwab transaction CSV/TSV exports.
- Classify every standard `Buy`/`Sell` symbol and import confirmed ETFs only.
- Exclude individual-stock trades, preserve recognized positive deposits, and
  record net stock funding as a negative allocation on the stock trade date.
  Stock sale proceeds fund later stock buys before another allocation is required.
- Parse positive recognized Schwab deposits and six-column Portfolio CSV
  `Deposit` rows. Continue to ignore withdrawals, dividends, taxes, and other
  unsupported cash events.
- Also accept the six-column `Symbol,Side,Qty,Fill Price,Commission,Closing
  Time` portfolio CSV format; adapt its `Buy`/`Sell` rows and `Deposit` cash
  rows to the existing transaction and broker-deposit contracts.
- Preserve up to 10 decimal places for quantity and commission and up to 12
  decimal places for fill price, matching the portfolio CSV producer's full
  supported output rather than rounding imported trades.
- Support append-only import and atomic full portfolio-input reset/import.
- Export stored ETF trades, original deposits, and dated stock allocations in
  the same eight-column Schwab format.
- Preserve application metadata for matching transactions only in append mode.
- Treat Schwab's signed `Amount` as authoritative for private cash, cost, and
  proceeds; retain quantity-times-price plus/minus fees as the fallback.

## Database Contract

- Existing migrations: `0043_schwab_transaction_import.sql` through
  `0046_adjusted_deposit_precision.sql`. New migration
  `0047_schwab_settled_cash_and_stock_allocations.sql` adds signed transaction
  settlement cash, dated stock allocations, and the compatible import wrapper.
- Add transaction fee, source description, import source, and import key fields.
- The client sends original positive broker deposits and negative dated stock
  allocations through the existing authenticated RPC cashflow array.
- Enforce per-user import-key uniqueness.
- Keep the browser and database import-key formats on the same 10/12/10
  quantity/price/fee precision so distinct fills do not collide.
- Expose an authenticated, security-invoker import RPC.
- Derive ownership from `auth.uid()` and rely on transaction RLS.
- Full reset removes every transaction, cashflow, and funding batch owned by
  the current user, then rebuilds confirmed ETF trades, original deposits, and
  dated stock allocations.
- Files containing individual stocks or deposits cannot use append mode because
  append cannot remove existing stocks or replace the account cash basis.
- Broker cash is deposits plus stock allocations plus signed ETF settlement
  amounts. Trade-only files without deposits keep the zero-cash and
  inferred-funding fallback.
- Stock funding that exceeds deposits available by its trade date
  blocks import. A temporary negative ETF cash timeline is shown as a warning,
  not an error, because ignored dividends, interest, or other non-Deposit events
  can legitimately explain the gap.
- Settings, share links, quotes, daily prices, caches owned by system workflows,
  and other users' rows remain outside the reset scope.
- Keep all public-share responses unchanged.

## Safety

- Do not read or commit real brokerage exports.
- Use synthetic fixtures in tests.
- Do not apply the migration or deploy without separate authorization.
- Full reset intentionally deletes all transactions, manual cashflows, imported
  cash events, and funding batches before rebuilding ETF trades and cash.
- The confirmation must state how many ETF trades, deposits, and stock
  allocations will be rebuilt and that individual-stock trades will not be imported.
- Any validation, oversell, or write failure must roll back the full import.
- Do not invent balancing deposits to silence a temporary cash warning.

## Verification

- Schwab/Portfolio parsing, symbol classification, ETF-only selection, settled
  cash ledger, dated allocation, strict reset, and round-trip export tests.
- Synthetic high-precision portfolio rows, precision boundaries, and import-key
  collision regression tests.
- Fee-aware finance fixtures.
- Migration numbering and static database contract checks.
- UI behavior checks, typecheck, and production build.
- Default finance, reminder, and quote-status checks.

## Deployment

- Migration `0043` was applied to production project
  `igwacbeojogblacektxr` in one transaction on 2026-07-28.
- Post-migration checks confirmed the new fields, uniqueness constraints,
  security-invoker RPC, authenticated-only execution, and zero Advisor errors.
- Feature commit `1400798` is on `master`. During rollout, production was first
  restored to verified deployment `09ee772b`, then rebuilt through the Pages
  Git integration after confirming the required production variable names.
- Production deployment `466c30fc-9ba5-464b-9145-794a322f3b98` completed
  successfully from `1400798`. The canonical site serves the new bundle
  without the missing-Supabase-config warning; `/login` and `/transactions`
  both return HTTP 200.
- A direct upload or Git build without the required public `VITE_*` variables
  is not a valid production release even when its routes return HTTP 200.
- No real Schwab export was read or imported during deployment.
- Migration `0044_full_reset_schwab_import.sql` was applied to production as
  version `20260728103203`. Metadata checks confirmed the security-invoker
  wrapper/helper contract and authenticated-only execution.
- Full-reset commit `a459e9f` is on `master`. Production deployment
  `03cc20da-8558-4ead-a8b8-5f31a80c738c` serves `index-C86Or5YJ.js` from the
  canonical site with `reset_all`, the full-reset UI, and the required
  Supabase build configuration.
- Zero-cash commit `7780f68` is on `master`. Production deployment
  `c81a5b11-46d5-4180-a16f-cc6725e35ca6` serves `index-Dsy3wFOu.js` with
  all-security Buy/Sell import, ignored transfer rows, and broker cash fixed at
  zero. No database migration or production database change was required.
- Migration `0045_transaction_numeric_precision.sql` was applied to production
  project `igwacbeojogblacektxr` as version `20260804144149`. Because the
  existing `UPDATE OF` import-identity trigger depended on the affected
  columns, the migration drops and recreates that trigger around the numeric
  type changes. Structural checks confirmed `numeric(18,10)`, `numeric(22,12)`,
  and `numeric(22,10)` storage, widened helper validation/import keys, and
  authenticated-only security-invoker execution.
- Commit `cdeba76` contains the matching target-projection and precision-aware
  frontend changes. Cloudflare Pages deployment
  `a11de78f-534a-4bf6-884e-06d88b500fbc` completed from that commit. The
  canonical site and fresh browser checks serve the production-configured
  bundle without the missing-Supabase-config warning.
- Migration `0046_adjusted_deposit_precision.sql` was applied to production
  project `igwacbeojogblacektxr` as version `20260804162313`; structural checks
  confirmed `cashflows.usd_amount numeric(22,10)`, the rebuilt trigger, and
  authenticated-only security-invoker helper execution.
- Commit `48b93cf` contains the ETF-only adjusted-cash frontend and is pushed to
  `master`; the follow-up documentation commit `959a5ce` is also pushed. The
  Git-triggered Pages production deployments serve the canonical bundle, whose
  fresh browser verification confirmed the login page, route guard, and
  adjusted-cash import markers.
- No real Schwab export was read or imported during migration or deployment.

## Local Root-Cause Fix (2026-08-05)

- Migration `0047_schwab_settled_cash_and_stock_allocations.sql` and the matching
  frontend are implemented locally but have not been applied, committed,
  pushed, or deployed.
- Synthetic regression coverage proves that a `$922.75` deposit against source
  trade `Amount` totaling `-$922.75` has `$0.00` minimum and ending cash even
  when quantity times price differs by `$0.0002015`.
- A separate dated-allocation fixture proves a June 17 stock purchase cannot
  move its cash effect back to June 5.
