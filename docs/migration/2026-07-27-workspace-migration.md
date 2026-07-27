# Workspace Migration Log

Date: 2026-07-27

## Scope

- Source: `/Users/junxihuo/Documents/dca_system`
- Destination: `/Users/junxihuo/Workspace/dca_system`
- Started: `2026-07-27 17:46:04 CST`
- Safety rule: keep the source, backup, Git bundle, and compatibility link until all core checks pass.
- Production changes: prohibited for this migration.

## Pre-Migration Git Baseline

- Branch: `master`
- HEAD: `ef8d1fd11133fd89752f742d2cc733fcec214557`
- Upstream: `origin/master`
- Remote: `origin git@github.com:fuwa2019/dca-tracker.git`
- Stash: empty
- Working tree:
  - modified `src/app/dashboard/VariantA.tsx`
  - modified `src/app/dashboard/model.ts`
  - modified `src/components/MonthlyPerformanceCalendar.tsx`
- Local branches:
  - `backup-before-equity-curve-fix`
  - `codex-quote-status-labels`
  - `codex/rollback-before-20260713-shared-cash-weight`
  - `master`
- Registered worktrees:
  - source worktree at `ef8d1fd11133fd89752f742d2cc733fcec214557`
  - `/Users/junxihuo/.codex/worktrees/6e1c/dca_system` at `608d536214c3863b5a8efb2c47dd98a71bcab1eb` (detached)
  - `/Users/junxihuo/.codex/worktrees/cd7b/dca_system` at `bcdd802a9c64d4bf6cbad6ed7153d22e0970b2cc` (detached)

## Stage 1: Read-Only Audit

Status: complete

Findings:

- The repository contains a React 18/Vite SPA, two Cloudflare Workers, and additive Supabase migrations.
- npm is the package manager; root and worker lockfiles are present.
- CI runs finance fixtures, email reminder tests, quote-status tests, typecheck, and build.
- There is no lint script.
- The migration tree currently runs through `0042_private_performance_daily_pnl.sql`; existing AI entry documents still mention older migration bounds.
- `README.md` contains stale setup details and an external Claude plan dependency.
- `CLAUDE.md` duplicates nearly all public agent guidance from `AGENTS.md`.
- `CLAUDE_HANDOFF.md` describes an older clean working tree and is no longer a current handoff.
- The three current source edits are coherent application work: dashboard loading behavior, NAV presentation, and performance-calendar styling.
- Both detached Codex worktrees are clean, and both commits are reachable from existing local and remote branches.
- Ignored/regenerable local material includes `node_modules/`, `dist/`, `.wrangler/`, `.wrangler-logs/`, `.claude/`, `.DS_Store`, and `SESSION_LOG.md`.

Git status after stage:

```text
## master...origin/master
 M src/app/dashboard/VariantA.tsx
 M src/app/dashboard/model.ts
 M src/components/MonthlyPerformanceCalendar.tsx
```

## Stage 2: Backup and Recovery Material

Status: complete

- Directory backup: `/Users/junxihuo/Documents/dca_system.backup-20260727`
- Git bundle: `/Users/junxihuo/Documents/dca_system-pre-migration.bundle`
- The backup excludes real environment files, token files, private portfolio imports, Wrangler local state, and logs.
- The tracked public template `.env.example` is included.
- First `rsync -aE` attempt failed because macOS could not copy the Git fsmonitor socket/extended attributes. The retry used `rsync -a`, excluded the socket, and completed without modifying the source.
- Source and backup have matching HEAD, tracked index, working diff, and status.
- `git fsck --full` passes in the backup.
- `git bundle verify` reports a complete history and all refs.

Git status after stage:

```text
## master...origin/master
 M src/app/dashboard/VariantA.tsx
 M src/app/dashboard/model.ts
 M src/components/MonthlyPerformanceCalendar.tsx
?? docs/migration/2026-07-27-workspace-migration.md
```

## Risks at End of Stage 2

- Valuable source edits remain uncommitted and must receive a checkpoint before migration standardization.
- The two clean Codex worktrees are still registered pending safe removal through `git worktree remove`.
- The destination directory already exists but is empty; it must be rechecked before copying.
- Project and user-level DCA skill files may still contain the old absolute path.
- Existing docs disagree on current migrations and deployment details; only code, current config, Git, and verified checks will be treated as authoritative.

## Stage 3: Codex Worktrees

Status: complete

- Rechecked both detached worktrees before removal.
- Both working trees were clean.
- Both detached commits were reachable from valid local and remote branches.
- Removed each worktree with `git worktree remove`; no directory was deleted directly and no force option was used.
- Ran `git worktree prune`.
- The only remaining registered worktree is the source repository.

Git status after stage:

```text
## master...origin/master
 M src/app/dashboard/VariantA.tsx
 M src/app/dashboard/model.ts
 M src/components/MonthlyPerformanceCalendar.tsx
?? docs/migration/
```

## Stage 4: Uncommitted Work Protection

Status: complete

- Created branch `backup/pre-workspace-migration-20260727` from the pre-migration HEAD.
- Reviewed and staged only the three known source files; did not use broad staging.
- Created checkpoint commit `bc9a977c9a8e1fa68cda70d4ef354d95193e23ca` (`chore: checkpoint pre-workspace migration`).
- The migration log remains intentionally untracked for the standardization commit.

Git status after stage:

```text
## backup/pre-workspace-migration-20260727
?? docs/migration/
```

## Updated Risks

- The original source edits are protected by both the directory backup and checkpoint commit.
- The source backup predates the checkpoint branch but contains the exact pre-checkpoint working diff and the complete pre-migration Git history.
- The destination directory already exists but is empty; it must be rechecked before copying.
- Project and user-level DCA skill files may still contain the old absolute path.
- Existing docs disagree on current migrations and deployment details; only code, current config, Git, and verified checks will be treated as authoritative.

## Stage 5: Project Knowledge and AI Entry Points

Status: complete

Created:

- `PROJECT.md`
- `HANDOFF.md`
- `docs/architecture/`
- `docs/decisions/`
- `docs/runbooks/`
- `docs/tasks/`
- `docs/archive/ai/`

Changed:

- Reduced `AGENTS.md` to shared execution and safety rules.
- Reduced `CLAUDE.md` to `@AGENTS.md` plus Claude-specific sub-agent and
  auto-memory constraints.
- Replaced the stale README with a maintained project entry and relative links.
- Archived `CLAUDE_HANDOFF.md`, `PLAN.md`, `CODEX_DEPLOY.md`, and the completed
  font/session-color deployment note.

Verified facts incorporated:

- Current deployable split and runtime boundaries.
- Current npm/CI command set and the absence of a lint script.
- Supabase migration tail through `0042_private_performance_daily_pnl.sql`.
- Performance-cache, NAV/XIRR/TWR, share privacy, and local-mode contracts.
- Database migration, deployment authorization, and secret-handling rules.

Validation:

- `git diff --check` passes.
- No active project file outside historical migration/archive records contains
  an old project path or the previous user-level Claude plan reference.
- Root legacy handoff/plan/deployment files no longer exist as active entries.

Git status after stage:

```text
## backup/pre-workspace-migration-20260727
 M AGENTS.md
 M CLAUDE.md
 D CLAUDE_HANDOFF.md
 D CODEX_DEPLOY.md
 D PLAN.md
 M README.md
 D docs/DEPLOY_FONT_AND_SESSION_COLORS.md
?? HANDOFF.md
?? PROJECT.md
?? docs/architecture/
?? docs/archive/
?? docs/decisions/
?? docs/migration/
?? docs/runbooks/
?? docs/tasks/
```

## Stage 6: External Codex/Claude Project Artifacts

Status: complete

- Searched `/Users/junxihuo/Documents/Codex` by directly relevant names and
  DCA project identifiers while excluding environment, token, log, CSV, JSON,
  dependency, and virtual-environment material.
- The only matches were a dated export of Claude conversation transcripts and
  its index.
- The export is session history, not a trusted project source.
- Font/deployment facts from one transcript are already represented by current
  code and the archived in-project deployment note.
- Other transcript subjects could contain personal financial material,
  transient incident context, or obsolete plans, so their bodies were not
  imported.
- No unique, verified, non-duplicate artifact was copied into the repository.

## Stage 7: Pre-Copy Standardization Commit

Status: in progress

Pre-commit validation:

- `npm run test:finance`: passed.
- `npm run test:email-reminder`: passed with an existing Node module-type
  performance warning.
- `npm run test:quote-status`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run build:local`: passed.
- Markdown local-link check: passed for 40 files.
- `git diff --check`: passed.
- No new file over 1 MiB was found in the documentation changes.

The Node warning comes from `workers/email-cron/package.json` not declaring
`"type": "module"` while the test imports TypeScript ES module syntax. It does
not fail the test and predates this migration, so it was not changed here.
