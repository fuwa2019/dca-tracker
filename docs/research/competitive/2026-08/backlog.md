# Six-Month Backlog

This backlog follows the fixed priority order and keeps each phase independently
releasable.

| Phase | Weeks | Deliverables | Release gate |
|---|---:|---|---|
| Product baseline | 1-2 | Complete fixed-version study; update `PRODUCT.md` and `DESIGN.md`; select reference; freeze WCAG and privacy baseline | Research records and scorecard have S1-S3 evidence |
| Trusted import | 3-8 | `PortfolioImportAdapter`; Schwab, IBKR, TradingView adapters; source detection; mapping; row statuses; duplicate identity; `append`; `replace_source`; atomic receipt | Three-format synthetic fixture, import atomicity, precision, and migration/RLS tests |
| Financial ledger | 9-14 | Cash event contract; dividends, interest, withdrawals, taxes, fees; `ledger_twr_v2`; XIRR boundary; ordinary close prices; PP reconciliation | One-basis-point reconciliation and old-data V1 regression |
| Interface rebuild | 15-19 | Task-oriented navigation; import workflow; transaction audit; data health; overview/performance/settings; mobile and keyboard pass | Playwright desktop/mobile, reduced-motion, and WCAG checks |
| Analysis and release | 20-24 | Return composition, fees/taxes, drawdown, target drift, privacy-safe share redesign, documentation and performance gates | Privacy snapshot, Lighthouse budget, compatibility check, release checklist |

Each phase must run the existing CI-equivalent checks. Production migration,
performance-method switching, and deployment require separate authorization.
