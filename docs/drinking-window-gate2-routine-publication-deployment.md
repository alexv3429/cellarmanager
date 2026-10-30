# Gate 2 routine-publication migration — PR #229

This is slot 3/6 of the [locked drinking-window release plan](drinking-window-release-plan.md).
The single migration is `20261030100000_drinking_window_routine_publication.sql`.
It changes the shared-window publication workflow but does not publish a draft
or alter a wine merely by being installed.

## CI and linked preflight — 30 October 2026

PR #229 passed web, Supabase database, dependency-audit, Worker-build and
aggregate CI checks. The linked dry run for project `cellarmanager-v02-dev`
(`sxdqcvnjtayfxinyospb`) named **only this migration**, with no seed, role
or Vault change.

## Protected backup and rehearsal

A completed schema and data export of `public`, `private`, `auth`, `storage`
and `capture_guard` is temporarily stored outside Git in
`/private/tmp/cellarmanager-gate2-pr229-backup.gmL1xD` (directory mode 0700,
files mode 0600). SHA-256: `schema.sql`
`fb034547fe0d02784ffe45c960d3d8f128f467fa8c25708f968f82c107ceb80e`;
`data.sql`
`0ca9b59c0cf5ae45d35f93c2354ac30f2acb718ed60a1f8e472f2fa0e52f800a`.
This is sensitive temporary recovery material, not a durable managed backup.

The export was restored into a **separate local disposable database**.
`supabase_admin` was required for the schema restore. Because the exported
data contains existing circular foreign keys, triggers were disabled **only
for the local data-restore session**. The migration then applied with exit
code 0. Before and after, the clone had 810 wines, four households, six auth
users, two reference versions, zero publications and zero enabled runtime
switches. After migration there were zero new authoring and impact-preview
audit rows. Authenticated users can execute the guarded authoring and preview
RPCs, anonymous users cannot, and authenticated users cannot directly read
the new private audit table or call the low-level publication function.

## Linked deployment

**Not applied.** The linked database, profiles, windows, and cellar advice
remain unchanged pending owner authorization. Before applying, repeat the
dry run and verify that this is still the only pending migration. After
applying, compare aggregate counts and grants with the rehearsal. Do not
publish a draft as part of migration deployment. Retain the protected export
until a deliberate recovery decision; never restore it over later live user
changes automatically.
