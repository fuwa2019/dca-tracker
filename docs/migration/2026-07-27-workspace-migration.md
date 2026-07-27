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

Status: complete

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

- Standardization commit:
  `d006848a047f3cb04be5cf52f48d48fc0cb7fd17`
  (`docs: standardize project knowledge for workspace migration`)
- The commit contains only reviewed project entry files, durable documentation,
  archived legacy notes, and the migration record.

Git status immediately after the standardization commit:

```text
## backup/pre-workspace-migration-20260727
```

The record-only follow-up commit is
`15caf40a514866cd7f2f413ba929dfb09eefb40a`
(`docs: record migration standardization checkpoint`). This became the copy
baseline.

## Stage 8: Copy to Workspace

Status: complete

- Rechecked `/Users/junxihuo/Workspace/dca_system` immediately before copying;
  the existing directory was empty.
- Copied the repository with `.git`, hidden project configuration, source,
  tests, migrations, docs, lockfiles, and current branch state.
- Excluded real environment files, token files, private portfolio imports,
  dependencies, build output, Wrangler state/logs, local Claude state,
  `.DS_Store`, and ignored session logs.
- The public tracked `.env.example` template is present.
- The source directory remained unchanged.

Copy baseline:

- Branch: `backup/pre-workspace-migration-20260727`
- HEAD: `15caf40a514866cd7f2f413ba929dfb09eefb40a`

## Stage 9: Git Integrity in Workspace

Status: complete

Verified in `/Users/junxihuo/Workspace/dca_system`:

- `git rev-parse --show-toplevel` resolves to the Workspace repository.
- Working tree was clean immediately after copy.
- HEAD and branch matched the source.
- All local branches, remote branches, tags, and other refs matched by hash.
- `origin` fetch/push URLs matched.
- Stash lists matched and were empty.
- Tracked index lists matched by hash.
- Key configuration and entry files matched byte-for-byte.
- `git fsck --full` passed with no output.
- The copied repository contains no real environment, token, or private
  portfolio import file.
- The new repository reports only its own main worktree, as expected after
  copying a normal repository with no linked worktrees.

## Stage 10: Project Old-Path Search

Status: complete

- Searched all requested old DCA path variants while excluding Git internals,
  dependencies, builds, environment files, logs, CSVs, and binaries.
- No active source, script, config, README, AI entry, or maintained runbook
  contains an old path.
- The only old-path occurrences are deliberate provenance in this migration log
  and `docs/archive/ai/CLAUDE_HANDOFF.legacy.md`.
- The archive header explicitly marks its absolute paths as historical.

## Stage 11: User-Level DCA Skills

Status: complete

Read-only search covered:

- `/Users/junxihuo/.codex/skills`
- `/Users/junxihuo/.claude/skills`
- `/Users/junxihuo/.agents/skills`
- `/Users/junxihuo/.cc-switch/skills`

Only two explicitly DCA-specific skills contained old paths:

- `dca-supabase-connector`
- `dca-system-wrangler`

The `.codex/skills` and `.cc-switch/skills` copies are separate files, so both
sets were updated. Eight files changed:

- each skill's `SKILL.md`;
- each Supabase skill's `references/project.md`;
- each Wrangler skill's `scripts/dca_wrangler.sh`.

Path behavior now prefers the current DCA Tracker Git root and falls back to
`/Users/junxihuo/Workspace/dca_system`. The Wrangler helper also accepts an
explicit `DCA_PROJECT_ROOT`.

Backup and validation:

- Pre-change SHA-256 hashes and reversible old-path lines are stored in
  `docs/migration/2026-07-27-user-skill-path-backup.md`.
- Full file copies were not made because the files contain unrelated personal
  account metadata that the migration safety rules prohibit duplicating.
- Both Wrangler helpers pass `bash -n`.
- The `.codex` and `.cc-switch` copies match byte-for-byte after the change.
- No searched user-level skill contains an old DCA path.
- No network call, deployment, OAuth flow, secret update, or database action
  was performed.

## Stage 12: Workspace Development Verification

Status: complete

Package manager and install:

- npm selected from the committed root and Worker lockfiles.
- `npm ci` passed at the root.
- `npm ci` passed in `workers/quote`.
- `npm ci` passed in `workers/email-cron`.
- No lockfile changed.

Checks in the Workspace repository:

- `npm run test:finance`: passed.
- `npm run test:email-reminder`: passed.
- `npm run test:quote-status`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run build:local`: passed.
- `npm run test:ui`: passed.
- `npm run test:symbols`: passed.

Configuration recognition:

- Found 44 ordered Supabase migration SQL files; the latest is
  `0042_private_performance_daily_pnl.sql`.
- `supabase/performance_cache_verify.sql` and
  `supabase/diagnose_performance.sql` are present.
- The repository has no versioned `supabase/config.toml`; hosted Supabase plus
  ordered SQL migrations is the existing project setup. This predates the
  migration and was not changed.
- Both installed Worker toolchains report Wrangler `3.114.17`.
- Both Worker configurations passed `wrangler deploy --dry-run` and produced
  local bundles. No deployment occurred.

Browser smoke test:

- Started `npm run dev:local` on `127.0.0.1:5173`.
- Playwright opened `/` and `/performance` in a real browser.
- The root rendered the local-mode marker without a login.
- The performance deep route rendered its page heading.
- Both routes returned HTTP 200.
- Console result: 0 errors and four React Router future-flag warnings.
- Browser and Vite sessions were closed after verification.
- Playwright artifacts were moved to `/private/tmp` and were not added to Git.

Existing warnings and dependency risk:

- The email reminder test emits a Node module-type performance warning because
  the Worker package does not declare `"type": "module"`. The test passes.
- npm audit reports 9 root vulnerabilities (1 low, 4 moderate, 4 high).
- npm audit reports 6 vulnerabilities for each Worker (2 moderate, 4 high).
- Wrangler warns that the locked major version 3 is behind major version 4.
- These warnings come from the existing lockfiles/configuration. No automatic
  audit fix, major upgrade, or unrelated dependency change was performed.

## Stage 13: Codex and Claude Compatibility

Status: complete

Codex-only:

- `AGENTS.md`, `PROJECT.md`, and `HANDOFF.md` exist and are linked as the entry
  path.
- No Claude session or user-level memory is required.

Claude-only:

- `CLAUDE.md` starts with `@AGENTS.md`.
- Claude-specific content is limited to sub-agent and auto-memory constraints.
- The Workspace copy intentionally has no project-local `.claude` state.
- No old Claude project index or session is required.

Codex plus Claude:

- Shared facts are maintained only in `PROJECT.md`.
- Shared execution rules are maintained only in `AGENTS.md`.
- Current task state is maintained only in `HANDOFF.md`.
- `CLAUDE_HANDOFF.md` is no longer an active root file.
- Legacy notes are clearly archived and do not compete with current state.
- Automated entry checks and all Markdown local-link checks passed.

## Stage 14: Compatibility Path Switch

Status: complete

- Rechecked the Workspace and Documents repositories: both were clean and at
  `831022f111bcb87370aafa7e46e1c7fa5c3210e8`.
- Renamed the former repository to
  `/Users/junxihuo/Documents/dca_system.old-20260727`.
- Created `/Users/junxihuo/Documents/dca_system` as a symlink to
  `/Users/junxihuo/Workspace/dca_system`.
- Verified `readlink` and `realpath` resolve directly to the Workspace
  repository with no loop.
- Verified the Workspace repository, symlink path, and old copy reported the
  same branch and HEAD.
- Ran `git fsck --full` in both independent repositories.
- Verified no nested Git repository exists under the Workspace repository.
- Verified the directory backup, old repository, and Git bundle remain present
  and readable.
- Ran `npm run test:finance` successfully through the compatibility path.
- Started `npm run dev:local` through the compatibility path and received HTTP
  200 for `/` and `/performance`.
- Stopped the post-switch local server after the check.

Git status after stage:

```text
## backup/pre-workspace-migration-20260727
```

## Finalization

- Final report:
  `docs/migration/2026-07-27-workspace-migration-report.md`
- Final HEAD reference: lightweight tag `workspace-migration-20260727`.
- No production deployment, production database change, OAuth operation,
  secret update, or private-data migration was performed.
- All rollback material remains intact.
