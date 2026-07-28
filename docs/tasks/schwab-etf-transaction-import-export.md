# Schwab ETF Transaction Import and Export

## Scope

- Add browser-only parsing for Schwab transaction CSV/TSV exports.
- Import confirmed ETF `Buy`/`Sell` rows and positive Schwab deposits.
- Recognize `Wire Received`, `MoneyLink Transfer`, and other supported transfer
  actions; ignore outbound transfers, dividends, reinvestments, and taxes.
- Support append-only import and atomic strict ETF/deposit reset/import.
- Export confirmed ETF trades and Schwab deposits in the same eight-column
  Schwab format.
- Preserve application metadata for matching transactions only in append mode.
- Include transaction fees in private portfolio calculations.

## Database Contract

- Migration: `0043_schwab_transaction_import.sql`.
- Add transaction fee, source description, import source, and import key fields.
- Add a broker-deposit cashflow kind without inventing CNY amounts or exchange
  rates; imported deposits remain excluded from exchange-loss calculations.
- Enforce per-user import-key uniqueness.
- Expose an authenticated, security-invoker import RPC.
- Derive ownership from `auth.uid()` and rely on transaction RLS.
- Match existing manual cashflows by USD date and amount to avoid double
  counting and retain Schwab source identity for complete re-export.
- Strict reset removes every confirmed ETF transaction and every
  Schwab-imported broker deposit before rebuilding the file. Matching
  transaction IDs, kinds, notes, and batches are intentionally not retained.
- Keep all public-share responses unchanged.

## Safety

- Do not read or commit real brokerage exports.
- Use synthetic fixtures in tests.
- Do not apply the migration or deploy without separate authorization.
- Reset mode may delete only symbols explicitly confirmed as ETFs and
  Schwab-imported broker deposits. Individual stocks and manual cashflows are
  always preserved.
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
- The frontend is deployed through the existing Cloudflare Pages Git
  integration so the production build receives its configured `VITE_*`
  variables. A direct upload of a local build without those variables is not a
  valid production release.
- No real Schwab export was read or imported during deployment.
