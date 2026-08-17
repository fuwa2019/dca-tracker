# Current Handoff

Updated: 2026-08-18

## Current Goal

Keep ETF look-through exposure current from official full-constituent files,
with authenticated manual refresh, weekly refresh, and static fallback. The
database, Quote Worker, and Pages changes are now live.

## Current Status

- SMH refresh compatibility is fixed locally but not deployed. The Quote Worker
  now reads VanEck's page-backed `HoldingsBlock/GetDataset` JSON endpoint instead
  of the marketing HTML page, sends the endpoint's expected request context,
  and accepts percentage strings plus US-formatted JSON as-of dates. A stable
  public-data fixture covers the current 25 equity constituents and excludes
  cash rows. `test:etf-holdings`, `test:quote-status`, and `typecheck` pass.
- Current read-only probing reproduced VanEck resetting direct local connections
  to both the marketing page and XLSX endpoint. The official page and JSON
  dataset were independently reachable through the web retrieval path. No
  deployment or authenticated/private portfolio access was performed, so the
  new endpoint still requires verification from the deployed Worker after a
  separately authorized release.
- Repository: `/Users/junxihuo/Documents/dca_system`, branch `master` tracking
  `origin/master`.
- Append-only migrations `0048_etf_holdings_refresh.sql` and
  `0049_restrict_etf_holding_table_privileges.sql` are applied to production.
  The latter removes inherited `REFERENCES/TRIGGER` grants so `anon` and
  `authenticated` have only `SELECT` on both ETF snapshot tables.
- Quote Worker version `23f51a7b-cc60-416d-9c3d-a95fe4a34671` is deployed with
  authenticated `POST /api/etf-holdings/refresh` and weekly Sunday refresh.
  UTC 04:10 and 05:10 daily runs use one equivalent comma-list Cron expression
  to stay within the account's five-trigger limit without dropping a run.
- Git-backed Pages deployment `e175d135-addb-4b93-b5c4-de407b1b58a1` is live
  from `b31d3e9`. The canonical bundle `index-BE4-C0D2.js` contains the Pages
  Supabase configuration and refresh UI, without the localhost stub.
- The preceding direct upload `b4191fc1` was built locally without public
  `VITE_` variables and briefly broke login with `Failed to fetch`. The Git
  deployment replaced it; production login now renders without the missing
  Supabase configuration warning. Do not direct-upload an unconfigured local
  `dist/`; follow `docs/runbooks/deployment.md`.
- Root-cause fix commit `395400e` is pushed to `origin/master` and deployed.
- Schwab transaction `Amount` is parsed as before and now persists in nullable
  `transactions.settled_amount_usd`. Private cash, cost basis, realized proceeds,
  TWR cache generation, and sanitized share percentages prefer that settled
  value. Manual and six-column Portfolio CSV trades retain the existing
  quantity-times-price plus/minus fees fallback.
- Recognized Deposit rows keep their original amount and date. Excluded-stock
  net funding is represented by a negative `stock_allocation` cashflow on the
  actual stock trade date. Account cash, invested capital, XIRR, export, and
  re-import all understand that event.
- New append-only migration
  `0047_schwab_settled_cash_and_stock_allocations.sql` adds the column and
  constraint, extends the existing owner-protected `cashflows` table, and
  replaces the four-argument import RPC without changing its signature. The RPC
  remains security-invoker, derives ownership from `auth.uid()`, and grants
  execution only to `authenticated`.
- Migration `0047` was applied to production project `igwacbeojogblacektxr` as
  version `20260805023032`. Structural checks confirmed
  `transactions.settled_amount_usd numeric(22,10)`, the dated
  `stock_allocation` cashflow constraint, and the updated owner-protected RPC.
- Old clients that send `deposit_date` remain accepted. New stock allocations
  require `reset_all`; append and legacy `reset_etf` remain available for
  rolling-deploy compatibility.
- The import preview now reports original deposits, dated stock allocations,
  net ETF funding, ending cash, and real incomplete-cash warnings. Export writes
  `Stock Allocation` extension rows so the application backup round-trips.
- Synthetic regression coverage fixes the former `-$0.0002015` false warning:
  a `$922.75` deposit and source trade `Amount` totaling `-$922.75` now produce
  `$0.00` minimum and ending cash despite a `$922.7502015` recomputed notional.
- A separate timing fixture proves a June 17 stock allocation is not moved back
  to June 5; any unresolved `-$99.93` cash gap appears on June 17.
- Final local verification passed: `test:csv-import`, `test:finance`, `test:ui`,
  `test:migration-numbering`, `test:email-reminder`, `test:quote-status`,
  `typecheck`, `build`, and `git diff --check`.
- Playwright local-mode checks passed at desktop and 390px mobile widths. The
  six metrics, original deposit, dated allocation, and second reset-confirmation
  counts rendered without overlap; the final import action was not executed.
- The user-provided real CSV was not read, copied, or imported.

## Production State

- Production contains migrations through
  `0049_restrict_etf_holding_table_privileges.sql`.
- Quote Worker version `23f51a7b-cc60-416d-9c3d-a95fe4a34671` serves health 200,
  valid refresh-route CORS preflight 200, and unauthenticated refresh 401.
- Cloudflare Pages deployment `e175d135-addb-4b93-b5c4-de407b1b58a1` is live;
  the canonical bundle is `index-BE4-C0D2.js` and has configured Supabase Auth.
- No real CSV, financial import, authenticated holdings, or user data was read
  or changed during deployment verification.

## Next Steps

1. After an explicitly authorized Quote Worker deployment, verify SMH refresh
   reaches the VanEck JSON dataset from the Worker runtime.
2. Verify the authenticated `POST /api/etf-holdings/refresh` with a synthetic
   account, including partial provider failure, final-holder deletion, and
   re-buy refresh. Vanguard and Invesco live read-only probes passed locally.
3. Let the user review the real-file Schwab preview separately. Leave the
   actual `reset_all` import to explicit confirmation.

## Risks and Boundaries

- Full reset deletes all current-user transactions, cashflows, and funding
  batches before rebuilding ETF trades and imported cash events. Any validation
  or write error must roll back the whole RPC transaction.
- Dividends, interest, withdrawals, taxes, and unsupported cash events remain
  omitted. They can still cause a genuine dated cash warning; no balancing
  deposit is invented.
- Public share responses remain percentage-only. The new absolute settled and
  allocation amounts stay behind existing owner RLS and are not added to public
  JSON contracts.
- Migration `0047` dynamically patches the currently deployed performance and
  share functions and should be applied transactionally before the frontend.

## Related Files

- `PROJECT.md`
- `docs/PERFORMANCE_SPEC.md`
- `docs/tasks/schwab-etf-transaction-import-export.md`
- `src/lib/schwabTransactions.ts`
- `src/lib/calc/transactionAmounts.ts`
- `src/components/SchwabTransactionTools.tsx`
- `supabase/migrations/0047_schwab_settled_cash_and_stock_allocations.sql`
- `supabase/migrations/0048_etf_holdings_refresh.sql`
- `supabase/migrations/0049_restrict_etf_holding_table_privileges.sql`
- `workers/quote/src/etfHoldings.ts`
- `src/hooks/useEtfHoldings.ts`
