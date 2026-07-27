# DCA Tracker Project

## Product

DCA Tracker is a private, responsive PWA for tracking a long-term US ETF
portfolio. It is designed around a Schwab-funded portfolio, but transactions,
cashflows, settings, and market data remain application-owned rather than being
read from a brokerage account.

The current product includes:

- email magic-link authentication;
- transaction, funding-batch, and cashflow tracking;
- average-cost and FIFO position views;
- account NAV, daily and cumulative P&L, XIRR, and TWR reporting;
- selectable benchmarks and historical performance;
- price-coverage and performance-cache health workflows;
- sanitized, read-only share links;
- monthly funding reminder email;
- an offline local demo mode;
- draft-only X content operations and analysis scripts.

## Product Goal and Scope

- Users: one authenticated portfolio owner and recipients of sanitized,
  read-only share links.
- Core problem: maintain an application-owned record of a long-term US ETF
  portfolio and report trustworthy holdings, cashflow, and performance metrics
  without exposing private financial data.
- Current stage: the SPA, two Workers, Supabase schema, local demo, and
  verification workflows are implemented and maintained from this repository.
- In scope: portfolio records, market-data ingestion, performance calculation,
  data-health operations, reminders, private authentication, and sanitized
  sharing.
- Out of scope: brokerage order execution, brokerage account or position sync,
  anonymous reconstruction of private history, and disclosure of absolute
  portfolio amounts through public links.

## Sources of Truth

Use project facts in this order:

1. Current repository files and Git state.
2. Source code, migrations, lockfiles, and deployment configuration.
3. Tests and locally verified command results.
4. Maintained project documentation.
5. Verified deployment or database results.

Sessions, chat history, auto memory, external plans, and app caches are only
leads. Do not turn them into project facts until the repository or a current
verification confirms them.

## Deployable Architecture

The system has three deployables sharing one Supabase Postgres database:

```text
Browser SPA on Cloudflare Pages
  |-- Supabase Auth, RLS tables, and RPCs
  `-- dca-quote Worker
        |-- Schwab Market Data or Yahoo Finance fallback
        |-- KV caches
        `-- daily_prices and performance-cache refresh RPCs

dca-email-cron Worker
  |-- Supabase settings and email_log through service role
  |-- KV delivery deduplication
  `-- Resend
```

The browser does not call the email Worker during normal application use.
Workers hold service credentials as Cloudflare secrets; they must never be
bundled into the SPA.

More detail:

- `docs/architecture/system-overview.md`
- `docs/architecture/performance-and-privacy.md`
- `docs/PERFORMANCE_SPEC.md`
- `docs/LOOKTHROUGH_SPEC.md`

## Technology

- React 18, TypeScript, Vite, React Router, React Query, Zustand
- Tailwind CSS, Radix UI primitives, Framer Motion, Recharts,
  Lightweight Charts
- Supabase Auth and Postgres with RLS and security-definer RPCs
- Cloudflare Pages, Workers, and KV
- Schwab Market Data with Yahoo Finance compatibility/fallback paths
- Resend for reminder email
- npm with committed lockfiles; CI uses Node.js 22

## Repository Layout

- `src/app/`: route-level pages, including dashboard, performance, exposure,
  transactions, cashflows, data health, settings, login, and public share.
- `src/components/`: shared UI and chart components.
- `src/hooks/`: React Query and application orchestration hooks.
- `src/lib/calc/`: pure portfolio and performance calculations. No React,
  network, or Supabase code belongs here.
- `src/lib/`: Supabase client, quote client, local-mode helpers, formatting,
  and application utilities.
- `src/data/`: bundled offline demo dataset.
- `workers/quote/`: market-data proxy, KV cache, historical-price persistence,
  and scheduled cache refresh.
- `workers/email-cron/`: NYSE-calendar reminder scheduling and email delivery.
- `supabase/migrations/`: append-only schema and RPC history, currently through
  `0042_private_performance_daily_pnl.sql`.
- `scripts/`: regression checks, local dataset generation, operational market
  data helpers, and X content tooling.
- `tests/fixtures/`: finance and long-horizon regression fixtures.
- `docs/`: specifications, architecture, decisions, runbooks, tasks,
  migrations, archived AI notes, and X content operations.
- `references/`: reviewed links to external platform and provider
  documentation.
- `artifacts/x-content/`: dated, non-runtime X content work products.

Keep this real structure. Do not reorganize the project into template
`apps/` or `packages/` directories without an explicit architectural decision.

## Local Commands

Install exactly from lockfiles:

```bash
npm ci
npm ci --prefix workers/quote
npm ci --prefix workers/email-cron
```

Development and builds:

```bash
npm run dev
npm run dev:local
npm run build
npm run build:local
npm run preview
```

Core verification:

```bash
npm run test:finance
npm run test:email-reminder
npm run test:quote-status
npm run typecheck
npm run build
```

Additional scoped checks:

```bash
npm run test:ui
npm run test:symbols
npm run test:nyse-calendar-sync
npm run test:stress
npm run test:schwab
```

There is no lint script. Do not claim lint passed unless one is added and run.
CI runs the three worker/root installs followed by finance, email-reminder,
quote-status, typecheck, and build.

## Runtime Modes

Normal mode requires public `VITE_` configuration for the Supabase URL, the
Supabase anonymous key, and the quote Worker URL. Real secrets are not front-end
variables and must not be stored in project files.

`VITE_LOCAL_MODE=1` enables the bundled read-only demo. It bypasses Supabase and
the quote Worker and uses `src/data/local-dataset.json`. Never enable local mode
for the production application.

## Data, Auth, and Privacy

- Supabase Email Magic Link is the browser authentication mechanism.
- `VITE_DEV_BYPASS_AUTH` only applies in Vite dev mode and bypasses login unless
  explicitly set to `0`; `.env.example` keeps `0` as the safe default.
- User-owned tables are protected by RLS using `auth.uid() = user_id`.
- Service-role access belongs only in Workers or explicitly authorized
  administration.
- `shared_portfolio(token)` and `shared_performance_history(token)` return only
  public-safe percentages, dates, labels, and holdings weights.
- Public share responses must never expose USD/CNY values, cashflows,
  transaction detail, exchange loss, contact data, or private user fields.
- The share page reads cached performance and must never anonymously recompute
  a user's history or call a live API to reconstruct it.

## Financial Contracts

- Account NAV is holdings market value plus uninvested cash.
- Cashflows are the source of truth for account NAV and XIRR.
- The performance chart is daily-linked TWR using inferred trade-funding flows;
  XIRR is a separate money-weighted metric and never draws the curve.
- A flow on day `t` enters the next sub-period's starting NAV.
- Average cost is the default; FIFO is supported. Oversells must return a
  validation error.
- Adjusted close is the benchmark total-return proxy.
- Dashboard and public share performance must use the same cached TWR series.
- Form default dates use local calendar dates, not UTC date truncation.

## Database Discipline

- Treat committed migrations as immutable and append-only.
- Every schema, RLS, trigger, or RPC change gets a new numbered migration.
- Make new migrations safe for an already-deployed project where practical.
- Apply migration files in repository filename order on a fresh project.
- For performance-history changes, run finance fixtures and the applicable
  cache verification against a development project. Never test by changing
  production data during ordinary development.
- `portfolio_history_cache` is legacy compatibility surface; do not extend it.

## Stable Implementation Constraints

- Keep `src/lib/calc/` pure.
- Keep the Supabase client intentionally untyped at the client level; type
  individual calls instead of adding a `Database` generic.
- Keep `src/types/xirr.d.ts` for the CommonJS `xirr` package.
- Preserve `public/_redirects` for Cloudflare Pages SPA deep links.
- Keep the local date behavior in transaction and cashflow forms.
- Extend the hardcoded NYSE holiday calendar each December before the covered
  years expire.
- After adding or changing holidays, run `npm run test:nyse-calendar-sync` to
  confirm all three copies remain identical.
- Keep the performance warnings aggregation separated from the series
  aggregation; collapsing them recreates a SQL grouping failure.
- Treat quote Worker CORS as deployment-specific configuration.

## Deployment

- The SPA builds with `npm run build` and publishes `dist/` to Cloudflare Pages.
- `workers/quote` and `workers/email-cron` deploy independently with their own
  `wrangler.toml` and package scripts.
- Supabase changes are deployed by applying new migrations in order.
- Production deploys, secrets updates, OAuth flows, and production database
  changes require explicit user authorization.

Use `docs/runbooks/` for operational steps. Runbooks describe the process but
do not grant deployment authority.

## Security Rules

- Never read, print, copy, commit, or transmit real environment files, tokens,
  cookies, private keys, database passwords, private financial imports, or user
  data.
- Do not commit generated logs, Wrangler state, dependency trees, build output,
  or local AI state.
- Do not expose service-role credentials to the browser.
- Do not weaken share sanitization or RLS for convenience.
- Do not modify production systems unless the user explicitly authorizes that
  exact operation.

## AI Project Entry Points

- `PROJECT.md`: stable shared project facts.
- `AGENTS.md`: shared execution rules.
- `CLAUDE.md`: Claude Code-specific additions only.
- `HANDOFF.md`: the current unfinished task and verified state.
- `references/index.md`: reviewed external documentation used by the project.

Update durable facts in the appropriate architecture, decision, or runbook
document. Keep temporary progress in `HANDOFF.md` and the relevant task log.
