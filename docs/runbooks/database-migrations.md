# Database Migration Runbook

## Rules

- Never edit an applied migration.
- Add the next migration file for schema, RPC, RLS, policy, trigger, or function
  changes.
- Prefer idempotent statements where they are compatible with the intended
  change.
- Review security-definer functions and grants explicitly.
- Do not run a production migration without explicit authorization.

## Development Flow

1. Read the current migration tail and all callers affected by the change.
2. Add a new migration under `supabase/migrations/`.
3. Verify filename order and update `supabase/README.md` if the latest bound
   changes.
4. Apply to a development project or fresh local database.
5. Verify RLS, function grants, and expected rows.
6. For performance changes, run:

```bash
npm run test:finance
```

7. Run `supabase/performance_cache_verify.sql` against the development project
   when the performance cache contract changes.
8. Run typecheck and build for changed client/RPC contracts.

## Performance Cache Backfill

Price backfill must synchronously persist `daily_prices` before refreshing the
performance cache. After refresh, refetch price coverage, performance status,
and portfolio history.

## Share Privacy Review

For every public RPC change, confirm that the response contains no absolute
amounts, cashflows, transaction data, exchange loss, contact details, or values
that can reconstruct private amounts.
