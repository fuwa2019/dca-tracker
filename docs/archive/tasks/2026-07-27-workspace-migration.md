# Workspace Migration Task

Status: completed
Completed: 2026-07-27

## Objective

Move the complete repository from the Documents location to the Workspace
location while preserving Git history, refs, current work, recovery material,
and compatibility for the former path.

## Background

The project previously lived under a Documents path while active Codex work
expected Workspace as the canonical root. Project knowledge was split across
duplicated or stale AI-specific files, and pre-existing source changes needed
protection before any path migration.

## Allowed Change Scope

- Audit and standardize repository-owned project knowledge.
- Protect pre-existing source work in Git.
- Create sanitized recovery material.
- Copy and verify the repository at the Workspace path.
- Repair active DCA-specific path references.
- Replace the former path with a verified compatibility symlink only after all
  acceptance checks passed.

## Prohibited Change Scope

- Keep source, backup, bundle, old-directory copy, and compatibility link until
  all core checks pass.
- Do not read or copy real environment files, tokens, private financial imports,
  or local secrets.
- Clean registered worktrees only through Git.
- Do not deploy or modify production systems.
- Do not overwrite or merge an existing destination.

## Database Impact

None. No migration was added or applied, and no local or production database
data was changed.

## Deployment Impact

None. The SPA and both Workers were verified locally or by dry-run only. No
production deployment, secret update, OAuth flow, or Cloudflare/Supabase
mutation was authorized.

## Execution Record

The detailed, append-only execution record is:

[`docs/migration/2026-07-27-workspace-migration.md`](../../migration/2026-07-27-workspace-migration.md)

The final report is:

[`docs/migration/2026-07-27-workspace-migration-report.md`](../../migration/2026-07-27-workspace-migration-report.md)

## Acceptance Commands

```bash
npm run test:finance
npm run test:email-reminder
npm run test:quote-status
npm run typecheck
npm run build
npm run build:local
git fsck --full
```

The migration also required a local-mode browser smoke test, Worker dry-runs,
Markdown link validation, and explicit Git comparison between the source and
destination repositories.

## Outcome

All acceptance checks passed. The final repository is
`/Users/junxihuo/Workspace/dca_system`, the former Documents path is a
compatibility symlink, and the lightweight tag
`workspace-migration-20260727` identifies the completed migration report.

## Rollback

Use the ordered rollback procedure in the final migration report. Confirm the
compatibility symlink before unlinking it, restore the preserved former
repository as the primary path, and verify Git refs and integrity. Retain the
sanitized directory backup and complete Git bundle until the compatibility and
retention decision is made separately.
