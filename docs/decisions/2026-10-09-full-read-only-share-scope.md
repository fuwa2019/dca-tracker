# Full Read-Only Share Scope

## Context

Until now every share link was percentage-only: returns, weights, benchmark,
look-through, and no absolute amount, cashflow, trade, or exchange loss. That
was a project-wide rule (PROJECT.md, AGENTS.md, `test:share-privacy`).

On 2026-10-09 the owner asked for a second, opt-in level: a link that shows the
owner's own pages read-only — overview, performance, exposure, ledger, all
transactions, cashflows, data health — with amounts, and without settings or
any write action (import, export, add, edit, delete, refresh, reauthorize). The
owner then asked to amend the privacy rule and release it.

## Decision

Share links carry a `scope`, chosen per link by the owner:

- `report` (default, and every link created before migration 0059): the
  original percentage-only contract, unchanged.
- `full`: an owner-authorized read-only view with amounts.

Implementation (migration `0059_share_link_scope.sql`):

- `share_links.scope text not null default 'report'`, checked to
  `report | full`. Writes stay owner-only through the existing RLS policies.
- `shared_link_scope(token)` returns only `{scope}` or `{error}` so the share
  page can choose a view. It does not count a visit.
- `shared_full_ledger(token)` returns settings, accounts, transactions, and
  cashflows for a valid, unexpired, unrevoked link whose scope is `full`, and
  an error for anything else. Every row is built key by key from a column
  allowlist; it never sends `user_id`, `import_key`, `batch_id`,
  `email_enabled`, or `email_to`. It records a visit.
- The visitor's browser computes every figure with the same
  `portfolioLedger` engine the owner uses; the performance curve comes from the
  existing anonymous `shared_performance_history` cache. Nothing is recomputed
  server-side for an anonymous caller.
- The front end stores the token in `sessionStorage` for the tab
  (`src/lib/shareSession.ts`), reloads into the normal pages, and hides settings
  and every write control. Owner-only maintenance reads (price coverage, cache
  status, Schwab authorization, share audit) are skipped.

`test:share-privacy` keeps the original allowlist for the report entry points
and adds a separate allowlist for `shared_full_ledger`, plus structural checks:
gated on `scope = 'full'`, revocation and expiry, every table read filtered by
the link owner, and no whole-row serialization.

## Alternatives Considered

- **Separate login for viewers.** Stronger identity, but the owner wanted a
  link, and accounts for viewers would widen RLS far beyond one read path.
- **Server-rendered snapshot of each page.** Would duplicate the ledger engine
  in SQL or a Worker and drift from the owner's figures.
- **Returning whole rows (`to_jsonb`) minus a denylist.** Simpler, but a new
  private column would leak by default. Rejected in favour of an allowlist.

## Decision Rationale

The owner explicitly accepts that anyone holding a full-scope address sees the
amounts. Keeping `report` as the default, confirming before a link is raised to
`full`, and making revocation immediate keep that disclosure deliberate and
reversible per link. One allowlisted read path keeps the anonymous surface
auditable by the same static gate.

## Consequences

- PROJECT.md and AGENTS.md now state the rule per scope instead of
  "no amounts through public links".
- A leaked full-scope address exposes the ledger until the owner revokes it or
  lowers it to `report`. The token is 128-bit random.
- Notes and broker descriptions on transactions and cashflows are visible in
  full scope.
- Visit counts include full-scope loads of the app (one per page load).

## Rollback

Lower every link to `report` (`update share_links set scope = 'report'`), or
revoke the links. To remove the surface entirely, a new migration revokes
`execute` on `shared_full_ledger` from `anon, authenticated`; full links then
open pages that fail to load their data, and the report view keeps working.
