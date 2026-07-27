# Current Handoff

Updated: 2026-07-27

## Current Goal

Standardize the repository's shared project knowledge and migrate the complete
working repository from the Documents path to the Workspace path without losing
Git history, refs, current work, or rollback capability.

## Git State

- Branch: `backup/pre-workspace-migration-20260727`
- Protected source checkpoint:
  `bc9a977c9a8e1fa68cda70d4ef354d95193e23ca`
- Project knowledge standardization:
  `d006848a047f3cb04be5cf52f48d48fc0cb7fd17`
- The checkpoint commit protects the three pre-existing dashboard/calendar
  source changes.
- A small record-only commit follows the standardization commit so the
  migration log can name it.

## Completed

- Read-only repository, Git, documentation, configuration, and worktree audit.
- Full code/repository backup with sensitive local material excluded.
- Complete Git bundle verified with all refs.
- Two clean, reachable Codex worktrees removed through Git and pruned.
- Pre-existing source work protected on a dedicated branch and checkpoint
  commit.
- Project knowledge standardized and committed.
- External Codex artifact candidates reviewed; no unique verified artifact
  required import.

## Current Blockers

None.

## Next Steps

1. Copy the repository into the empty Workspace destination.
2. Compare Git state and run `git fsck --full`.
3. Repair old path references in the project and DCA-specific user skills.
4. Run CI-equivalent checks, local-mode build, and a local smoke test.
5. Verify Codex-only, Claude-only, and combined entry paths.
6. Switch the old path to a compatibility symlink only after core checks pass.
7. Write the final report and preserve all rollback material.

## Related Files

- `docs/migration/2026-07-27-workspace-migration.md`
- `docs/tasks/workspace-migration.md`
- `PROJECT.md`
- `AGENTS.md`
- `CLAUDE.md`

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

The migration also requires a local server smoke test and explicit Git
comparison between the source and destination repositories.
