# Agent Instructions

## Start Here

1. Read `PROJECT.md` for stable project facts and constraints.
2. Read `HANDOFF.md` for the current task and verified state.
3. Run `git status --short --branch` before changing anything.
4. Confirm the affected application, database, and deployment scope.
5. Inspect the relevant code, tests, migrations, and current configuration.

Do not rely on previous sessions, chat history, external plans, or AI memory as
project truth.

## Safety

- Work inside this repository unless the user explicitly scopes another path.
- Never read, display, copy, or commit real environment files, tokens, cookies,
  private keys, database credentials, private financial imports, or user data.
- Preserve unrelated working-tree changes.
- Do not use destructive Git or filesystem commands.
- Do not deploy, rotate secrets, run OAuth, or change production databases
  without explicit authorization for that operation.

## Engineering Rules

- Follow the existing architecture and real directory structure.
- Keep `src/lib/calc/` pure.
- Add a new append-only migration for every database, RLS, trigger, or RPC
  change. Never rewrite an applied migration.
- Preserve public-share privacy: no absolute amounts, cashflows, trades,
  exchange loss, contact details, or private fields. `npm run test:share-privacy`
  enforces the anonymous surface and its payload allowlist; run it after any
  change to a `shared_*` function, an anon grant, or the history cache payload.
- Keep the dashboard and public share performance on the same cached TWR
  contract.
- Do not add a `Database` generic to the shared Supabase client.
- Preserve local-date form defaults and `public/_redirects`.
- Do not introduce or upgrade major dependencies without a concrete need.
- For Cloudflare, Supabase, Schwab, Resend, or other external service work,
  check the project documentation and `references/index.md` before relying on
  provider behavior.

## Verification

Run checks proportional to the change. The default CI-equivalent set is:

```bash
npm run test:finance
npm run test:email-reminder
npm run test:quote-status
npm run test:share-privacy
npm run typecheck
npm run build
```

There is no lint script. Use the scoped checks documented in `PROJECT.md` when
working on UI, market data, symbols, local mode, or long-horizon calculations.
Do not hide a pre-existing failure or expand a migration task into unrelated
refactoring.

## Handoff

Before finishing:

- inspect the final diff and Git status;
- report the modified files, commands run, and verification results;
- state database and deployment impact, including when there is none;
- state unresolved issues and the next concrete step, including when there are
  none;
- update `HANDOFF.md` if unfinished work remains;
- place durable architecture, decision, or operational knowledge under
  `docs/` instead of duplicating it in an AI-specific file.
