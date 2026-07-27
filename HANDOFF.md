# Current Handoff

Updated: 2026-07-27

## Current Goal

Standardize the repository's shared project knowledge and migrate the complete
working repository from the Documents path to the Workspace path without losing
Git history, refs, current work, or rollback capability.

## Git State

- Branch: `backup/pre-workspace-migration-20260727`
- HEAD at the start of standardization:
  `bc9a977c9a8e1fa68cda70d4ef354d95193e23ca`
- The checkpoint commit protects the three pre-existing dashboard/calendar
  source changes.
- The current working tree contains the documentation standardization and
  migration log that will be committed before the repository copy.

## Completed

- Read-only repository, Git, documentation, configuration, and worktree audit.
- Full code/repository backup with sensitive local material excluded.
- Complete Git bundle verified with all refs.
- Two clean, reachable Codex worktrees removed through Git and pruned.
- Pre-existing source work protected on a dedicated branch and checkpoint
  commit.
- Project knowledge standardization is in progress.

## Current Blockers

None.

## Next Steps

1. Complete and verify project documentation and archive stale AI notes.
2. Inspect only directly relevant external Codex artifacts for validated,
   non-duplicate knowledge.
3. Commit the standardization.
4. Copy the repository into the empty Workspace destination.
5. Compare Git state and run `git fsck --full`.
6. Repair old path references in the project and DCA-specific user skills.
7. Run CI-equivalent checks, local-mode build, and a local smoke test.
8. Verify Codex-only, Claude-only, and combined entry paths.
9. Switch the old path to a compatibility symlink only after core checks pass.
10. Write the final report and preserve all rollback material.

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
