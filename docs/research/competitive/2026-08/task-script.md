# Unified Competitive Task Script

Run the same script against each fixed version in `sources.md`. Record the
result before moving to the next task. Do not repair the source fixture during a
run; record whether the product explains the repair and whether the corrected
row can be re-imported safely.

## Environment

- Desktop: 1440px wide, keyboard and pointer available.
- Mobile: 390px wide, touch emulation or a real mobile viewport.
- Accessibility pass: keyboard-only traversal and reduced-motion preference.
- Data: the files under `fixtures/`, always from a fresh isolated profile/file.
- Timing: measure from the first visible import action to the final receipt.

## Tasks

| ID | Task | Required observation |
|---|---|---|
| T01 | First launch | Product structure, empty state, account/file setup, privacy language, and time to first useful screen |
| T02 | Full import | File selection, format detection, mapping, asset confirmation, row preview, errors, confirmation, receipt, and rollback behavior |
| T03 | Re-import | Exact duplicate file creates zero new records and explains every skipped row |
| T04 | Incremental import | New rows append without changing existing rows; source identity remains visible |
| T05 | Source replacement | Replace one source only; manual rows and another source remain unchanged; failure is atomic |
| T06 | Ledger audit | Holdings, cash, average cost, partial sell, dividend/DRIP, interest, withdrawal, tax, fee, same-day order, and precision |
| T07 | Performance | XIRR/IRR, TWR/TTWROR, benchmark, period selection, method explanation, and data freshness |
| T08 | Repair and export | Edit, delete, export, backup, restore, and whether exported data round-trips |
| T09 | Public view | Share/public mode, fields exposed, absolute amount leakage, revocation, and stale cache behavior |
| T10 | Responsive and keyboard | Desktop/mobile layout, 390px overflow, focus order, focus visibility, error recovery, and reduced motion |

## Row Outcome Record

For every source row record exactly one of `import`, `duplicate`, `ignore`, or
`block`, plus:

- source row number;
- normalized activity and ticker;
- reason shown by the product;
- whether the row is visible before confirmation;
- whether the row is persisted after confirmation;
- whether the outcome can be independently audited later.

## Error Cases

The common fixture includes an exact duplicate, malformed date, malformed
number, unsupported action, non-USD row without an explicit USD settlement, and
an amount that differs from quantity times price by a sub-cent amount. Record
whether the product blocks, warns, or silently changes each case.

## Timing and Scoring Notes

Measure task completion separately from explanation time. A product gets credit
for an explanation only when a new user can find it in the normal workflow; a
fact that requires source code or a database query is not a user-facing
explanation.
