# Gate 1 database deployment — 29 October 2026

This records the owner-authorized backup, restored-copy rehearsal, and linked
deployment for [PR #228](https://github.com/alexv3429/cellarmanager/pull/228),
slot 2/6 of the [release plan](drinking-window-release-plan.md). Gate 1 is
**not** the complete or generally released drinking-window feature.

## Scope and preflight

- Target: linked Supabase project `cellarmanager-v02-dev`
  (`sxdqcvnjtayfxinyospb`). PR #228's database, web, dependency-audit,
  Worker-build, and aggregate CI checks all passed before deployment.
- A linked dry run, repeated immediately before the push, named exactly
  `20261029170000_drinking_window_gate1_selection.sql`. No seed, role file,
  Vault operation, or other migration was included.
- A completed, protected schema and data export of `public`, `private`,
  `auth`, `storage`, and `capture_guard` is retained temporarily outside Git
  at `/private/tmp/cellarmanager-gate1-pr228-backup.Io6FJ5`. The directory
  has mode `0700` and the files `0600`. Completed-file SHA-256 values:
  `schema.sql` `9f09e34e31e2992035aea17046b2b567fe53b7db8f5448dd7c0da6bdbdb6e404`;
  `data.sql` `8b683b774300f77d6382990bfeab1c81d3879c010cc8faaf61d38a976db25677`.
  This is a sensitive temporary recovery copy, not a managed durable backup.

## Rehearsal and result

The protected export was restored into a separate disposable local Supabase
Postgres database. The first schema restore stopped because the empty database
lacked the Supabase `extensions` schema. Only the disposable database was
recreated, its normal local extension prerequisites were installed, and the
schema and data then restored with `ON_ERROR_STOP=1`. Triggers were disabled
only in the data-restore session to accommodate existing circular foreign
keys. The Gate 1 migration then applied cleanly to the restored copy.
The disposable database was dropped after verification and the temporary
local Supabase stack was stopped while retaining its normal data volume.

Before and after that rehearsal, the clone had 810 wines, four households,
six auth users, and two reference versions. After migration it had zero
cellar-only producer rules, publications, enabled household rollouts, or
enabled runtime switches. Anonymous users could neither read the private
rules table nor execute the owner rule functions. Authenticated users could
execute those guarded functions but not read the private table directly.

The authorized linked push applied **only** the Gate 1 migration with exit
code 0. A fresh dry run reports no pending migration. Aggregate-only linked
postflight matches the rehearsal: 810 wines, four households, six auth users,
two reference versions, and zero private rules, publications, enabled
rollouts, or enabled switches. The live role-grant checks also match the
rehearsal. The PR preview at
`https://codex-drinking-window-gate1-core-cellarmanager.cellarcloud.workers.dev/catalog`
returns HTTP 200; an authenticated owner walkthrough has **not** yet been
performed. No profile was imported or published, no household was opted in,
and no wine or stock record was changed by this deployment.

Retain the protected export through a deliberate recovery decision. Never
restore it over later live user changes automatically. The owner preview
result is recorded below; merging PR #228 does not complete Gates 2–5.

## Owner preview check — 30 October 2026

The owner reported creating a cellar-only producer rule on the preview wine
card, confirming that it took effect, and removing it. A subsequent
aggregate-only linked query found zero cellar-only producer rules, consistent
with the reported cleanup. This checks the create/select/remove path on a real
cellar. The separate cross-member personal-offset behavior was not manually
checked in this walkthrough; it remains covered by the automated Gate 1
tests. No shared profile was published or household rollout enabled.
