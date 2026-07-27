# System Overview

## Components

### Browser SPA

The React/Vite application runs on Cloudflare Pages. Authenticated routes use
Supabase Email Magic Link, RLS-protected tables, and RPCs. The public
`/share/:token` route uses only sanitized security-definer RPCs.

The browser calls the quote Worker for market data. It does not receive Worker
service credentials and does not call the email Worker in normal use.

### Quote Worker

`workers/quote` provides quote and price-history endpoints, caches responses in
KV, persists daily prices through service-role access, tracks write health, and
refreshes due performance caches on schedules declared in `wrangler.toml`.

Schwab Market Data is the configured provider. Yahoo-compatible routes and
fallback behavior remain part of the implementation. The Worker explicitly
does not implement brokerage account, position, order, or trading access.

### Email Worker

`workers/email-cron` determines the next NYSE trading day, reads opted-in
settings with service-role access, sends through Resend, and uses KV plus
`email_log` for two-layer deduplication.

### Supabase

Supabase owns authentication, user data, RLS, price persistence, sanitized
share RPCs, and performance caches. Schema changes are represented by
append-only files under `supabase/migrations/`.

## Major Flows

### Authenticated Portfolio Read

```text
session -> RLS tables/RPCs -> React Query hooks -> pure calc layer -> pages
                    |
                    `-> cached performance and daily P&L
```

### Market Data and Backfill

```text
browser -> quote Worker -> Schwab/Yahoo -> response
                         `-> daily_prices persistence
                               `-> cache dirty marking
```

Data-health backfill must request synchronous persistence before refreshing the
performance cache. Otherwise the refresh can run before the new prices exist.

### Monthly Reminder

```text
Cloudflare cron -> NYSE calendar -> opted-in settings -> KV/email_log dedupe
                                                    `-> Resend
```

## Runtime Boundaries

- `src/lib/calc/` is deterministic and has no network, Supabase, or React
  dependencies.
- Hooks marshal remote data into pure calculations and UI models.
- Service-role credentials exist only in Workers or authorized administrative
  tooling.
- Offline local mode short-circuits all remote data paths.

## Operational Configuration

- Root `package-lock.json` controls the SPA toolchain.
- Each Worker has its own package and lockfile.
- Worker routes, schedules, KV bindings, and public variables live in each
  `wrangler.toml`.
- Real secrets are configured out of band and are never project files.
- `public/_redirects` provides the Cloudflare Pages SPA fallback.
