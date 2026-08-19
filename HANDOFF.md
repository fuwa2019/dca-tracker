# Current Handoff

Updated: 2026-08-20

## Current Goal

Execute the DCA Tracker competitive research and six-month optimization plan:
move from trusted source import and ledger semantics to financial calculation,
task-oriented interaction, and privacy-safe analysis without expanding beyond
one personal ETF portfolio.

## Goal Progress (2026-08-19)

- The pre-goal baseline commit is `e1bed4e`; it was clean and passed
  `test:finance`, `test:csv-import`, `test:ui`, `typecheck`, and `build` before
  this working-tree change set. The workbench release is committed as
  `4d499d3` and pushed to `origin/master`.
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
- Migration `0050` and its generic RPC are applied and verified in production.
  The source-neutral preview is now the default cloud path after the frontend
  workbench release; setting `VITE_LEDGER_IMPORT_V2=0` remains an explicit
  compatibility rollback to the legacy Schwab path.
- The private shell now uses a task-oriented workbench: overview, performance,
  look-through exposure, ledger/import, data health, and settings share the same
  navigation and responsive state language. The old editorial dashboard is no
  longer rendered by the root route.
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
  user chose `main` as the cloud baseline. No production portfolio rows were
  written; the local PostgreSQL 15 cluster remains the isolated write/test
  boundary for write/RLS tests.
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

## Frontend Rectification Progress (2026-08-19)

- The rectification plan derived from the competitive-learning deck lives at
  `docs/tasks/2026-08-19-competitive-learning-rectification-plan.md`; the user
  authorized live computer-use study of the still-running Wealthfolio and
  Portfolio Performance instances (logged as S1b in
  `docs/research/competitive/2026-08/observations.md`) and assigned frontend
  implementation to Claude.
- First B4 slice is in the working tree, not yet committed:
  `src/lib/calc/navBridge.ts` (pure account-level NAV bridge over the cached
  series), `scripts/verify-nav-bridge.mjs` (appended to `test:finance`),
  `src/components/NavBridgeCard.tsx`, and the Performance-page wiring that
  renders 期初净值 + 外部净流入 + 期间盈亏 = 期末净值 for the selected chart
  range with an identity-gap check and an explicit note that non-imported
  dividend/interest events are excluded.
- Verified locally: `test:finance` (incl. the new bridge fixtures), `test:ui`,
  `test:email-reminder`, `test:quote-status`, `typecheck`, `build`,
  `git diff --check`, plus local-mode browser checks at desktop and 390px
  (3M sub-range anchoring confirmed: 112,660.66 + 600 + 34,892.30 =
  148,152.96). No database, worker, or share-contract change; the share page
  is untouched and remains percentage-only.
- The B4 slice above is committed as `e0d506e` on `master`.
- Second slice (ledger event-type chips), delivered by the scheduled cloud
  routine and merged to `master` as `435c1d0` via PR #1:
  `src/lib/ledgerEvents.ts` is a pure
  label/tone/direction map from a trade side or `cashflow_kind` to a chip.
  Buy, deposit, dividend and interest use the gain tone; sell, withdrawal, tax
  and fee use the loss tone; FX transfer and stock allocation stay outside that
  pair because they move existing money. An unrecognized kind renders a visible
  `未知事件` chip instead of being relabelled. `TxnList` and the cashflow ledger
  now render the shared chip through `StatusBadge`; the cashflow page shows the
  event kind plus a right-aligned tabular-nums USD amount for every kind,
  including the dividend/interest/tax/fee/withdrawal rows that previously fell
  through to the FX branch.
- Third slice (plan A2/A4), same PR: `src/lib/import/receipt.ts`
  derives `imported / duplicates / skipped / total` from the existing RPC
  receipt counts plus the preview's per-row statuses, with `skipped` containing
  `duplicates` to match the Wealthfolio 0/13/14/14 reading. No RPC argument or
  response field changed. The receipt keeps the original four ledger-record
  counts in a separate block, adds an event-type composition strip to the
  preview, and lists the retained blocked/ignored row reasons so nothing is
  silently corrected.
- Verified on the branch after `npm ci` (root plus both workers):
  `test:finance`, `test:ui`, `test:csv-import`, `test:portfolio-import`,
  `test:email-reminder`, `test:quote-status`, `typecheck`, `build`, and
  `git diff --check`. `test:ui` now runs `verify-ui-behavior.mjs` under
  `--experimental-strip-types` so it asserts the two new pure modules directly
  instead of only regex-matching component source. No database, worker, or
  share-contract change; `src/app/share.tsx` and `supabase/migrations/` are
  untouched and no dependency changed.
- The chip rows were visually confirmed before merge in local demo mode at
  desktop and 390px on the ledger and all-trades routes (no horizontal
  overflow, right-aligned amounts). The cashflow page redirects to
  /transactions in local mode, so its chip rendering is covered by assertions
  and typecheck only; a one-time read-only cloud view remains the suggested
  spot check.
- C2/C4 evidence for the ledger and import routes was collected on 2026-08-20
  with playwright-cli against the local demo server (synthetic data only):
  /transactions desktop forward-Tab traversal hits only interactive elements
  with a visible focus ring across all 24 stops (row buttons carry aria-labels
  such as `编辑 SGOV 交易`), Shift+Tab reverses symmetrically; the import
  dialog opens with Enter, traps focus, closes with Escape; with the synthetic
  TradingView fixture injected, mode buttons, asset selects, the focusable
  row-list scroll container, and all dialog controls are keyboard-reachable.
  At 390px, /transactions, /transactions/all, and the open import dialog with
  a 15-row preview show no page horizontal overflow; the only over-wide
  element is the intentionally hidden sr-only file input.
- C2 defect found and fixed: controlled dialogs without a `DialogTrigger`
  (import preview, row edit/delete, cashflow delete) dropped keyboard focus to
  `<body>` on close. `src/components/ui/dialog.tsx` now remembers the invoker
  in `onOpenAutoFocus` (before Radix moves focus) and restores it in
  `onCloseAutoFocus` unless a call-site handler prevented default; the
  `DialogTrigger` path (`手工录入`) was re-tested without regression, and
  `verify-ui-behavior.mjs` gained source assertions for the restore contract.
- Fourth slice (plan C1/C2/C3 plus a C4 addition), committed as `4b2b49a` on
  `master` via branch `a11y/reduced-motion-and-route-audit` (not pushed):
  reduced-motion degradation, the remaining keyboard evidence, and the
  full-route WCAG audit with its fixes.
  - C3: `src/lib/motionPrefs.ts` is the pure rule (`enterMotionProps`) and
    `src/hooks/useEnterMotion.ts` the hook over it. The CSS media block only
    reaches CSS transitions/keyframes, and framer's `reducedMotion="user"`
    still honours per-item `delay`, so lists kept popping in row by row. The
    entry now wraps the app in `MotionConfig reducedMotion="user"`, every
    staggered list/card/ring/gauge/share bar goes through `enter(...)`,
    `AnimatedNumber` snaps instead of counting, and the shared spark chart
    passes `isAnimationActive={!reduceMotion}`.
  - C2: overview / performance / exposure / health / settings and `/login`
    now have full forward and reverse Tab traces (14 / 22 / 18 / 11 / 24 / 2
    stops per cycle). Every stop is interactive and shows a focus ring, and
    Shift+Tab retraces the same order. The invalid `/share/:token` state has
    no focusable element at all — recorded as a product dead end, not a pass.
  - C1: `docs/accessibility/2026-08-20-wcag-route-audit.md` is the audit
    record; the four probe scripts live in `docs/accessibility/probes/` with a
    README (not in CI, no new repository dependency). axe-core 4.10.2 over
    nine routes x desktop/390px x light/dark went from ten violation classes
    (color-contrast 75 nodes, meta-viewport 36, aria-prohibited-attr 16,
    scrollable-region-focusable 2, and six best-practice rules) to zero.
    Fixes: viewport `maximum-scale` removed; new `--*-ink` tokens for the soft
    chips and a dark `--brand-foreground` (chart/series colors untouched);
    `role="img"` on the calendar trade-day dot; the history table wrapper is a
    focusable named region; aria-labels on the share-link copy/revoke buttons;
    `<main>` on login and the share fallback plus an `h1`; named sidebar,
    overview aside and mobile nav; `CardTitle` renders `h2`; `sr-only` label
    for the blank table corner; three sub-24px targets raised to the 2.5.8
    minimum.
  - C4 addition: page horizontal overflow is 0 on all nine routes at both
    390px and the 1.4.10 320px reflow width.
  - Not proved and recorded as such: screen-reader pass, 2.4.11 focus not
    obscured, and the cloud-only states (`/cashflows`, a populated share page,
    the authenticated login flow).
- Verified for this slice: `test:finance`, `test:ui`, `test:csv-import`,
  `test:portfolio-import`, `test:email-reminder`, `test:quote-status`,
  `test:competitive-fixture`, `typecheck`, `build`, `git diff --check`.
  `test:ui` gained a pure `enterMotionProps` unit assertion plus source
  assertions for every reduced-motion call site. No database, worker,
  share-contract or dependency change; `supabase/migrations/` untouched.
- Next frontend slices per the plan: the D1/D2 privacy-snapshot work for the
  V2 cache, then the E2 release gates (Lighthouse budget, cross-browser
  record). Accessibility follow-ups are the screen-reader pass, 2.4.11, and
  auditing the cloud-only routes when a cloud session is authorized.

## Session Notes (2026-08-20 handoff)

- Delivery flow used this window: slices are implemented either locally or by
  a one-shot cloud routine, verified with the CI-equivalent set plus local
  demo-mode browser checks, then merged to `master`. The cloud routine
  `trig_0147fA6nee6ULcCnZ7zmL8tE` is one-shot and now disabled; its GitHub
  integration is read-only (`git push` and API branch creation both returned
  403), so its work came back as a git patch that was applied and re-verified
  locally before PR #1. Granting `contents:write` to the Claude GitHub
  integration (claude.ai Settings → Connectors) would let future cloud runs
  push branches and open PRs themselves.
- C2/C4 keyboard and narrow-table evidence was collected with playwright-cli
  (`~/.claude/skills/playwright/scripts/playwright_cli.sh`) against
  `npm run dev:local` on port 5174; the method is repeatable and its results
  are recorded above and in the rectification plan's C2/C4 entries. No
  Playwright dependency was added to the repository.
- `competitive-learning-plan-2026-08-19.pptx` in the repo root is the meeting
  deck this rectification plan was derived from. It is untracked on purpose;
  decide whether to commit, relocate under `artifacts/`, or remove it.
- Accessibility evidence method (repeatable, documented in
  `docs/accessibility/probes/README.md`): `playwright-cli` `run-code` snippets
  against `npm run dev:local` on 5174. `/login` redirects to `/` in local mode,
  so it was audited on a second dev server (5175) started with stub Supabase
  credentials (`VITE_SUPABASE_URL=http://127.0.0.1:9`), which keeps the run
  offline — no real project was contacted. Both server entries live in the
  gitignored `.claude/launch.json`. axe-core is loaded from the dev server, so
  the run copies `axe.min.js` into `public/axe-audit-tmp.js` and deletes it
  afterwards; confirm `git status` is clean of it before committing.
- A `run-code` file must contain a bare `async (page) => { ... }` with no
  trailing semicolon: the CLI wraps it as `await (<file>)(page)`.
- The synthetic TradingView fixture surfaces 1 blocked row in the import
  preview (visible in the 阻止 counter). This is the preview honestly
  reporting fixture content, not a regression; adapter tests pass.
- No database, worker, share-contract, or dependency change is pending in the
  working tree after this session's commits. Production remains at migration
  `0050`; no deploy was performed from this session.

## Current Status

- SMH refresh compatibility is deployed in Quote Worker version
  `8d63a31a-2d64-4997-a039-a95dee51816e` from commit `7b981f5`. The primary
  SMH channel is now StockAnalysis' public HTML holdings page, which is
  reachable from the Worker and parses 25 equity rows. Its page date is checked
  against the verified 2026-08-18 official snapshot: an older response is not
  allowed to overwrite newer data. Network/edge failures or stale alternate
  data return the newer official snapshot with a `static-fallback` warning
  instead of reporting a partial refresh failure. Parser/schema and database
  write errors still fail. `test:etf-holdings`, the CI-equivalent tests,
  `typecheck`, Worker dry-run, `build`, and `git diff --check` pass.
- Current read-only probing reproduced VanEck resetting direct local connections
  to both the marketing page and XLSX endpoint. The official page and JSON
  dataset were independently reachable through the web retrieval path. The
  deployed Worker health endpoint returned 200, refresh CORS preflight returned
  200, and an unauthenticated refresh returned 401. No authenticated/private
  portfolio access was performed, so a real SMH refresh through the deployed
  Worker remains unverified.
- On 2026-08-19, the local static fallback `src/data/etf-holdings.json` was
  updated from VanEck's official SMH holdings page as of 2026-08-18: 25 equity
  constituents totaling 99.93%, with cash rows excluded. Direct Mac `curl`
  requests to the VanEck page and JSON endpoint still reset the connection.
- The fallback is bundled in the frontend and Worker; normal cloud mode still
  prefers the remote `etf_holdings` snapshot, which is now refreshed from this
  snapshot when the live provider is unavailable. No private portfolio data was
  read during the fix or deployment.
- StockAnalysis was read-only probed on 2026-08-19: HTTP 200, no challenge page,
  25 equity rows, `as_of=2026-07-30`, and parsed weight total `0.9991`. Because
  that date is older than the local official snapshot, production keeps the
  2026-08-18 data while treating the refresh as successful.
- Repository: `/Users/junxihuo/Documents/dca_system`, branch `master` tracking
  `origin/master`.
- Append-only migrations `0048_etf_holdings_refresh.sql`,
  `0049_restrict_etf_holding_table_privileges.sql`, and
  `0050_portfolio_ledger_import.sql` are applied to production.
  The latter removes inherited `REFERENCES/TRIGGER` grants so `anon` and
  `authenticated` have only `SELECT` on both ETF snapshot tables.
- Quote Worker version `8d63a31a-2d64-4997-a039-a95dee51816e` is deployed with
  authenticated `POST /api/etf-holdings/refresh` and weekly Sunday refresh.
  UTC 04:10 and 05:10 daily runs use one equivalent comma-list Cron expression
  to stay within the account's five-trigger limit without dropping a run.
- Git-backed Pages deployment `16cf94a6-32b8-46ab-8898-295591d34d4e` is live
  from `4d499d3`. The canonical bundle `index--thvpyYG.js` contains the new
  workbench and unified import UI, without the localhost stub. Fresh browser
  login rendered the login route without console errors; an invalid share token
  returned only the expired-link message.
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

- 2026-08-20 frontend release: `master` was pushed to `origin/master` at
  `2c93d45` with explicit user authorization, and the Git-backed Cloudflare
  Pages project rebuilt automatically. Canonical
  `https://dca-tracker-git.pages.dev` now serves bundle `index-DCYExNkH.js`
  with stylesheet `index-Cv_3GGMn.css`. Post-deploy checks: the served
  `index.html` viewport meta no longer carries `maximum-scale`, the stylesheet
  contains the new `--gain-ink` token, `/`, `/settings`, `/performance` and an
  invalid `/share/<token>` all return 200 (SPA `_redirects` intact), and the
  production login route renders with no console output, so the Pages build
  still injects the public `VITE_` values. No login was attempted and no
  private data was read. Any later docs-only commit rebuilds the same assets.
- The Quote Worker, Email Worker, and Supabase were not touched by this
  release; production remains at migration `0050` and Quote Worker version
  `8d63a31a-2d64-4997-a039-a95dee51816e`.

- Production contains migrations through
  `0050_portfolio_ledger_import.sql`; post-migration schema and permission
  checks passed.
- Quote Worker version `23f51a7b-cc60-416d-9c3d-a95fe4a34671` serves health 200,
  valid refresh-route CORS preflight 200, and unauthenticated refresh 401.
- Cloudflare Pages deployment `16cf94a6-32b8-46ab-8898-295591d34d4e` for source
  `4d499d3` is live at
  `https://16cf94a6.dca-tracker-git.pages.dev`; canonical
  `https://dca-tracker-git.pages.dev` serves bundle `index--thvpyYG.js`.
- No real CSV, financial import, authenticated holdings, or user data was read
  or changed during deployment verification.

## Next Steps

1. Treat any future reduced-motion emulation or native focus audit as
   supplemental research; the current study records its unavailable surfaces.
2. Keep the synthetic-file import smoke test separate from real brokerage data.
   Use `VITE_LEDGER_IMPORT_V2=0` only as an explicit compatibility rollback;
   the old Schwab RPC remains available.
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
  omitted from the existing Schwab compatibility write path. The new adapters
  and unified preview normalize them locally; migration `0050` and the V2
  import surface are released, but the ledger performance method remains
  separately gated.
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
