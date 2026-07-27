# DCA Tracker

DCA Tracker is a private React PWA for tracking a long-term US ETF portfolio.
It combines transactions and cashflows with market data to report holdings,
account NAV, XIRR, cached TWR performance, benchmark comparisons, data health,
and sanitized read-only share links.

## Architecture

The project has three deployables:

- a React/Vite SPA on Cloudflare Pages;
- `workers/quote`, a Cloudflare Worker for market data, price persistence, and
  scheduled performance-cache refresh;
- `workers/email-cron`, a Cloudflare Worker for monthly funding reminders.

All three use one Supabase project for Auth, Postgres, RLS, and RPCs. The quote
Worker uses Schwab Market Data with Yahoo-compatible/fallback paths. The email
Worker sends through Resend.

See [PROJECT.md](./PROJECT.md) and
[docs/architecture/system-overview.md](./docs/architecture/system-overview.md)
for the maintained system description.

## Quick Start

```bash
npm ci
npm ci --prefix workers/quote
npm ci --prefix workers/email-cron
npm run dev
```

Use the public variable names documented in `.env.example`; keep real values in
an ignored local environment file. Never commit Worker secrets, OAuth tokens,
database credentials, or private portfolio imports.

Offline demo mode does not connect to Supabase or the quote Worker:

```bash
npm run dev:local
```

## Verification

```bash
npm run test:finance
npm run test:email-reminder
npm run test:quote-status
npm run typecheck
npm run build
```

There is no lint script. CI installs the root and both Worker lockfiles and runs
the same checks.

## Documentation

- [PROJECT.md](./PROJECT.md): stable project facts and constraints
- [AGENTS.md](./AGENTS.md): shared agent rules
- [HANDOFF.md](./HANDOFF.md): current unfinished work
- [docs/PERFORMANCE_SPEC.md](./docs/PERFORMANCE_SPEC.md): performance contract
- [docs/LOOKTHROUGH_SPEC.md](./docs/LOOKTHROUGH_SPEC.md): exposure contract
- [docs/architecture/](./docs/architecture/): system design
- [docs/decisions/](./docs/decisions/): accepted technical decisions
- [docs/tasks/](./docs/tasks/): active complex-task briefs
- [docs/runbooks/](./docs/runbooks/): development, migration, and deployment
- [references/index.md](./references/index.md): reviewed external documentation
- [supabase/README.md](./supabase/README.md): database setup and RLS overview
- [workers/quote/README.md](./workers/quote/README.md): quote Worker
- [workers/email-cron/README.md](./workers/email-cron/README.md): email Worker

Production deployments and production database changes require explicit
authorization.
