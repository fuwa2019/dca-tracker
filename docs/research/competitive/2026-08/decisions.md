# Adopt / Reject Decisions

Status: preliminary decisions from the official source snapshot. A decision
marked `hypothesis` must be re-evaluated after S1-S3 task evidence.

| Decision | Status | Evidence | Rationale |
|---|---|---|---|
| Keep a row-level import preview and final receipt | adopt | S1 Wealthfolio, S1 Ghostfolio | Wealthfolio exposed five explicit steps, row validity, skipped-row count and a final 13/1 receipt; Ghostfolio exposed a row preview but its re-import receipt was not idempotent |
| Treat source mapping as a reusable, editable object | adopt | S0 | Saved mappings reduce repeat-import work, but the mapping must remain reviewable and versioned |
| Separate account cash from performance cash-flow semantics | adopt | S0, PP TTWROR manual | Portfolio Performance distinguishes external portfolio flows from internal dividend and sale movements |
| Add explicit `ledger_twr_v2` instead of silently changing legacy curves | adopt | project contract | Existing adjusted proxy behavior must remain reproducible for old data |
| Use local export/backup as a product requirement | adopt | S0 | Wealthfolio documents CSV, JSON, and full database backup; DCA Tracker should provide an application-owned export without adding a SaaS dependency |
| Adopt Wealthfolio's full net-worth, budget, liabilities, retirement, and multi-account scope | reject | S0 | It conflicts with the single ETF portfolio boundary |
| Copy any competitor visual language or brand wording | reject | project boundary | Research may transfer information architecture and interaction patterns only |
| Use adjusted close plus explicit dividend events in V2 | reject | PP semantics and project contract | This can count total-return effects twice |
| Make a negative cash warning disappear by inventing a deposit | reject | project financial contract | A missing or unsupported cash event must remain visible and dated |
| Choose the main interface reference now | adopt | S1/S3 partial; scorecard 71 vs 67 vs 36; Wealthfolio narrow/keyboard run and PP 392px run | Adopt Wealthfolio v3.6.2 as the main interface interaction reference: its staged import, duplicate receipt, saved mapping, incremental receipt, narrow layout and visible keyboard path lead the matrix. Portfolio Performance remains the calculation/explanation reference; this decision does not claim either product passes the full WCAG or reduced-motion gate |
| Pin release artifact and image digest, not landing-page defaults | adopt | S0 | Wealthfolio's download page and Ghostfolio's compose image both expose floating/default references that would invalidate cross-product comparison |
| Keep ordinary-close V2 separate from explicit dividend/tax/fee events | adopt | S0 | Wealthfolio v3.6.2 release notes call out dividend-adjusted-history double counting and tax-only activity balance fixes; this supports the no-double-counting boundary |
| Treat CSV empty-column handling as an import regression | adopt | S0 | Portfolio Performance 0.86.0 release notes identify empty-column re-read behavior as a real import edge case |
| Keep row-level duplicate errors and public-share privacy as separate checks | adopt | S1 Ghostfolio, S1 Wealthfolio, S1 PP | Ghostfolio's public view hid absolute amounts but its re-import created duplicate activities; Wealthfolio exposed 13 duplicate warnings and a 0/13/14/14 receipt; PP's repeat import stayed at 11 entries but offered no row-level duplicate receipt |
| Treat stable source/account identity as a release gate | adopt | S1 Ghostfolio, S1 Wealthfolio | Ghostfolio's portable JSON re-import created a second account and eight extra orders; Wealthfolio's saved mapping preserved VGT/SMH identity and its repeat import added zero records |
| Keep unsupported cash events visible instead of remapping silently | adopt | S1 Ghostfolio, S1 Wealthfolio | Ghostfolio lacks first-class withdrawal/tax types, while Wealthfolio mapped both `Taxes and fees` rows to Tax; the importer must show the loss of semantic fidelity |
