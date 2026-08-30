# Current Handoff

Updated: 2026-08-24

This file is the current task and verified state. It is deliberately short.
The chronological session narrative from 2026-08-19 to 2026-08-24 was moved to
`docs/archive/ai/2026-08-handoff-sessions.md`; durable knowledge lives in the
documents that own it, listed there and under Related Files below.

## Current Goal

Execute the DCA Tracker competitive research and six-month optimization plan:
move from trusted source import and ledger semantics to financial calculation,
task-oriented interaction, and privacy-safe analysis, without expanding beyond
one personal ETF portfolio.

`docs/research/competitive/2026-08/requirements-audit.md` is the evidence
ledger for that goal and the arbiter of what counts as proved. As of today it
has **no fully `missing` rows**; what remains is `partial`, and each partial row
states exactly what is missing.

## Where things stand

| Area | State |
|---|---|
| Frontend | Live on Pages at `dc3433b`, entry `assets/index-CWyiYIX-.js`, stylesheet `assets/index-H-TFRIaI.css` |
| Supabase | Migrations applied through `0052`; **no user is on `ledger_twr_v2`** |
| Quote Worker | Version `8d63a31a-2d64-4997-a039-a95dee51816e`; **does not yet include the V2 refresh code** |
| Email Worker | Unchanged |
| Working tree | Clean, `master` synced with `origin/master` |

Repository: `/Users/junxihuo/Workspace/dca_system`, branch `master` tracking
`origin/master`.

## Verified production state

### Database — migration 0052 applied 2026-08-24

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

Earlier migrations `0047`–`0051` were verified in production when applied; see
the archive for each one's checks.

### Frontend — current release

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

### Market data

- Quote Worker `8d63a31a-2d64-4997-a039-a95dee51816e` serves health 200, refresh
  CORS preflight 200, and unauthenticated refresh 401. SMH's primary channel is
  StockAnalysis' public HTML holdings page, checked against the verified
  2026-08-18 official snapshot so older data cannot overwrite newer.
- `src/data/etf-holdings.json` holds VanEck's official SMH holdings as of
  2026-08-18: 25 equity constituents totaling 99.93%, cash rows excluded.
- A real SMH refresh through the deployed Worker remains **unverified**; direct
  local `curl` to VanEck still resets the connection.

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

1. **Deploy the quote Worker.** The V2 refresh code is committed but the
   deployed Worker predates it, so nothing computes a V2 curve today. This is
   the only remaining step before D1 can be exercised at all. It needs explicit
   authorization, and `docs/runbooks/deployment.md` has the procedure.
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
   check runs before any route renders.
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
- `workers/quote/src/ledgerPerformance.ts`, `src/lib/calc/ledgerTwr.ts`
- `src/components/icons.tsx`, `src/lib/import/`
- `docs/archive/ai/2026-08-handoff-sessions.md` — the 2026-08 session narrative
