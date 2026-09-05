# Portfolio Ledger Design Baseline

Status: baseline draft, 2026-08-18

## Design Direction

Portfolio Ledger should feel like a quiet financial workbench: dense enough for
reconciliation, calm enough for long-term review, and explicit about uncertain
data across brokers, currencies, and markets. The current editorial dashboard
is a useful implementation baseline, but
the research phase may replace its navigation, visual hierarchy, and dashboard
composition.

Superseded on 2026-08-20 by
`docs/decisions/2026-08-20-wealthfolio-ui-alignment.md`: the frontend now
follows Wealthfolio's interface language as closely as practical — information
architecture, interaction, composition, and the spacing/radius/type/color
scales — reimplemented in this repository rather than copied. Wealthfolio's
AGPL-licensed code and assets, its name, and its logo stay out of this
project, and the Flexoki palette is taken from its own MIT upstream with
attribution. Ghostfolio and Portfolio Performance remain reference-only. The
measured mapping lives in `docs/design/wealthfolio-ui-teardown.md`.

The accessibility gate below is unchanged and outranks visual fidelity: where a
reference value fails it, this project keeps the accessible value and records
the divergence.

## Information Architecture

The target navigation is task-oriented:

- Overview: current holdings, cash state, data freshness, and a short result
  summary;
- Performance: XIRR, ledger TWR, benchmark, method explanation, and warnings;
- Transactions: searchable ledger, filters, edit/delete, and export;
- Import: source detection, mapping, row review, reconciliation, and receipt;
- Data health: stale prices, incomplete rows, blocked imports, and repair paths;
- Settings: account preferences, source mappings, privacy, and backup;
- Share: a separate, percentage-only public view.

Import is a first-class workflow, not a hidden action inside a transaction page.

## Interaction Rules

- File selection never writes data.
- A preview shows source rows, normalized values, row state, and reconciliation
  totals before confirmation.
- Destructive modes (`replace_source` and `reset_all`) state their exact scope,
  counts, and rollback behavior before confirmation.
- Every asynchronous operation has loading, success, partial, blocked, failure,
  and stale states where applicable.
- Warnings are adjacent to the affected value and have a plain-language cause
  and next action.
- Keyboard focus is visible and never trapped in a non-modal surface.
- Mobile at 390px uses the same task order as desktop; tables may become a
  row-detail list, but no audit field is silently removed.
- Respect `prefers-reduced-motion`; motion must not carry meaning or block a
  task.
- Buttons use familiar icons when the icon is sufficient and provide a text
  label or accessible name for unfamiliar actions.

## State Model

Every important page or panel must design these states before implementation:

1. Empty: explain the next useful action without fabricated metrics.
2. Loading: preserve layout dimensions and identify the pending source.
3. Ready: show values, provenance, and the last known freshness.
4. Partial: identify missing rows, prices, or providers and what remains usable.
5. Warning: show a non-fatal discrepancy with its amount/date/method context.
6. Blocked: prevent commit and identify the exact rows and correction path.
7. Failed: preserve the source preview and confirm that no write occurred.
8. Stale: distinguish cached results from current inputs.

## Accessibility Baseline

The release gate is WCAG 2.2 AA for login, import, overview, performance,
sharing, and settings. The implementation checklist is:

- all workflows complete by keyboard alone;
- logical heading and landmark structure;
- visible focus with sufficient contrast;
- text contrast of at least 4.5:1 for normal text and 3:1 for large text;
- non-text controls and meaningful graphics have accessible names or text
  alternatives;
- status changes use an appropriate live region without stealing focus;
- errors identify the field/row, explain the problem, and preserve the value;
- target controls meet the applicable WCAG 2.2 target-size requirement;
- zoom and 390px layout do not hide warnings, values, or actions;
- reduced motion removes non-essential transitions and animated number effects;
- charts expose a textual summary or table for the same decision-relevant data;
- color is never the only indication of gain, loss, warning, or blocked state.

## Reference Selection

The main-interface reference is selected only after the fixed-version study.
Score task efficiency, interface quality, and state completeness from the
research records. Break ties by task completion time, 390px behavior, and
keyboard experience. If still tied, use Wealthfolio as the tie-break reference.

Current research decision (2026-08-18): adopt Wealthfolio `v3.6.2` as the
interaction and information-architecture reference. Its fixed synthetic run
led the weighted matrix at 71 points, and its narrow native layout reflowed
without horizontal clipping while keyboard focus reached visible controls.
Portfolio Performance remains the calculation and explanation reference. This
decision is not a WCAG, reduced-motion, or financial-reconciliation pass.
