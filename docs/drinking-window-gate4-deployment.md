# Gate 4 identity tooling deployment — draft PR #231

This is slot **5/6** of the [living release plan](drinking-window-release-plan.md).
The owner authorized backup, rehearsal and linked application on 1 November
2026. This installed three additive schema/routine migrations only. It did
**not** approve a drinking date, create a canonical identity batch, link a
household wine, publish a reference, change stock or enable a rollout.

## Scope and preflight

- Linked project: `cellarmanager-v02-dev` (`sxdqcvnjtayfxinyospb`). All
  [draft PR #231](https://github.com/alexv3429/cellarmanager/pull/231) CI
  checks passed before deployment: web, database, dependency audit, Worker
  build and aggregate gate.
- The linked dry run named **only**
  `20261101100000_drinking_window_profile_place_mapping.sql`,
  `20261101110000_drinking_window_package_identity_reader.sql`, and
  `20261101120000_drinking_window_profile_identity_batch.sql`. It listed no
  seed or role file. The push used `--skip-vault`.

## Protected backup and restored-copy rehearsal

The schema and data export of `public`, `private`, `auth`, `storage` and
`capture_guard` is retained outside Git at
`/private/tmp/cellarmanager-gate4-pr231-deploy-backup.enBDEE` (directory mode
0700, files mode 0600). SHA-256:

- `schema.sql`: `e4c01b28ddfaf37c0756deb518d8096e435d2ccb7a549b9ad45c69e2092234cf`
- `data.sql`: `5837661fbed93b3c9ff6d67cab5b751191e7f47b8de0d9fed953c3b4afce7e06`

This is sensitive temporary recovery material, not a durable managed
backup. Never commit it or restore it over subsequent live changes
automatically.

The export restored with `ON_ERROR_STOP=1` into a separate local database,
after the standard Supabase extension prerequisites. Existing circular
foreign keys required disabling triggers **only for the local data-restore
session**. The first data-restore attempt used a local role without sufficient
table privileges; its incomplete disposable database was dropped, recreated,
and fully restored using local `supabase_admin`. The completed baseline was
810 wines, four households, six auth users, 23 private profile archives and
two reference rows.

All three migrations applied on that completed copy with exit code 0. Those
five baseline counts remained unchanged and the new immutable identity-batch
audit table was empty. Seventeen rollback-only assertions passed on the copy,
including curator/ordinary-user separation, multi-format existence pointers,
stale-preview rejection, confirmation, and no date or cellar writes. After
the test rolled back, the identity-batch audit table was still empty. The
new RPCs are executable by `authenticated` (with an internal curator check),
not by `anon`; `authenticated` cannot directly read the private audit table.
The disposable restored database was dropped after the checks; the protected
backup above was retained for deliberate recovery only.

## Linked result and remaining verification

The authorized linked push reported exactly the three migrations above. A
fresh linked dry run reported **zero pending migrations**, seeds or roles.
No curator identity action was invoked during deployment. The migrations
contain no existing-wine, reference-row, stock or publication data updates;
the protected-copy counts verified that behavior. No linked aggregate
postflight query has yet been run, so unchanged live row counts should not be
claimed as independently measured. The preview app returned HTTP 200 at
`/admin/shared-reference`; its existing signed-in catalogue loaded with
synchronization current and still labelled the visible Chagnoleau windows
as model estimates. This is a smoke check, not a date-approval or canonical-
identity test. The draft PR remains a **no-go for merge
and for publication** until actual identity/date review and real-cellar
coverage checks described in the [Gate 4 audit](drinking-window-gate4-initial-base.md)
are done.
