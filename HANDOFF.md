# Current Handoff

Updated: 2026-09-05

This file is the current task and verified state. It is deliberately short.
The chronological session narrative from 2026-08-19 to 2026-08-24 was moved to
`docs/archive/ai/2026-08-handoff-sessions.md`; durable knowledge lives in the
documents that own it, listed there and under Related Files below.

## Current Goal

Complete the Portfolio Ledger transition: accept trusted cross-broker imports,
including IBKR multi-currency and individual/foreign-market securities, while
keeping calculations, privacy, and the existing single-owner portfolio boundary
safe.

The implementation and production release are complete. Migration
`0054_portfolio_multi_currency.sql` is applied, the Pages/Worker changes are
deployed, and public smoke checks pass. A real private IBKR file remains
intentionally unverified in this session; the owner can select it in the
production importer for the final account-specific check.

The follow-up database fix was applied as migration `0055` to production. The
frontend error-detail fix is included in this release and is deployed through
the existing Pages Git integration.

## Where things stand

| Area | State |
|---|---|
| Frontend | Portfolio Ledger is live on the existing `dca-tracker-git` Pages project; the importer fix is released through its Git integration |
| Supabase | Migrations applied through `0055`; the same-day importer ordering fix is live; **no user is on `ledger_twr_v2`** |
| Quote Worker | Version `a6164e6b-2777-4be4-9198-81147c59ada2`, deployed 2026-09-04; foreign symbols route to Yahoo and compatible US symbols keep Schwab |
| Email Worker | Version `b949cda2-f64d-4920-bcc8-eb69abb8d600`, deployed 2026-09-04; reminder copy uses Portfolio Ledger and generic cross-broker wording |
| Working tree | Import-order release changes are limited to the migration, importer UI, and regression contracts; existing untracked artifacts remain outside the release |

Repository: `/Users/junxihuo/Workspace/dca_system`, branch `master` tracking
`origin/master`.

## Release completed — 2026-09-05

- Fixed the unified importer guard that incorrectly disabled `replace_source`
  and `reset_all` when every valid source row was already marked duplicate.
  Append still requires at least one new row; replacement modes can now rebuild
  the complete normalized payload after the explicit scope confirmation.
- Cloudflare Pages project `dca-tracker-git` deployed commit `168351d` as
  deployment `18bedc32`; the preview URL was
  `https://18bedc32.dca-tracker-git.pages.dev`.
- Cache-busted canonical and preview checks returned 200. The current
  production bundle is `index-Bjp8lZEY.js`, stylesheet is
  `index-Dr32G4PZ.css`, and the login chunk is `login-sEDiYWjV.js`; all loaded
  with HTTP 200.
- The production entry bundle contained the Supabase host and no entry-level
  `http://localhost` stub. In a clean real-browser session, `/login` rendered
  with zero console errors/warnings; same-origin Auth health returned 200, and
  a local route mock verified the application POST to `/auth/v1/otp` without
  sending an OTP or reading account data.
- Cache-busted `/`, `/login`, `/transactions`, `/transactions/all`,
  `/performance`, `/exposure`, `/cashflows`, `/health`, and `/settings` all
  returned 200. No database migration, Worker deployment, or production data
  write was performed.

## Follow-up import incident — 2026-09-05

- Production API/Postgres logs show the unified import RPC reaches the database
  and then rolls back during same-day share-order validation; the local parser
  preview itself reports all 51 rows as importable.
- The defect is in the 0050 write contract: rows are inserted by ascending
  `source_index`, but `created_at` was offset by subtracting that index, so a
  later same-day source row sorted before an earlier one.
- Production migration `0055_fix_portfolio_import_source_order.sql` patches the
  renamed legacy function used by the 0054 wrapper. The importer UI keeps
  PostgREST `message`, `details`, `hint`, and `code` visible on failure.
- No account-data write was performed for this follow-up; the migration and
  frontend release use separate, audited paths.


## Release completed — 2026-09-04

- Supabase project `igwacbeojogblacektxr` registered migration
  `0054_portfolio_multi_currency` at version `20260904053829`. Metadata checks
  confirmed native-currency fields on `transactions`/`cashflows`; anonymous
  execution of both import functions is denied and authenticated execution is
  allowed as designed.
- Cloudflare Pages project `dca-tracker-git` deployed the working-tree build;
  the deployment preview was `c2ea2b63.dca-tracker-git.pages.dev`, and the
  production domain returned 200 with title `Portfolio Ledger · 组合账本`.
- Quote Worker `dca-quote` deployed version
  `a6164e6b-2777-4be4-9198-81147c59ada2`; `/health` returned 200 and public
  `7203.T` quote routing returned Yahoo/JPY data.
- Email Worker `dca-email-cron` deployed version
  `b949cda2-f64d-4920-bcc8-eb69abb8d600`; its public root returned 200 without
  invoking the protected `/run` mail trigger.
- Cloudflare Pages auth-config revalidation: the production `VITE_*` variables
  were present in the `dca-tracker-git` project config, the current working-tree
  build received them only in-process, and production deployment
  `9a4c9291-81eb-4800-ab70-61abff5f286e` completed successfully. Cache-busted
  canonical and preview checks returned 200; all 37 JavaScript assets loaded,
  the browser login page had zero console messages/errors/warnings, and Supabase
  Auth health/CORS checks returned 200. No OTP was sent and no Supabase rows or
  Worker code/configuration were changed.
- No private transaction CSV was read or uploaded by this session. The
  migration's USD backfill is the only production-row write performed; no
  account-specific rows were manually changed.

## Verified production state

### Database — migration 0052 baseline

Applied by the owner. Independently corroborated from the project's own
Postgres logs (project `igwacbeojogblacektxr`):

- a transaction at `2026-08-24T09:43:47.970Z` ran SQL whose text is
  **character-identical to the repository file**
  `supabase/migrations/0052_ledger_performance_cache_v2.sql` — six distinctive
  markers spanning the whole file (`performance_method`,
  `write_ledger_performance_cache`, `to service_role`, `history_cache_missing`,
  `_public_share_sanitize_history`, `ledger_performance_refresh_universe`) all
  sit at a constant 49-character offset from their position in the file;
- the same statement continues into a `supabase_migrations.schema_migrations`
  registration. The version label `20260824094347` matches the transaction
  timestamp to the second.

**Verified by the owner, not re-verified here:** that the live
`performance_method` default is `adjusted_proxy_v1`, that existing settings
rows remain on V1, that the V2 writer and refresh-universe RPCs are
service-role only, and that `shared_performance_history` still projects through
the sanitizer. This session has only read-only *log* access to the project, not
SQL execution, so those runtime facts are recorded as the owner's verification.

Migration `0054_portfolio_multi_currency` was applied to production on
2026-09-04 and registered as version `20260904053829`. Live catalog checks
confirmed the native-currency columns and the authenticated-only import RPC
contract. The migration backfilled existing USD rows and did not manually alter
any account-specific records.

Earlier migrations `0047`–`0051` were verified in production when applied; see
the archive for each one's checks.

### Frontend — prior release baseline (superseded 2026-09-04)

`master` pushed to `dc3433b` with explicit authorization; Pages rebuilt within
about 100 seconds (entry hash changed from the prior release's
`index-VFqTamI9.js` to `index-CWyiYIX-.js`, confirming the rebuild landed). This
release is the `/transactions` skeleton-footprint CLS fix and the 0.186 hunt
recorded in section 6 of `docs/release/2026-08-24-release-gates.md`, on top of
the route-splitting release at `d17831e`. Checks, all cache-busted:

- `/`, `/transactions`, `/performance`, `/login` and `/health` all return 200;
- driven headless against production, `/` and `/transactions` (unauthenticated,
  so both redirect to `/login`) render with a **silent console**.

This was a smaller change than the route-splitting release, so verification was
scoped accordingly — the full `__vite__mapDeps` content-type audit and the
12-route sweep were not repeated. No login was attempted and no private data
was read. The authenticated routes and a populated `/share/<token>` remain
**unverified in production**, as for every previous release.

**`https://dca-tracker-git.netlify.app` returns 401** — site-level protection on
the Netlify entrypoint added in `9805af6`. That target has never been verified.

### Quote Worker — prior deployment baseline (superseded 2026-09-04)

`workers/quote` at `45f56e8` was deployed with explicit authorization. New
version `e5bd372b-1090-4955-b072-867bbc14180a`, 100% of traffic; upload
100.69 KiB, 23.75 KiB gzip. Bindings, secrets and the four cron triggers are
unchanged.

**This corrects the previous handoff's baseline.** It recorded the live Worker
as `8d63a31a-2d64-4997-a039-a95dee51816e` without the V2 refresh code. Both
halves are wrong, per `wrangler deployments list` and `wrangler versions view`:

- `8d63a31a` was created 2026-08-19T13:42:20Z and superseded five seconds later
  by `7e097e7f`. Three further deployments followed it.
- The version actually serving traffic before this one was
  `0aeeb1bc-a7d7-45f0-871b-e659d9816bec`, created **2026-08-24T09:39:35Z** —
  13m40s after `45f56e8` was authored (09:25:55Z) and 4m12s before migration
  `0052` was applied (09:43:47Z). Its `ALLOWED_ORIGINS` already carries the
  Netlify entry from `9805af6`, so it was uploaded from a tree at or after that
  commit.

So the V2 refresh code was almost certainly already live from 2026-08-24, and
this deployment re-published the same commit rather than landing it. That is
timing evidence plus one binding, not proof: wrangler cannot show a past
version's code, so `0aeeb1bc`'s exact contents stay unproven. What is certain is
that the ALLOWED_ORIGINS Netlify entry was **not** new in this deployment.

Pre-deploy: `npm run typecheck` and `npm run test:finance` pass, and
`wrangler deploy --dry-run` builds the bundle — the relevant check, because
`ledgerPerformance.ts` imports `src/lib/calc/ledgerTwr.ts` across the repository
boundary. `npm ci --prefix workers/quote` was not re-run; the existing
`workers/quote/node_modules` built it.

Post-deploy, all cache-busted: `/health` 200, refresh CORS preflight 200 for
both `https://dca-tracker.pages.dev` and `https://dca-tracker-git.netlify.app`
(each echoed back in `access-control-allow-origin`), unauthenticated refresh
401, and `/api/quote?symbols=VOO` 200 with a real snapshot quote.

**Not verified:** the V2 refresh has never executed against a real portfolio,
because `ledger_performance_refresh_universe` selects only settings rows with
`performance_method = 'ledger_twr_v2'` and no user is on V2. It returns an empty
set, so nothing is computed and nothing is written — that was true before this
deployment too.

### Market data

- Quote Worker `e5bd372b-1090-4955-b072-867bbc14180a` serves health 200, refresh
  CORS preflight 200, and unauthenticated refresh 401. SMH's primary channel is
  StockAnalysis' public HTML holdings page, checked against the verified
  2026-08-18 official snapshot so older data cannot overwrite newer.
- `src/data/etf-holdings.json` holds VanEck's official SMH holdings as of
  2026-08-18: 25 equity constituents totaling 99.93%, cash rows excluded.
- A real SMH refresh through the deployed Worker remains **unverified**; direct
  local `curl` to VanEck still resets the connection.

## The 42725 nightly failure — found and fixed in the repo this session

The chained cron **does complete**, which answers the previous handoff's first
next step. From the project's own Postgres and edge logs, the 2026-08-31 04:10
firing ran `active_monitor_universe` → four `upsert_daily_prices` (all 200) →
`refresh_due_performance_caches` → `ledger_performance_refresh_universe` (200,
body `[]`, as expected while no user is on V2). The 12:15 retry ran the same
chain with nine `upsert_daily_prices`, all 200. A price-sync rejection would
have stopped the chain before the V2 call, so the daily prices are being
written and `daily_prices` is current.

What the same logs also show is a failure that had never surfaced.
`refresh_due_performance_caches` returns **400 on every firing**:

```
42725  function public._performance_source_hash(uuid) is not unique
```

`0028` removed the default from `_performance_source_hash(uuid, text)` on
purpose, because the one-argument wrapper makes a defaulted two-argument form
unresolvable. `0043` (authored 2026-07-28) put `default 'SPY'` back and `0047`
carried it. `create or replace function` adds a default without complaint, so
both applied cleanly and only the call failed. `refreshDuePerformanceCaches` in
`workers/quote/src/index.ts` catches and `console.warn`s, so the nightly cache
warm-up has been a silent no-op for about a month.

Impact is bounded: nothing is written wrong, and the cache is still refreshed
on demand by the client (`refresh_performance_history_cache` returns 200 in the
same logs). The cost is that the first dashboard load after a data change pays
the full recompute.

`supabase/migrations/0053_fix_performance_source_hash_ambiguity.sql` drops the
two-argument form and recreates it with the 0047 body and no default —
`create or replace` cannot remove a default — and ends with a `do $$ … $$` that
resolves a one-argument call so a future regression fails the migration loudly.
`npm run test:migration-overloads` (new, `scripts/verify-function-overloads.mjs`)
replays every create/drop across the migration set in file order and fails on
the whole 42725 class. It is mutation-tested both ways: removing `0053`
reproduces the production error, reintroducing the default inside `0053` fails
it. Rationale, the four registered pre-existing ambiguities, and rollback:
`docs/decisions/2026-08-31-function-overload-ambiguity.md`.

Migration `0053` was applied to production at `2026-09-03T17:20:24Z` and
registered as `fix_performance_source_hash_ambiguity`. Live catalog inspection
showed both `_performance_source_hash` overloads without argument defaults,
with the existing `security definer` and service-role-only ACL unchanged. The
04:10 UTC cron on 2026-09-04 returned HTTP 200 for
`refresh_due_performance_caches`; no post-migration 42725/`not unique` appeared.
Two cache rows received refresh attempts and updates, and the dirty count was
0 afterward, confirming that the warm-up completed. No user
`performance_method` was changed.

## The V2 performance method — read this before touching it

Migration `0052` added the storage and write surface for `ledger_twr_v2`. It
changes nothing until a user's `settings.performance_method` is flipped, and
**no user has been flipped**.

- V2 rows sit beside V1 in `performance_history_cache`, which was already keyed
  `(user_id, benchmark, method)`. V1 is untouched and remains the default.
- The engine is **not** in the database. `src/lib/calc/ledgerTwr.ts` is the one
  implementation — the module `test:finance` reconciles against Portfolio
  Performance 0.86.0 — and `workers/quote/src/ledgerPerformance.ts` imports it
  directly rather than copying it.
- `write_ledger_performance_cache` validates against an allowlist and then
  *builds* the payload itself, so a caller contributes values and never keys.
- **Do not add a silent V1 fallback.** When a user is on V2 with no V2 row, both
  readers return `history_cache_missing` naming the method, on purpose: a
  fallback would let the dashboard and the share report different methods.
- `return_pct_user` is a **fraction**, not a percent, in V1 and V2 alike.

Rationale and rejected alternatives:
`docs/decisions/2026-08-24-ledger-twr-v2-cache-writer.md`.

## Next steps

1. **The Portfolio Ledger release is complete.** Migration `0054` is applied,
   the Pages/quote/email deployments are live, and public smoke checks pass.
   The remaining account-specific check is for the owner to select the private
   IBKR export in production; this session intentionally did not read that file.
2. **B2 — the `ledger_twr_v2` switch.** B1 closed on 2026-08-23. What remains is
   a full re-import and a V1 regression, both needing authorized cloud work.
   Only after those should any user's `performance_method` be flipped. Flipping
   it is a deliberate database action; there is no UI for it by design.
3. **Cross-browser: WebKit and Gecko.** `docs/release/probes/cross-browser-check.mjs`
   already drives Safari over the built-in `safaridriver`; it needs Safari →
   设置 → 高级 → 显示网页开发者功能, then 开发 → 允许远程自动化, turned on by
   hand. Re-running it then fills the WebKit row with no code change. Gecko
   needs Firefox installed, which the owner declined.
4. **Accessibility: a real assistive-technology pass.** The mechanical half is
   done (0 findings over 26 scans). What is open is VoiceOver/NVDA announcement
   order, live-region timing, braille, rotor and gesture navigation, plus the
   cloud-only routes (`/cashflows`, a populated `/share/<token>`, the
   authenticated login flow).
5. **Performance follow-ups — released; the two items behind them are now
   settled, but the second fix is not deployed.** Route-level code splitting and
   the reserved-height work shipped in `1f3e027`; sections 5 and 6 of
   `docs/release/2026-08-24-release-gates.md` carry the numbers. First-load JS
   went 427.41 → 171.65 KiB gzip with the budget ratcheted to match, and
   emulated-mobile Lighthouse performance went 66–84 → 86–92 across the six
   measured routes.

   `/transactions` is fixed and **released at `dc3433b`**: its recent-ledger
   placeholder was `h-24` against a 324/402 px list, which pushed the section
   below it off screen. `TxnListSkeleton` now carries that footprint and the
   route reads 0 CLS on both form factors, down from 0.015 mobile and 0.044
   desktop.

   The intermittent 0.186 class on `/performance` desktop **did not recur** in
   33 runs, 30 of them driven concurrently with a full Lighthouse sweep — the
   contention the original spike needed — plus two full gate sweeps under that
   contention, worst run 0.005. Its deterministic causes are gone and nothing
   left on the route changes size after first paint. That is not proof it is
   impossible; `docs/release/probes/cls-attribution.mjs` (now with
   `PROBE_FORM_FACTOR=desktop` and `PROBE_RUNS`) makes the next occurrence
   attributable in one run instead of a sweep.

   Still untouched: `supabase` (52.17 KiB gzip) is first-load because the auth
   check runs before any route renders. Looked at on 2026-08-31 and **not
   changed, on purpose.** It is already its own chunk and reaches the browser
   as a `modulepreload` in the head, so it is fetched in parallel with the
   entry, not after it. Making `useAuth` import it dynamically would take
   52 KiB out of the measured first-load set, but the session check would then
   start a round trip later — a real win for a logged-out visitor landing on
   `/login`, and a real loss on every warm authenticated load. This is one
   person's portfolio and that person is nearly always signed in, so the trade
   goes the wrong way. Revisit only if the anonymous `/share/<token>` route
   becomes the common entry point.

   What did change on 2026-08-31: the budget's `externalRenderBlockingOrigins`
   gate was counting the Google Fonts stylesheet inside `<noscript>`, and
   because it counts distinct *origins*, that phantom made a genuinely
   render-blocking fonts stylesheet in the head read as the same `1`. The gate
   passed on a build carrying the exact regression `ce2cd21` removed.
   `scripts/verify-release-budget.mjs` now strips `<noscript>` and the budget is
   ratcheted `1 → 0`; both directions are mutation-tested. Section 7 of
   `docs/release/2026-08-24-release-gates.md` has the table. No page bytes
   moved — first-load JS is still 171.65 KiB gzip.
6. **Prior SMH follow-up.** Verify the authenticated
   `POST /api/etf-holdings/refresh` with a synthetic account, including partial
   provider failure, final-holder deletion, and re-buy refresh, and SMH access
   to the VanEck JSON dataset from the deployed Worker runtime.

## Known issues recorded but not fixed

- **Legacy share fallback projects warnings only, not series.** The
  `portfolio_history_cache` fallback branch in `shared_performance_history`
  returns `public_history` with only its `warnings` projected; an injected
  `nav_user` in its *series* would reach an anonymous reader. **Not a live
  leak** — migration `0023` truncated that table and no migration since writes
  `public_history`, so the branch is unreachable. Close it deliberately if that
  table is ever repopulated.
- **Four zero-argument RPC overloads are ambiguous the same way.**
  `performance_history`, `performance_cache_status`,
  `refresh_performance_history_cache` and `tracked_symbol_coverage` each have a
  `(p_benchmark text default …)` form plus an explicit zero-argument wrapper, so
  a no-argument call has two candidates. **No production failure observed** —
  the client passes `p_benchmark` by name, which PostgREST resolves — but the
  zero-argument fallback branches in `src/hooks/usePerformanceCache.ts`,
  `usePortfolio.ts` and `useDemoDcaData.ts` would raise 42725 instead of falling
  back. Registered as non-blocking warnings in
  `scripts/verify-function-overloads.mjs`; fixing them drops and recreates four
  functions granted to `authenticated`, one of them part of the 0052 V2 cache
  contract, so it is a separate authorized change.
- **The quote Worker swallows RPC failures from the daily sync.**
  `refreshDuePerformanceCaches` catches and `console.warn`s, which is why the
  42725 breakage above ran for a month unnoticed. Changing that is a Worker
  deploy and was not done.
- **The writer's magnitude check is a smell test.** It rejects a return outside
  ±1000, which catches a NAV like `138499.04` in a return field but not a small
  amount — `921.53` passes. The guarantee is the key allowlist, not this bound.
- **`test:share-privacy` reads migration text**, so it cannot audit the cache
  writer chain. `_performance_history_for_user_fast_base` has no static
  definition anywhere: `0029` created it by renaming and `0037`/`0043`/`0047`
  patch it in place. That is exactly why the public boundary projects rather
  than trusts.

## Standing constraints

- Production deploys, secrets updates, OAuth flows, and production database
  changes each require explicit authorization for that exact operation. Deploys
  are authorized one at a time.
- Keep the synthetic-file import smoke test separate from real brokerage data.
  The user-provided real CSV has never been read, copied, or imported.
- `VITE_LEDGER_IMPORT_V2=0` is an explicit compatibility rollback only.
- The competitive scorecard's choice of Wealthfolio as the interaction reference
  is a research decision, never a production release authorization.
- Import icons from `src/components/icons.tsx`, never `lucide-react` directly.
- Do not run Prettier on this repository — there is no config, so it reformats
  whole files to defaults that do not match the surrounding code.
- Do not extend `portfolio_history_cache`; it is legacy compatibility surface.

## Risks and boundaries

- Full reset deletes all current-user transactions, cashflows, and funding
  batches before rebuilding ETF trades and imported cash events. Any validation
  or write error must roll back the whole RPC transaction.
- Dividends, interest, withdrawals, taxes, and unsupported cash events remain
  omitted from the Schwab compatibility write path. The adapters and unified
  preview normalize them locally; the ledger performance method stays separately
  gated.
- Public share responses remain percentage-only. Absolute settled and allocation
  amounts stay behind owner RLS and are never added to public JSON contracts.
- The Pages edge can serve a cached `index.html` naming the previous bundle for
  a few minutes after a deploy. Always verify with a cache-busting query
  parameter before concluding a deploy has or has not landed.

## Verification

Default CI-equivalent set, plus the budget gate that now runs after build:

```bash
npm run test:finance
npm run test:email-reminder
npm run test:quote-status
npm run test:share-privacy
npm run typecheck
npm run build
npm run test:release-budget
```

Migration changes additionally need the two scoped static checks, neither of
which is in CI:

```bash
npm run test:migration-numbering
npm run test:migration-overloads
```

Release-time browser probes are not in CI and are run by hand:
`docs/release/probes/` (Lighthouse, cross-browser, layout-shift attribution) and
`docs/accessibility/probes/` (axe, keyboard, reduced motion, reflow and target
size, accessibility tree). `docs/release/README.md` carries the release
checklist.

## Related files

- `PROJECT.md`, `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`
- `docs/PERFORMANCE_SPEC.md`, `docs/LOOKTHROUGH_SPEC.md`
- `docs/architecture/performance-and-privacy.md`,
  `docs/architecture/import-and-ledger.md`
- `docs/release/README.md`, `docs/release/2026-08-24-release-gates.md`
- `docs/accessibility/2026-08-20-wcag-route-audit.md`
- `docs/decisions/2026-08-24-ledger-twr-v2-cache-writer.md`,
  `docs/decisions/2026-08-23-public-share-warning-projection.md`
- `docs/research/competitive/2026-08/requirements-audit.md`
- `docs/tasks/2026-08-19-competitive-learning-rectification-plan.md`
- `docs/runbooks/deployment.md`, `docs/runbooks/database-migrations.md`
- `supabase/migrations/0052_ledger_performance_cache_v2.sql`
- `supabase/migrations/0053_fix_performance_source_hash_ambiguity.sql`,
  `scripts/verify-function-overloads.mjs`,
  `docs/decisions/2026-08-31-function-overload-ambiguity.md`
- `supabase/migrations/0054_portfolio_multi_currency.sql`,
  `src/lib/import/ibkr.ts`, `src/lib/import/schwabLedger.ts`,
  `scripts/verify-portfolio-multi-currency.mjs`
- `workers/quote/src/ledgerPerformance.ts`, `src/lib/calc/ledgerTwr.ts`
- `src/components/icons.tsx`, `src/lib/import/`
- `docs/archive/ai/2026-08-handoff-sessions.md` — the 2026-08 session narrative
