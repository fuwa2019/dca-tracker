# Competitive Scorecard

Total: 100 points

Score each category from 0 to 5, then multiply by the category weight divided
by 5. Do not award points from a feature list alone; cite a task or exported
artifact for every non-zero score.

| Category | Weight | What earns a high score |
|---|---:|---|
| Calculation accuracy and explainability | 30 | Independent ledger reconciliation, correct treatment of internal/external flows, clear XIRR/TWR definitions, visible method and freshness |
| Import, preview, and reconciliation | 25 | Reliable detection and mapping, row-level status, duplicates, source replacement, atomic failure, and audit receipt |
| Task efficiency | 20 | Low time and few decisions for first import, repair, re-import, export, and performance review |
| Interface consistency, mobile, and WCAG 2.2 AA | 15 | Stable hierarchy, no 390px loss of audit fields, keyboard completion, focus/error states, reduced-motion support |
| Privacy, export, and data ownership | 10 | Local or user-controlled data, complete export/backup, clear public boundary, no absolute amount leakage |
| **Total** | **100** | |

## Tie Break

The main-interface reference is the highest score for task efficiency plus
interface quality plus state completeness. Ties are resolved by:

1. shorter standard first-import completion time;
2. stronger 390px mobile result;
3. stronger keyboard-only result;
4. Wealthfolio.

## Evidence Table

| Product | Calculation /30 | Import /25 | Efficiency /20 | UI + AA /15 | Privacy /10 | Total | Evidence complete? |
|---|---:|---:|---:|---:|---:|---:|---|
| Ghostfolio 3.36.0 | 6 | 10 | 8 | 6 | 6 | **36** | partial: authenticated Demo 390px routes and tablist keyboard cycle verified; header/menu keyboard, reduced motion and non-empty ledger state pending |
| Wealthfolio v3.6.2 | 18 | 20 | 16 | 9 | 8 | **71** | partial: narrow 390 logical layout and visible keyboard paths verified; reduced-motion/full cross-route keyboard were unavailable in this environment; T05/T09 not provided |
| Portfolio Performance 0.86.0 | 24 | 15 | 12 | 6 | 10 | **67** | partial: 392px capture shows clipped columns; no public-share route; keyboard/reduced-motion focus evidence unavailable; quote-history reconciliation remains a separate calculation limitation |

## Dated S1/S3 Rationale

These scores are a dated working result from the fixed synthetic runs. They
are not a claim that a missing feature is equivalent to a passing workflow.
The raw score is on a 0-5 scale; the table above applies the category weight.

| Product | Evidence-backed rationale |
|---|---|
| Ghostfolio 3.36.0 | T02 exposed a JSON preview but omitted first-class deposit, withdrawal and tax types; T03 created a second account and eight extra orders on exact re-import; T07 lacked a visible IRR method explanation; T09 hid USD amounts but exposed manual UUIDs; T10 hid audit columns at 390px and had compact controls without accessible text, while the authenticated empty Demo home/portfolio/activities/account routes fit 390px and its tablist ArrowRight/Enter cycle was keyboard-operable. |
| Wealthfolio v3.6.2 | T02/T03 exposed five import steps, row errors, duplicate warnings and a final receipt; T03 added zero records on repeat and T04 appended one incremental row with a saved mapping; T06/T07 exposed holdings, income and metric explanations but warned about inferred flows and unpriced positions; T08 provided CSV/JSON/SQLite export and restore warning; T05/T09 navigation found no source-replacement or public-share action; T10 Activities keyboard traversal, reverse traversal and row-menu entry were directly observed. |
| Portfolio Performance 0.86.0 | T02/T04/T05 imported the 11-entry synthetic ledger across securities and cash accounts; T03 repeat stayed at 11 entries; T07 exposed TTWROR, IRR and a gain/income/fee/tax/transfer breakdown; T08 produced `.portfolio` and XML artifacts; T09 File/Online menus exposed only local export and quote updates; T10 at 392px clipped table columns and kept a fixed sidebar, while keyboard/reduced-motion evidence remains incomplete. |

Current interface reference: **Wealthfolio v3.6.2** at 71 points, four points
ahead of Portfolio Performance. Wealthfolio's narrow layout and keyboard path
are directly observed, while Portfolio Performance's `392x700` run clips
columns. Portfolio Performance remains the calculation/explanation reference;
the interface decision does not claim full WCAG, reduced-motion or financial
reconciliation completion.

## Scoring Guardrails

- Official documentation is context, not UI evidence.
- A visually polished flow cannot compensate for an unreconciled ledger.
- A correct calculation with no explanation cannot receive full accuracy points.
- A public share that leaks absolute values receives zero privacy points for that
  subcriterion.
- Missing evidence is scored as unknown, not as a pass.
