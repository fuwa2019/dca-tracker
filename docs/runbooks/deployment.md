# Deployment Runbook

Production deployment requires explicit user authorization. A successful build
or this runbook does not grant permission to deploy.

## Browser SPA

From the repository root:

```bash
npm ci
npm run test:finance
npm run test:email-reminder
npm run test:quote-status
npm run typecheck
npm run build
```

Publish `dist/` through the existing Cloudflare Pages project or Git integration.
Keep `public/_redirects` in the build for SPA deep links. Configure public
`VITE_` values through the Pages environment, never by committing a real
environment file.

The production Pages project uses Git integration so its build environment can
inject the required `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
`VITE_QUOTE_WORKER_URL` values. Do not direct-upload a locally built `dist/`
unless those variables were present during that build and the resulting login
page has been checked for the missing-Supabase-config warning. A Vite build
without them succeeds but falls back to the local stub and breaks production
authentication.

## Quote Worker

```bash
npm ci --prefix workers/quote
npm run typecheck
cd workers/quote
npm run deploy
```

Review `workers/quote/wrangler.toml` before deployment, especially CORS,
schedules, bindings, and provider selection. Worker credentials and OAuth data
must remain Cloudflare secrets or KV state.

## Email Worker

```bash
npm ci --prefix workers/email-cron
npm run test:email-reminder
npm run typecheck
cd workers/email-cron
npm run deploy
```

The manual `/run` endpoint and `force` behavior are privileged operations.
Testing must account for both KV and `email_log` deduplication.

## Supabase

Apply only new migrations in repository order. Verify the target environment,
current migration state, RLS, RPC grants, and rollback/forward-fix plan before
running SQL.

## Post-Deployment Checks

- Pages root and deep links load.
- Quote Worker health and representative market-data routes respond.
- Authenticated performance status and public share sanitization remain valid.
- Email Worker schedule is restored after any authorized schedule test.
- No secret, token, or private data was written to source control or logs.
