# 2026-10-13 overview goal progress from observed deposits

Scope: SPA only. No migration, Worker, secret, or database change. Owner
authorized commit and release.

## Change

- `src/lib/calc/contributionPace.ts` (pure): monthly contribution from the
  ledger's external cash flows over the last 12 months, or from the first
  deposit for a younger ledger (first deposit is opening capital, excluded).
  Withdrawals offset; under 30 days of history gives no estimate.
- Overview「目标进度」feeds that pace, not `settings.monthly_dca_usd`, into the
  QQQM goal simulation, and shows「近 N 个月实际入金 ≈ $X/月 · 入金 M 次」.
- The settings goal planner and the reminder email Worker are unchanged.

## Verification

- `test:finance` (new pace assertions in `verify-goal-probability.mjs`),
  email-reminder, quote-status, share-privacy, UI, typecheck, offline build,
  and budget (183.46 / 194 KiB gzip) passed.
- Bundled demo data in the in-app browser: pace line and P50 / 20-year figures
  render, 375px has no horizontal overflow, no console errors.
