# ADR 0002: Project-Owned AI Knowledge

Status: accepted

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

## Consequences

- Codex-only, Claude-only, and combined workflows read the same project facts.
- Current task state has a single maintained location.
- AI-specific files remain small and do not drift independently.
- Archived notes preserve history without remaining active instructions.
