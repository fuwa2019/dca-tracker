# Architecture Decisions

Use `YYYY-MM-DD-short-title.md` filenames.

Each decision must include:

- context;
- decision;
- alternatives considered;
- decision rationale;
- consequences;
- rollback.

Accepted decisions:

- `2026-07-27-cache-public-performance.md`: use a shared sanitized performance
  cache.
- `2026-07-27-project-owned-ai-knowledge.md`: keep verified AI context inside
  the repository with one shared source for each kind of knowledge.
- `2026-07-27-migration-numbering-duplicates.md`: preserve reviewed historical
  duplicates and reject new migration numbering conflicts automatically.
