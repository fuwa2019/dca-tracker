# Schwab ETF Transaction Import and Export

## Scope

- Add browser-only parsing for Schwab transaction CSV/TSV exports.
- Import confirmed ETF `Buy`/`Sell` rows and positive Schwab deposits.
- Recognize `Wire Received`, `MoneyLink Transfer`, and other supported transfer
  actions; ignore outbound transfers, dividends, reinvestments, and taxes.
- Support append-only import and atomic full portfolio-input reset/import.
- Export confirmed ETF trades and Schwab deposits in the same eight-column
  Schwab format.
- Preserve application metadata for matching transactions only in append mode.
- Include transaction fees in private portfolio calculations.

## Database Contract

- Migrations: `0043_schwab_transaction_import.sql` and
  `0044_full_reset_schwab_import.sql`.
- Add transaction fee, source description, import source, and import key fields.
- Add a broker-deposit cashflow kind without inventing CNY amounts or exchange
  rates; imported deposits remain excluded from exchange-loss calculations.
- Enforce per-user import-key uniqueness.
- Expose an authenticated, security-invoker import RPC.
- Derive ownership from `auth.uid()` and rely on transaction RLS.
- Append mode matches existing manual cashflows by USD date and amount to avoid
  double counting and retain Schwab source identity for complete re-export.
- Full reset removes every transaction, cashflow, and funding batch owned by
  the current user, then rebuilds only the confirmed ETF trades and positive
  deposits from the current file.
- Settings, share links, quotes, daily prices, caches owned by system workflows,
  and other users' rows remain outside the reset scope.
- Keep all public-share responses unchanged.

## Safety

- Do not read or commit real brokerage exports.
- Use synthetic fixtures in tests.
- Do not apply the migration or deploy without separate authorization.
- Full reset intentionally deletes individual-stock transactions, manual
  cashflows, imported deposits, ETF transactions, and funding batches.
- The confirmation must state that only confirmed ETF trades and positive
  deposits in the current file will be rebuilt.
- Any validation, oversell, or write failure must roll back the full import.

## Verification

- Schwab parsing, deposit idempotency, strict reset, and trade/deposit
  round-trip export tests.
- Fee-aware finance fixtures.
- Migration numbering and static database contract checks.
- UI behavior checks, typecheck, and production build.
- Default finance, reminder, and quote-status checks.

## Deployment

- Migration `0043` was applied to production project
  `igwacbeojogblacektxr` in one transaction on 2026-07-28.
- Post-migration checks confirmed the new fields, uniqueness constraints,
  security-invoker RPC, authenticated-only execution, and zero Advisor errors.
- Feature commit `1400798` is on `master`. During rollout, production was first
  restored to verified deployment `09ee772b`, then rebuilt through the Pages
  Git integration after confirming the required production variable names.
- Production deployment `466c30fc-9ba5-464b-9145-794a322f3b98` completed
  successfully from `1400798`. The canonical site serves the new bundle
  without the missing-Supabase-config warning; `/login` and `/transactions`
  both return HTTP 200.
- A direct upload or Git build without the required public `VITE_*` variables
  is not a valid production release even when its routes return HTTP 200.
- No real Schwab export was read or imported during deployment.
- Migration `0044_full_reset_schwab_import.sql` was applied to production as
  version `20260728103203`. Metadata checks confirmed the security-invoker
  wrapper/helper contract and authenticated-only execution.
- Full-reset commit `a459e9f` is on `master`. Production deployment
  `03cc20da-8558-4ead-a8b8-5f31a80c738c` serves `index-C86Or5YJ.js` from the
  canonical site with `reset_all`, the full-reset UI, and the required
  Supabase build configuration.
