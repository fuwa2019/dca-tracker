# Workspace Migration Task

Status: in progress

## Objective

Move the complete repository from the Documents location to the Workspace
location while preserving Git history, refs, current work, recovery material,
and compatibility for the former path.

## Safety Constraints

- Keep source, backup, bundle, old-directory copy, and compatibility link until
  all core checks pass.
- Do not read or copy real environment files, tokens, private financial imports,
  or local secrets.
- Clean registered worktrees only through Git.
- Do not deploy or modify production systems.
- Do not overwrite or merge an existing destination.

## Execution Record

The detailed, append-only execution record is:

`docs/migration/2026-07-27-workspace-migration.md`

The final report will be:

`docs/migration/2026-07-27-workspace-migration-report.md`

## Acceptance

- Source backup and readable complete Git bundle.
- Protected pre-existing code changes.
- Standard project-owned Codex/Claude knowledge.
- Matching source and destination Git state.
- No remaining active old-path references, except explicit historical records.
- CI-equivalent checks, local build, and smoke test pass.
- Codex-only, Claude-only, and combined entry paths are self-contained.
- Old path resolves through a non-circular compatibility symlink.
- All rollback material remains available.
