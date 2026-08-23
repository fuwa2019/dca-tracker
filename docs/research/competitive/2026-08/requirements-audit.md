# Objective Evidence Audit

Audited: 2026-08-18

This is an evidence ledger for the full competitive-research and six-month
objective. `proved` means current repository/runtime evidence covers the stated
scope. `partial` means a meaningful local slice exists but the full requirement
is not proven. `missing` means no current evidence is sufficient.

| Requirement | Status | Current evidence | Missing proof |
|---|---|---|---|
| Product remains one private single ETF portfolio | proved | `PRODUCT.md`, `DESIGN.md`, scope tests and no account-expansion code | none for this boundary |
| Fixed Ghostfolio/Wealthfolio/Portfolio Performance versions recorded | proved | `sources.md`, release links, drift notes | none for source snapshot |
| Fixed-version first launch/import/re-import/ledger/performance/share/mobile study | partial | Ghostfolio S1 through T10 partial plus authenticated Demo home/portfolio/activities/account routes at 390x844, no-overflow measurements, tablist keyboard route cycle and reduced-motion stylesheet evidence; Wealthfolio S1 T01-T04,T06-T08 plus T05/T09 capability checks, narrow native Activities/Appearance layouts, keyboard paths and source breakpoint scan; Portfolio Performance T01-T09 desktop plus a 392x700 native narrow capture showing clipped columns; fixed DMGs and local screenshots | Ghostfolio header/menu full keyboard traversal, reduced-motion emulation and non-empty authenticated ledger state; Wealthfolio runtime reduced-motion and full cross-route keyboard audit; Portfolio Performance responsive remediation/keyboard/reduced-motion evidence and public-share comparison; absent Wealthfolio source-replacement/public-share capabilities are recorded but cannot satisfy positive workflow coverage |
| 100-point scorecard and tie-break rule | proved | `scorecard.md` | observed product scores |
| Synthetic ledger covers required events and errors | proved | canonical ledger, ordinary-close prices, Schwab/IBKR/TradingView fixtures, fixed-point verifier | none for fixture shape |
| `PortfolioImportAdapter` contract | proved | `src/lib/import/types.ts`, `common.ts` | persistence integration |
| Schwab/IBKR/TradingView parsing and normalization | partial | adapter regression, official IBKR English/Chinese-shaped fixtures, TradingView round-trip | full provider exports and ETF classification policy against fixed apps |
| Unified preview with four row states and reconciliation | partial | `PortfolioImportTools`, Playwright desktop/390px checks, fixed-point reconciliation | cloud-enabled RPC run and production migration |
| `append` idempotency | proved locally | local PostgreSQL 15.19 RPC run: repeat append added zero and returned unchanged rows | Supabase `main` remains on legacy schema until separately authorized |
| `replace_source` isolation | proved locally | local PostgreSQL 15.19 run preserved manual and IBKR rows while replacing TradingView rows | Supabase `main` remains on legacy schema until separately authorized |
| `reset_all` atomic rollback | proved locally | forced oversell in local PostgreSQL rolled back transactions and cashflows | Supabase `main` remains on legacy schema until separately authorized |
| `cashflows` V2 fields and event kinds | proved locally | all 52 repository migrations applied through `0050`; columns, constraints and triggers inspected | `main` schema equivalence after an authorized migration |
| Auth/RLS/advisory-lock RPC | proved locally, scope-limited | two local `authenticated` sessions, owner RLS isolation, advisory lock contract and generic RPC invocation passed | Cloud JWT/RLS behavior on `main` after an authorized release |
| V2 cash/NAV/XIRR/TWR formulas | partial | pure `ledgerTwr`, cash balance, ledger XIRR, independent formula reconciliation, local cache invalidation, and PP 0.86.0 cash/performance/XML evidence | exact PP TTWROR/XIRR comparison with quote history and matched period boundaries |
| V1 remains default and V2 is gated | proved | `VITE_LEDGER_IMPORT_V2=0`, method documentation, old cloud path retained | release migration after authorization |
| Dashboard/share use the same V2 cache without amount leakage | missing | existing V1 privacy architecture remains intact; Ghostfolio share snapshot is recorded separately, while Wealthfolio and Portfolio Performance fixed-build navigation/source checks exposed no public-share flow | V2 cache/RPC implementation, privacy snapshot and anonymous share test |
| WCAG 2.2 AA for all named routes | partial | Product side (2026-08-20, `docs/accessibility/2026-08-20-wcag-route-audit.md`): axe-core 4.10.2 over nine routes x desktop/390px x light/dark returns zero violations after the fixes in that record; forward/reverse Tab traversal on every locally renderable route hits only interactive elements with a visible focus ring; reduced-motion emulation leaves opacity-only change on all routes; 320px reflow and the 24x24 target-size minimum both hold. Extended 2026-08-23 (sections 7 and 8 of the same record): the settings surface became seven routes and re-scanned at zero violations over 28 scans; 2.4.11 focus-not-obscured was measured for the first time over 691 focus stops on 14 routes at three widths, found failing at 390px behind the fixed bottom nav on 8 stops, fixed with a scroll-margin rule, and re-measured at zero failures and zero partially obscured stops. Competitor side: Ghostfolio authenticated Demo routes have no 390px overflow and its tablist route cycle is keyboard-operable; Wealthfolio narrow Activities/Appearance layouts expose forward/reverse Tab traversal, visible focus state and keyboard access to visible controls; Portfolio Performance narrow capture exposes clipped columns and no distinct focus state | Screen-reader pass and the cloud-only states (`/cashflows`, a populated `/share/:token`, the authenticated login flow); Ghostfolio header/menu keyboard and reduced-motion emulation; native reduced-motion runtime evidence and Portfolio Performance keyboard/responsive remediation |
| Performance/Lighthouse/compatibility gates | missing | production build passes | Lighthouse runs, budgets and cross-browser evidence |
| No production DB/deploy/real brokerage file changes | proved | Supabase read-only preflight, production migration list, no auth import, feature flag off | none for current turn |

## Study Decision

The competitive-research objective is closed for this study window under the
explicit no-macOS-change boundary. The evidence table preserves partial or
missing statuses where the products or the environment did not provide proof;
those are research findings, not implied passes. Migration `0050`, production
database changes, performance-method switching and deployment remain separate
authorized release gates.
