# Current Handoff

Updated: 2026-08-05

## Current Goal

Fix the Schwab CSV cash reconstruction at its source: use the broker-settled
`Amount` for imported transactions and keep excluded-stock funding on the stock
trade date instead of reducing an earlier deposit.

## Current Status

- Repository: `/Users/junxihuo/Documents/dca_system`, branch `master` tracking
  `origin/master`.
- The root-cause fix is implemented locally and remains uncommitted.
- Schwab transaction `Amount` is parsed as before and now persists in nullable
  `transactions.settled_amount_usd`. Private cash, cost basis, realized proceeds,
  TWR cache generation, and sanitized share percentages prefer that settled
  value. Manual and six-column Portfolio CSV trades retain the existing
  quantity-times-price plus/minus fees fallback.
- Recognized Deposit rows keep their original amount and date. Excluded-stock
  net funding is represented by a negative `stock_allocation` cashflow on the
  actual stock trade date. Account cash, invested capital, XIRR, export, and
  re-import all understand that event.
- New append-only migration
  `0047_schwab_settled_cash_and_stock_allocations.sql` adds the column and
  constraint, extends the existing owner-protected `cashflows` table, and
  replaces the four-argument import RPC without changing its signature. The RPC
  remains security-invoker, derives ownership from `auth.uid()`, and grants
  execution only to `authenticated`.
- Old clients that send `deposit_date` remain accepted. New stock allocations
  require `reset_all`; append and legacy `reset_etf` remain available for
  rolling-deploy compatibility.
- The import preview now reports original deposits, dated stock allocations,
  net ETF funding, ending cash, and real incomplete-cash warnings. Export writes
  `Stock Allocation` extension rows so the application backup round-trips.
- Synthetic regression coverage fixes the former `-$0.0002015` false warning:
  a `$922.75` deposit and source trade `Amount` totaling `-$922.75` now produce
  `$0.00` minimum and ending cash despite a `$922.7502015` recomputed notional.
- A separate timing fixture proves a June 17 stock allocation is not moved back
  to June 5; any unresolved `-$99.93` cash gap appears on June 17.
- Final local verification passed: `test:csv-import`, `test:finance`, `test:ui`,
  `test:migration-numbering`, `test:email-reminder`, `test:quote-status`,
  `typecheck`, `build`, and `git diff --check`.
- Playwright local-mode checks passed at desktop and 390px mobile widths. The
  six metrics, original deposit, dated allocation, and second reset-confirmation
  counts rendered without overlap; the final import action was not executed.
- The user-provided real CSV was not read, copied, or imported.

## Production State

- Production currently contains migrations through
  `0046_adjusted_deposit_precision.sql`; migration `0047` has not been applied.
- The live frontend still contains the earlier non-blocking-warning mitigation.
  The local root-cause fix has not been committed, pushed, or deployed.
- No production database, Cloudflare deployment, secrets, or user data changed
  during this task.

## Next Steps

1. With separate production authorization, apply migration `0047` first and
   verify schema, RPC privileges, RLS behavior, and Advisors.
2. Only after the migration succeeds, commit/push and deploy the frontend, then
   verify the canonical bundle and a synthetic browser preview.
3. Leave the actual `reset_all` import to the user's separate confirmation; it
   is a destructive data operation and is not part of deployment verification.

## Risks and Boundaries

- Full reset deletes all current-user transactions, cashflows, and funding
  batches before rebuilding ETF trades and imported cash events. Any validation
  or write error must roll back the whole RPC transaction.
- Dividends, interest, withdrawals, taxes, and unsupported cash events remain
  omitted. They can still cause a genuine dated cash warning; no balancing
  deposit is invented.
- Public share responses remain percentage-only. The new absolute settled and
  allocation amounts stay behind existing owner RLS and are not added to public
  JSON contracts.
- Migration `0047` dynamically patches the currently deployed performance and
  share functions and should be applied transactionally before the frontend.

## Related Files

- `PROJECT.md`
- `docs/PERFORMANCE_SPEC.md`
- `docs/tasks/schwab-etf-transaction-import-export.md`
- `src/lib/schwabTransactions.ts`
- `src/lib/calc/transactionAmounts.ts`
- `src/components/SchwabTransactionTools.tsx`
- `supabase/migrations/0047_schwab_settled_cash_and_stock_allocations.sql`
