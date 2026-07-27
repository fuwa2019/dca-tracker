# User Skill Path Change Backup

Created: 2026-07-27

This is a reversible, path-only backup made before editing DCA-specific
user-level skills. Full file copies were intentionally not created because the
files contain unrelated personal account metadata that must not be duplicated.

Restore validation should first compare the pre-change SHA-256 below. To undo
only this migration, replace the new dynamic/canonical root text with the old
path lines documented here.

## Pre-Change File Hashes

```text
6b974f06f3070b8d8e429d13fdf675fe74c273de3a557cdde12d5e61ac575abd  /Users/junxihuo/.codex/skills/dca-supabase-connector/SKILL.md
07d75f5a57f10afdf838c65cd6a66b20caf4571639cf2d76de9b3acc504b6ad8  /Users/junxihuo/.codex/skills/dca-supabase-connector/references/project.md
6a322bca46c2d95ed55a86b9a350f9b062586a70a23402a06231eafed0fee422  /Users/junxihuo/.codex/skills/dca-system-wrangler/SKILL.md
e44c25ee9c7f5920f281f74846d47d0f72e15f819c40ada6433d9d18a911aaac  /Users/junxihuo/.codex/skills/dca-system-wrangler/scripts/dca_wrangler.sh
6b974f06f3070b8d8e429d13fdf675fe74c273de3a557cdde12d5e61ac575abd  /Users/junxihuo/.cc-switch/skills/dca-supabase-connector/SKILL.md
07d75f5a57f10afdf838c65cd6a66b20caf4571639cf2d76de9b3acc504b6ad8  /Users/junxihuo/.cc-switch/skills/dca-supabase-connector/references/project.md
6a322bca46c2d95ed55a86b9a350f9b062586a70a23402a06231eafed0fee422  /Users/junxihuo/.cc-switch/skills/dca-system-wrangler/SKILL.md
e44c25ee9c7f5920f281f74846d47d0f72e15f819c40ada6433d9d18a911aaac  /Users/junxihuo/.cc-switch/skills/dca-system-wrangler/scripts/dca_wrangler.sh
```

## Old Path Lines

The Supabase skill and reference used these path forms:

```text
Project-specific Supabase access workflow for /Users/junxihuo/Documents/dca_system.
Use this skill only for `/Users/junxihuo/Documents/dca_system`.
Work from `/Users/junxihuo/Documents/dca_system`.
--repo /Users/junxihuo/Documents/dca_system
Repo: `/Users/junxihuo/Documents/dca_system`
```

The Wrangler skill and helper used these path forms:

```text
Project-specific Cloudflare Wrangler workflow for /Users/junxihuo/Documents/dca_system.
Use this skill for Cloudflare/Wrangler work in `/Users/junxihuo/Documents/dca_system`.
Work from `/Users/junxihuo/Documents/dca_system`.
PROJECT_ROOT="/Users/junxihuo/Documents/dca_system"
```

No secret value, personal account field, environment content, or financial data
is included in this backup.
