# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Vite dev server on http://localhost:5173
npm run build         # tsc -b && vite build (CI also runs this)
npm run typecheck     # Front-end + BOTH workers (tsc -b + workers/quote + workers/email-cron)
npm run test:finance  # Modified-Dietz / TWR fixture regression — runs scripts/verify-performance-fixtures.mjs
```

There is no lint script. CI (`.github/workflows/ci.yml`) runs `test:finance`, `typecheck`, and `build` on every push/PR — keep all three green.

Worker deploys are per-directory and require `wrangler login` once:

```bash
cd workers/quote      && npm run deploy   # uses workers/quote/wrangler.toml
cd workers/email-cron && npm run deploy   # uses workers/email-cron/wrangler.toml
```

To trigger the email Worker manually for testing: `curl -X POST https://dca-email-cron.<acct>.workers.dev/run` (note the auth / dedupe caveat in "Gotchas" below).

## Architecture

Three deployables share one Supabase Postgres:

```
Browser SPA (Cloudflare Pages) ──► Supabase (auth + RLS + RPCs)
        │                       └► dca-quote Worker ──► Yahoo Finance
        │                                          └─► writes daily_prices via service role on cron
        └───────────────────── (no direct call) ─────► dca-email-cron Worker ──► Resend
                                                                              └─► reads settings via service role
```

- **`src/`** — React 18 SPA. Routes in `src/App.tsx`. Pages in `src/app/`. Pure finance math in `src/lib/calc/` (`position`, `xirr`, `twr`, `rebalance`, `target`, `history`). Data fetching via `@tanstack/react-query` hooks in `src/hooks/`.
- **`workers/quote/`** — Yahoo Finance reverse-proxy with KV cache. Three endpoints: `/api/quote` (5-min cache), `/api/chart` (1h), `/api/history` (1h, also persists to `daily_prices`). Daily cron at UTC 22:15 syncs prices and calls `refresh_due_performance_caches()`. `/api/history` supports `?persist=sync` to await the `daily_prices` upsert before responding — use this when the caller needs guaranteed price data before the next step (e.g. demo seed, price backfill).
- **`workers/email-cron/`** — Cron at UTC 03:00 = Beijing 11:00. Computes next NYSE trading day, sends a Resend email the day before the month's first trading day. KV (`sent:<user>:<YYYY-MM>`) + `email_log` table = two-layer dedupe.
- **`supabase/migrations/`** — Numbered, additive, idempotent SQL. **Run in order on a fresh project** (currently 0001 → 0017). Each new schema change is a new file; never rewrite an already-applied migration. `supabase/README.md` documents the deploy order.

## Performance history pipeline (non-obvious, central)

The dashboard and the public `/share/:token` view must show **the same TWR curve**, and the share view must never recompute it anonymously (privacy + cost). This is enforced by a precomputed cache, not a live calculation:

1. **Source of truth**: `transactions` and `daily_prices.adjusted_close` per user. Cashflows remain source-of-truth for account NAV/XIRR, but the performance curve uses trading-performance flows inferred from transactions.
2. **Cache table**: `performance_history_cache` stores only public-safe fields per day: `date`, `return_pct_user`, `return_pct_spy`. **No USD NAV, no cashflows, no trade detail.** This is what keeps share links from leaking absolute amounts.
3. **Dirty marking**: triggers on `transactions`/`daily_prices` flip a per-user `dirty` flag.
4. **Refresh entry points** (use these — do not add new ones casually):
   - Authenticated dashboard: `performance_history()` RPC (reads cache; UI shows stale curve and refreshes in background if dirty).
   - Authenticated refresh: `refresh_performance_history_cache()`.
   - Public share read: `shared_performance_history(token)` — cache-only, returns empty state if no cache exists, never recomputes.
   - Share-owner refresh: `refresh_shared_history_cache(token)`.
   - Service-role batch refresh from the quote Worker's cron: `refresh_due_performance_caches()`.
5. **Returns math**: TWR (daily-linked, Modified-Dietz per sub-period) for the chart. The chart starts on the first transaction date; sell proceeds fund later buys first, and only the unfunded portion of a buy becomes a new external flow. XIRR is money-weighted and shown separately — never used to draw the curve. Benchmark is SPY using adjusted-close as a total-return proxy (close enough for the report, not broker-exact).

Spec lives in `docs/PERFORMANCE_SPEC.md`; the regression fixtures in `scripts/verify-performance-fixtures.mjs` enumerate the cases (single buy, sell-after-buy, trade-only funding, missing price, share-token parity, etc.) that must stay green when touching this pipeline.

## Calc layer rules

`src/lib/calc/` is **pure** — no network, no Supabase, no React. Hooks marshal data in and out. Three contracts that the UI relies on:

- **NAV = market value of holdings + uninvested cash** (deposits − buys + sells). Dashboard totals, XIRR, and `$1M` progress use account NAV. The performance curve uses trade-funding NAV inferred from transactions so pre-trade idle cash does not affect SPY comparison. Don't compute "total" from positions only.
- **Cost basis**: average cost is the default; FIFO is a toggle. Both live in `position.ts`. Sells are validated against current shares; oversells must surface as a validation error, not silently zero out FIFO lots.
- **TWR sub-periods are bounded by inferred trade-funding flows.** A flow on day *t* enters the next sub-period's starting NAV, not the previous sub-period's return.

## Privacy invariant for shared views

`shared_portfolio(token)` and `shared_performance_history(token)` are `security definer` RPCs that return **sanitized** data: holding weights %, return %, dates. They must never expose USD amounts, CNY, exchange-loss, deposit history, or per-trade detail. When adding any field to a share response, trace it to a DB column or RPC field that is already public-safe — never proxy through a live external API call from the share page.

## Migration discipline

- Migrations are numbered (`NNNN_description.sql`) and **append-only**. Never edit a migration that has been committed/applied.
- New work that changes schema or RPCs ⇒ new `NNNN+1_*.sql`. Use `create or replace`, `add column if not exists`, etc. so the file is idempotent on already-deployed projects.
- After adding a migration that affects performance history, run `supabase/performance_cache_verify.sql` against a dev project and confirm `npm run test:finance` still passes.

## Data-health / backfill flow

The data-health page (`src/app/data-health.tsx`) orchestrates price backfill and cache refresh. The order matters:

1. **Backfill**: `fetchHistory(symbols, range, { persist: 'sync' })` — sync-writes `daily_prices` before returning, so subsequent cache refresh sees the new prices.
2. **Cache refresh**: calls `refreshPerformanceHistoryCache()` (via `useRefreshPerformanceCache`), which recomputes TWR and clears the dirty flag.
3. **UI refetch**: after either operation, `price_coverage`, `performance_cache_status`, and `portfolio_history` are all invalidated + refetched so the page shows current state.

Demo data seed (`useDemoDcaData`) follows the same pattern: sync-fetch prices → insert transactions → refresh cache once.

## Non-obvious gotchas

- **Supabase client has no `Database` generic.** `src/lib/supabase.ts` is intentionally untyped at the client level (v2's signature conflicted with our flattened row types). Type safety is per-call: `useQuery<TxnRow[]>(...)`. Don't "fix" this by adding the generic.
- **`xirr` is CJS with no `.d.ts`.** Custom shim lives at `src/types/xirr.d.ts`. Keep it.
- **NYSE holiday calendar is hardcoded** in `workers/email-cron/src/nyse-calendar.ts` for 2026–2028. Every December, append the next year from nyse.com and redeploy. `src/lib/quote.ts` market-hours check shares the same blind spot.
- **Worker CORS is per-deployment.** `ALLOWED_ORIGINS` in `workers/quote/wrangler.toml` is comma-separated and supports a single-label `*` wildcard (e.g. `https://*.dca-tracker.pages.dev` matches preview hashes). Changing Pages domains requires editing the toml and re-deploying the Worker.
- **Email Worker `/run?force=1` bypasses the date check** for testing but still hits KV/`email_log` dedupe. Treat the endpoint as privileged; if exposing the Worker URL widely, add a bearer secret check before relying on `force`.
- **Default dates in TxnForm/CashflowForm**: forms use local-date formatting (not UTC) so a Beijing-morning entry doesn't roll back a day. Keep that when editing the forms.
- **SPA deep-link fallback**: `public/_redirects` (`/* /index.html 200`) is required for `/share/:token` to load on Pages. Don't delete it.
- **`portfolio_history_cache` is legacy.** New reads go through `performance_history()` / `shared_performance_history()`. Keep the old table working for back-compat but don't extend it.
- **`isMissingRpc` is duplicated** across `useDemoDcaData.ts` and `usePerformanceCache.ts` (identical logic, different file-local copies). This is intentional — each hook is self-contained and the function is trivial. Don't extract it into a shared util unless a third copy appears.
- **Performance cache warnings aggregation** (migration 0017): the `_performance_history_for_user_fast` function uses CTE separation — `series_json` (jsonb_agg of cumulative returns) and `warnings_json` (jsonb_agg from warnings_source) are computed independently then `cross join`ed in the final SELECT. This avoids the `column must appear in GROUP BY` error that inline aggregation caused. Don't collapse them back into a single CTE.

## Where to look first

- New feature touching numbers ⇒ `src/lib/calc/` first, then the hook that calls it, then the page.
- Anything visible in `/share/:token` ⇒ start in `supabase/migrations/` (find the latest `shared_*` function) and `docs/PERFORMANCE_SPEC.md`.
- Quote/price flow ⇒ `workers/quote/src/index.ts` + `src/lib/quote.ts` + `src/hooks/useQuotes.ts` / `useDailyPrices.ts`.
- Email reminder logic ⇒ `workers/email-cron/src/index.ts` + `workers/email-cron/src/nyse-calendar.ts`.
- Operational health / cache dirty status ⇒ `src/app/data-health.tsx`, `src/hooks/usePerformanceCache.ts`, and `supabase/migrations/0017_fix_performance_warnings_aggregation.sql`.
