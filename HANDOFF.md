# Current Handoff

Updated: 2026-08-18

## Current Goal

Execute the DCA Tracker competitive research and six-month optimization plan:
move from trusted source import and ledger semantics to financial calculation,
task-oriented interaction, and privacy-safe analysis without expanding beyond
one personal ETF portfolio.

## Goal Progress (2026-08-18)

- The pre-goal baseline commit is `e1bed4e`; it was clean and passed
  `test:finance`, `test:csv-import`, `test:ui`, `typecheck`, and `build` before
  this working-tree change set. The current tree contains the uncommitted goal
  work described below.
- `PRODUCT.md` and `DESIGN.md` define the precise, restrained, transparent
  product boundary and WCAG 2.2 AA baseline.
- Fixed-version research sources, task script, scorecard, reconciliation
  contract, screenshot index, decisions, backlog, and synthetic fixtures are
  under `docs/research/competitive/2026-08/`.
- `test:competitive-fixture` validates the canonical ledger with fixed-point
  arithmetic and prints fixture hashes.
- `src/lib/import/` now contains a database-free `PortfolioImportAdapter`
  contract and Schwab, IBKR, and TradingView adapters. The adapter regression
  command `test:portfolio-import` passes, including Chinese IBKR headers,
  non-USD blocking, duplicate keys, and six-column TradingView rows.
- Fixed-version research runs use only synthetic data. Ghostfolio `3.36.0`
  runs in Colima, Wealthfolio `v3.6.2` runs from its official DMG, and
  Portfolio Performance `0.86.0` now has a saved synthetic `.portfolio` file
  and XML export. No real brokerage file was read.
- The existing Schwab UI remains the write boundary; migration `0050` and its
  generic RPC are now applied and verified in production. The source-neutral
  preview remains behind `VITE_LEDGER_IMPORT_V2`; local mode exposes it safely,
  while the default cloud build keeps the legacy Schwab path until the deployed
  frontend smoke test is complete.
- The new preview has four row states, source detection, asset confirmation,
  append/source-replace/reset modes, and generic RPC payload construction. A
  synthetic TradingView run passed desktop and 390px Playwright checks with no
  console errors; no write was executed.
- TradingView now exports the normalized ledger back to the six-column format
  and round-trips the synthetic cash events without blocked rows. IBKR aliases
  now cover official Trades fields such as `Date/Time`, `Type`, `T. Price`,
  `Proceeds`, and `Total Comm/Tax`, with gross proceeds plus commission tested.
- `test:finance` now includes an independent PP-aligned daily-flow/XIRR
  reconciliation gate. The canonical fixture reports zero TWR difference and
  sub-basis-point XIRR difference against the independent reference. The fixed
  Portfolio Performance run separately verified the 11-entry ledger, cents
  rounding, cash balance, calculation breakdown, and XML export; exact quote-
  history TTWROR/XIRR reconciliation remains pending.
- The preview now computes fixed-point reconciliation totals for ending shares,
  cash by event kind, external inflows/outflows, and negative-cash warnings;
  asset-policy filtering is applied before those totals and before the RPC
  payload is built.
- The same ETF asset policy now applies to ticker-bearing cash events such as
  dividends, while pure cash events remain eligible without a ticker.
- Supabase production verification after `0050` confirms the migration record,
  all V2 cashflow columns and backfill (`7/7` existing rows have
  `effective_date`), the source/date index, constraints, three cashflow
  triggers, RLS on the affected tables, and authenticated-only execution for
  both ledger and compatibility import RPCs. The private PnL helper is owner
  checked; anonymous execution is denied. Public share function source returns
  only the existing sanitized percentage/series contract.
- Supabase branching was checked and intentionally not used. The Free
  organization has only `main`; a create attempt returned
  `PaymentRequiredException` because branching requires Pro or above. The
  user chose `main` as the cloud baseline. No production write occurred; the
  local PostgreSQL 15 cluster remains the isolated write/test boundary.
- Homebrew PostgreSQL `15.19` is installed. A separate local cluster is
  running at `127.0.0.1:55432` with database `dca_ledger_test` under
  `/private/tmp/dca-pg15-ledger.rwVrwh`; all 52 repository migrations through
  `0050` applied successfully. Two-user RLS, append idempotency,
  `replace_source` isolation, failed `reset_all` rollback, and private PnL cache
  invalidation passed locally; the same migration is now verified on Supabase
  `main`. This is not a Supabase development branch.
- Fixed-version competitive execution has started in
  `/private/tmp/dca-competitive-20260818`. Ghostfolio `3.36.0` runs in Colima
  with image digest
  `sha256:b53ebfe00de1510decbed4ca3310b3d6292d419bb906a7d749ec7e8bcc48cdce`.
  Ghostfolio's duplicate JSON import created a second account and eight extra
  orders; its public view hid absolute amounts but exposed manual UUIDs.
  Wealthfolio `v3.6.2` completed a synthetic 5-step import with 13 imported and
  1 skipped. Its repeat import, using the saved mapping template, returned 0
  imported, 13 duplicates, 14 skipped, 14 total and left the account at 13
  activities; a SQLite backup and CSV activity export are also in the temp
  fixtures directory. Portfolio Performance `0.86.0` completed a synthetic desktop run:
  four securities-account trades plus seven cash-account events, final cash
  `$554.66`, final value `$921.53`, TTWROR `2.15%`, IRR `3.83%`, and repeat
  import remained at 11 entries. Its `.portfolio` and XML exports are under
  the temporary fixture directory. A follow-up navigation check in Wealthfolio
  found no source-replacement control and no public-share route in the fixed
  build; these are recorded as not provided rather than inferred. A Ghostfolio
  authenticated synthetic Demo run captured `/zh/home`, `/zh/portfolio`,
  `/zh/portfolio/activities` and `/zh/account` at 390x844 with no horizontal
  overflow. The empty Demo state showed a restricted-action toast and no ledger
  rows. Its mobile menu exposed named routes, and ArrowRight + Enter cycled the
  five lower tab routes; header/menu traversal and reduced-motion emulation are
  recorded as supplemental limitations. Wealthfolio's Activities view now
  has direct forward/reverse Tab evidence, a visible focus ring and a
  keyboard-opened row menu; its fixed source contains 768px/1024px viewport
  breakpoints but no scoped reduced-motion rule. A real narrow native window
  was also captured at approximately 390 logical px (`490x960` Retina);
  Activities and Appearance layouts fit and their visible controls are
  keyboard-reachable. Portfolio Performance was resized to `392x700`; its
  fixed sidebar clipped the activity table instead of reflowing. Native runtime
  reduced-motion and unavailable focus surfaces are recorded as supplemental
  limitations; no macOS setting was changed.
  The macOS reduced-motion probe was restored to its original unset state;
  `NSReduceMotion=1` was not reflected by a fresh browser `matchMedia` result,
  and macOS rejected the universal-access domain write. No reduced-motion pass
  is claimed from that probe.

## Current Status

- SMH refresh compatibility is deployed in Quote Worker version
  `90d9eb62-0997-4a12-bb93-310fd6a1c6f1` from commit `bb09267`. The Worker now
  reads VanEck's page-backed `HoldingsBlock/GetDataset` JSON endpoint instead of
  the marketing HTML page, sends the endpoint's expected request context, and
  accepts percentage strings plus US-formatted JSON as-of dates. A stable
  public-data fixture covers the current 25 equity constituents and excludes
  cash rows. `test:etf-holdings`, the CI-equivalent tests, `typecheck`, `build`,
  and `git diff --check` pass.
- Current read-only probing reproduced VanEck resetting direct local connections
  to both the marketing page and XLSX endpoint. The official page and JSON
  dataset were independently reachable through the web retrieval path. The
  deployed Worker health endpoint returned 200, refresh CORS preflight returned
  200, and an unauthenticated refresh returned 401. No authenticated/private
  portfolio access was performed, so a real SMH refresh through the deployed
  Worker remains unverified.
- Repository: `/Users/junxihuo/Documents/dca_system`, branch `master` tracking
  `origin/master`.
- Append-only migrations `0048_etf_holdings_refresh.sql`,
  `0049_restrict_etf_holding_table_privileges.sql`, and
  `0050_portfolio_ledger_import.sql` are applied to production.
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
  `0050_portfolio_ledger_import.sql`; post-migration schema and permission
  checks passed.
- Quote Worker version `23f51a7b-cc60-416d-9c3d-a95fe4a34671` serves health 200,
  valid refresh-route CORS preflight 200, and unauthenticated refresh 401.
- Cloudflare Pages deployment `e175d135-addb-4b93-b5c4-de407b1b58a1` is live;
  the canonical bundle is `index-BE4-C0D2.js` and has configured Supabase Auth.
- No real CSV, financial import, authenticated holdings, or user data was read
  or changed during deployment verification.

## Next Steps

1. Treat any future reduced-motion emulation or native focus audit as
   supplemental research; the current study records its unavailable surfaces.
2. Keep `VITE_LEDGER_IMPORT_V2=0` during the first frontend release until the
   deployed legacy-path smoke test is complete; the old Schwab RPC remains the
   compatibility path.
3. The weighted scorecard adopts Wealthfolio as the main interaction
   reference and keeps Portfolio Performance as the calculation reference;
   do not treat this research decision as a production release authorization.
## Prior SMH Follow-up

1. Verify the authenticated `POST /api/etf-holdings/refresh` with a synthetic
   account, including partial provider failure, final-holder deletion, and
   re-buy refresh and SMH access to the VanEck JSON dataset from the deployed
   Worker runtime. Vanguard and Invesco live read-only probes passed locally.
2. Let the user review the real-file Schwab preview separately. Leave the
   actual `reset_all` import to explicit confirmation.

## Risks and Boundaries

- Full reset deletes all current-user transactions, cashflows, and funding
  batches before rebuilding ETF trades and imported cash events. Any validation
  or write error must roll back the whole RPC transaction.
- Dividends, interest, withdrawals, taxes, and unsupported cash events remain
  omitted from the existing Schwab write path. The new adapters and preview
  normalize them locally; migration `0050` is released, but the V2 cloud flag
  and ledger performance method remain separately gated.
- Public share responses remain percentage-only. The new absolute settled and
  allocation amounts stay behind existing owner RLS and are not added to public
  JSON contracts.
- Migration `0047` dynamically patches the currently deployed performance and
  share functions and should be applied transactionally before the frontend.
- Fixed-version Ghostfolio, Wealthfolio and Portfolio Performance assets are
  present only in the temporary research environment. Wealthfolio's desktop
  profile does not expose a custom data-root control in the tested flow; keep
  the profile synthetic and do not use it for personal data. Portfolio
  Performance has no configured historical quote provider in this run, so its
  benchmark and quote-history results are intentionally unscored.

## Related Files

- `PROJECT.md`
- `PRODUCT.md`
- `DESIGN.md`
- `docs/PERFORMANCE_SPEC.md`
- `docs/architecture/import-and-ledger.md`
- `docs/decisions/2026-08-18-ledger-import-release-gate.md`
- `docs/research/competitive/2026-08/`
- `docs/research/competitive/2026-08/requirements-audit.md`
- `docs/tasks/schwab-etf-transaction-import-export.md`
- `src/lib/schwabTransactions.ts`
- `src/lib/import/`
- `scripts/verify-portfolio-import-adapters.ts`
- `src/lib/calc/transactionAmounts.ts`
- `src/components/SchwabTransactionTools.tsx`
- `supabase/migrations/0047_schwab_settled_cash_and_stock_allocations.sql`
- `supabase/migrations/0048_etf_holdings_refresh.sql`
- `supabase/migrations/0049_restrict_etf_holding_table_privileges.sql`
- `workers/quote/src/etfHoldings.ts`
- `src/hooks/useEtfHoldings.ts`
