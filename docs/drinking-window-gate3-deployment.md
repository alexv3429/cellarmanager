# Gate 3 profile-exchange database deployment — PR #230

This is slot **4/6** of the [locked drinking-window release plan](drinking-window-release-plan.md).
The owner authorized a protected backup, restored-copy rehearsal and linked
deployment on 30 October 2026. This installed schema and guarded RPCs only;
it did **not** import a profile, approve or publish dates, opt in a cellar,
or alter wine or stock records.

## Scope and preflight

- Linked project: `cellarmanager-v02-dev` (`sxdqcvnjtayfxinyospb`). All
  [PR #230](https://github.com/alexv3429/cellarmanager/pull/230) CI checks
  passed before deployment: web, database, dependency audit, Worker build and
  aggregate gate.
- Both linked dry runs named exactly
  `20261030110000_drinking_window_full_profile_exchange.sql` and
  `20261030120000_drinking_window_profile_format_ranking.sql`. They named
  no seed or role file. The final push used `--skip-vault`.
- Aggregate-only linked preflight: 810 wines, four households, six auth users,
  two reference versions, zero publications, zero enabled household rollouts,
  emergency runtime switch off, and no Gate 3 archive table.

## Protected backup and restored-copy rehearsal

The completed schema and data export of `public`, `private`, `auth`, `storage`
and `capture_guard` is temporarily retained outside Git at
`/private/tmp/cellarmanager-gate3-pr230-backup.v1sN0x` (directory mode 0700,
files mode 0600). SHA-256:

- `schema.sql`: `77fcbd9b75c0680a73b7af8ae1dc21184c59b88757a10e970938a9d4d7b91af9`
- `data.sql`: `e36215e540868bfad000af55859fa4bf23dd80e1d5c80bd863f82d5c51eff137`

This is sensitive temporary recovery material, not a durable managed backup.
Do not commit it or restore it over later live changes automatically.

The export was restored into a separate local disposable PostgreSQL database.
Standard Supabase extension prerequisites were installed there. The schema
restore completed with `ON_ERROR_STOP=1`; existing circular foreign keys
required disabling triggers **only for the local data-restore session**.
The restored baseline matched linked preflight counts. Both Gate 3 migrations
then applied with exit code 0. The clone retained 810 wines, four households,
six users, two reference versions, zero publications and zero profile imports.
The guarded import RPC was executable by `authenticated`, not by `anon`;
`authenticated` could not directly read the private archive. The 21
rollback-only synthetic SQL assertions had already passed in a seeded local
clone and in PR database CI. They were not repeated unchanged on this real-data
clone because their synthetic test-user foreign key is absent from live auth
data; no test user was inserted into the restored copy.

## Linked result and handoff

The authorized push applied only the two named migrations. A fresh linked dry
run then reported **zero pending migrations**, no seed and no role change.
Read-only postflight matched preflight: 810 wines, four households, six auth
users, two reference versions, zero publications, zero enabled rollouts,
runtime switch off, zero imported profiles and zero staged release/group
links. `authenticated` can execute the curator-guarded import RPC but cannot
directly read the private archive; `anon` cannot execute that RPC.

The PR preview at
`https://codex-drinking-window-gate3-profile-exchange-cellarmanager.cellarcloud.workers.dev/catalog`
returned HTTP 200. An authenticated curator walkthrough of the new full
profile import/export and preview is still required before asking the owner
to merge. Use a small reviewed sample first; importing a file archives it but
does not publish dates. The 23 owner-supplied profiles remain unimported for
Gate 4, and optional non-date facts remain private as described in the
[exchange guide](drinking-window-complete-profile-exchange.md).
