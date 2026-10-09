# 2026-10-09 full read-only share scope release

Scope: Supabase migration 0059 and the SPA. No Worker deploy, secret, or KV
change. The owner amended the share privacy rule and authorized the release;
decision record `docs/decisions/2026-10-09-full-read-only-share-scope.md`.

## Change

Code commit `c295986`.

- `0059_share_link_scope.sql`: `share_links.scope` (`report` default | `full`),
  `shared_link_scope(token)`, and `shared_full_ledger(token)` for full,
  unrevoked, unexpired links only, built from a column allowlist.
- Share page routes full links into the normal pages through a per-tab share
  session; hooks read the shared ledger and the cached share curve; settings,
  write controls and owner-only maintenance reads are hidden.
- Settings → 分享链接: scope on creation and per link, with a confirmation
  before raising a link to full.
- `test:share-privacy`: separate full-scope allowlist and gate checks.

## Verification

- Finance, email-reminder, quote-status, share-privacy, UI, typecheck,
  migration numbering and overloads, offline build, and first-load budget
  (183.47 / 194 KiB gzip) passed.
- Four deliberate mutations of 0059 (no scope gate, extra `user_id` key,
  whole-row `to_jsonb`, unfiltered table read) each failed `test:share-privacy`.
- Scratch local Postgres 15 with all 59 migrations and stubbed Supabase roles:
  report / revoked / expired / unknown tokens get an error from
  `shared_full_ledger`; a full token returns only its owner's rows with no
  email, import key, or user id; anon and another user change no link scope
  (RLS, `UPDATE 0`); the owner can.
- Offline local build: owner scope controls and upgrade confirmation; a full
  link opens the read-only pages without settings; a report link shows
  percentages only and clears the session.

## Production

- Migration 0059 applied by the owner in the Supabase SQL editor (not run by
  this session). Anonymous REST probes then returned
  `{"error": "invalid_or_expired_token"}` from both new functions for an unknown
  token, and an anonymous `share_links` read returned `[]`.
- Pushed `c295986`; the `dca-tracker-git` Pages Git integration served entry
  `index-DsLEnpKb.js` about 60 seconds later. Cache-busted `/`, `/login`,
  `/performance`, `/exposure`, `/transactions`, `/health`, `/settings`, and
  `/share/<token>` returned 200. The 40 production chunks contain the scope
  lookup, shared ledger, session key, blocked-settings page, and upgrade
  confirmation, and no `sharePreview` dev flag.
- An unknown share token renders 「分享链接无效或已过期」 and stores no session;
  the login form renders with no console messages.
- Not verified in production: a real full-scope link end to end (no such link
  exists yet; creating one is the owner's call). No login or account-data
  access was performed.
