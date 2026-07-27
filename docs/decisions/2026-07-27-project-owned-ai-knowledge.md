# Project-Owned AI Knowledge

Status: accepted
Date: 2026-07-27

## Context

Codex and Claude previously maintained duplicated instructions and stale
handoffs. Session history and user-level memory are not reviewable project
sources and can retain obsolete paths or facts.

## Decision

Maintain one repository-owned entry path:

- `PROJECT.md` for stable facts;
- `AGENTS.md` for shared execution rules;
- `CLAUDE.md` for Claude-specific additions through `@AGENTS.md`;
- `HANDOFF.md` for current unfinished work;
- `docs/architecture/`, `docs/decisions/`, and `docs/runbooks/` for durable
  knowledge.

Session history and auto memory may identify candidates but cannot establish
facts without repository or current verification.

## Alternatives Considered

1. Maintain complete, separate instructions for Codex and Claude. Rejected
   because duplicated project facts drift and create conflicting entry paths.
2. Store current project state in user-level memory or skills. Rejected because
   those sources are not repository-reviewed, portable, or reliably current.
3. Treat chat exports and session history as authoritative. Rejected because
   they contain transient context and cannot replace current code, Git, or
   verification.

## Decision Rationale

Repository-owned entry files are reviewable, versioned, and available to both
tools. Separating stable facts, execution rules, tool-specific additions, and
unfinished work gives each fact one maintained location without losing useful
specialization.

## Consequences

- Codex-only, Claude-only, and combined workflows read the same project facts.
- Current task state has a single maintained location.
- AI-specific files remain small and do not drift independently.
- Archived notes preserve history without remaining active instructions.

## Rollback

Reversing this decision requires a new ADR that names the replacement source of
truth and updates every active entry point in one change. Historical
tool-specific files may remain archived, but they must not be restored as
active instructions without revalidating their facts against the repository.
