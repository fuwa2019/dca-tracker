# Development Runbook

## Install

Use npm and committed lockfiles:

```bash
npm ci
npm ci --prefix workers/quote
npm ci --prefix workers/email-cron
```

Do not replace the package manager or upgrade major dependencies as part of an
unrelated task.

## Run

Cloud-connected development:

```bash
npm run dev
```

Offline demo:

```bash
npm run dev:local
```

Local mode is read-only and must not be enabled in the production Pages
environment.

## Verify

CI-equivalent checks:

```bash
npm run test:finance
npm run test:email-reminder
npm run test:quote-status
npm run typecheck
npm run build
```

When changing local mode:

```bash
npm run build:local
```

When changing UI behavior:

```bash
npm run test:ui
```

There is no lint script.

## Smoke Test

Start a local Vite server and verify:

- the root document responds;
- static assets load;
- the SPA fallback works for a deep route;
- local mode opens without Supabase or Worker access when that mode is under
  test;
- no credentials or private user data appear in logs.

Use browser screenshots for layout-sensitive changes at desktop and mobile
sizes. Stop the server after verification.

## Failure Handling

Determine whether a failure existed before the current change. Fix only
in-scope regressions. Record the command, concise error, attempted remedies,
and remaining risk when a failure cannot be resolved safely.
