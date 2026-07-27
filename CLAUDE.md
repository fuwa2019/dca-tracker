@AGENTS.md

# Claude Code Additions

- Treat `AGENTS.md`, `PROJECT.md`, and `HANDOFF.md` as the complete project
  entry path. Do not duplicate their public content here.
- Do not use Claude auto memory, old plans, or files under user-level Claude
  state as authoritative project knowledge.
- Do not write current project status, credentials, or repository facts into
  user-level auto memory. Durable verified facts belong in this repository.
- When using sub-agents, give them a bounded task and the minimum project
  context. The main agent remains responsible for reviewing their output,
  preserving working-tree changes, and running final verification.
- Sub-agents must not deploy, change production data, edit user-level state, or
  broaden the task without explicit user authorization.
