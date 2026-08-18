# DCA Tracker Competitive Research

Status: fixed-version S1 study window closed on 2026-08-18 under the explicit
no-macOS-change boundary. Desktop, narrow-window, keyboard and capability
evidence are recorded; unavailable reduced-motion emulation and native focus
surfaces remain explicitly labeled limitations.

## Purpose

Compare Ghostfolio, Wealthfolio, and Portfolio Performance against the needs of
a precise, restrained, transparent single-portfolio ETF ledger. The study is
research, not a feature checklist. It records observed behavior, calculation
reconciliation, accessibility evidence, and explicit adopt/reject decisions.

## Isolation Rules

- Use fixed application versions listed in `sources.md`.
- Use separate temporary profiles or files for each product.
- Use only the synthetic fixtures under `fixtures/`.
- Never open, upload, import, or export a real brokerage file.
- Do not use a personal account, production database, or private share token.
- Keep screenshots and screen recordings in local research artifacts, not in
  this repository. The committed screenshot index stores paths and evidence
  notes only.

## Evidence Levels

- `S0`: official release or documentation; describes intended behavior only.
- `S1`: fixed-version build observed in an isolated run.
- `S2`: repeatable result from the common synthetic ledger.
- `S3`: independent calculation or exported artifact that reconciles the result.

An S0 source cannot be used as proof that a UI workflow works. An S1 UI result
cannot be used as proof that a financial result is correct without S2/S3 data.

## Artifacts

- `sources.md`: fixed versions, URLs, hashes/identifiers, and access date;
- `task-script.md`: the same task sequence for all three products;
- `observations.md`: run-by-run task record, currently initialized as not run;
- `requirements-audit.md`: requirement-by-requirement evidence and missing proof;
- `scorecard.md`: weighted 100-point matrix and scoring rules;
- `reconciliation.md`: canonical ledger and independent calculation contract;
- `screenshot-index.md`: local screenshot evidence without bulk image commits;
- `decisions.md`: adopted and rejected patterns with evidence levels;
- `backlog.md`: six-month implementation sequence and release gates;
- `fixtures/`: synthetic events and format-shaped files shared by the study.

## Current Findings Boundary

The source snapshot supports the initial hypotheses in `decisions.md`. It does
not yet claim that the fixed applications have passed the full task script,
that their calculations agree with the canonical ledger, or that their mobile
and keyboard behavior meets WCAG 2.2 AA. Those claims require S1-S3 records.
