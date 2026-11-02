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

## Subsequent curator action (not part of the migration push)

Later on 1 November, the signed-in curator used the Gate 4 preview to create
one verified shared cuvée and vintage identity for Dureuil-Janthial Rully
Premier Cru Les Margotés blanc 2021 / 750 ml, then approved only its checked
2024 / 2026–2034 editorial estimate into **unpublished reference version 2**.
The draft now contains two approved rows including the previously reviewed
Burgaud Côte du Py 2022. The other 28 Dureuil profile proposals were set
aside. The built-in draft check passed; its read-only effect preview found
one match among 804 wine cards. No version was published, no household
opted in, and no cellar wine was linked by these actions. The detailed
identity and source review is in the [Gate 4 audit](drinking-window-gate4-initial-base.md).

## Household-name tooling extension — 2 November

After the owner asked to finish the local-name reconciliation mechanism, three
more Gate 4 migrations were installed on the same linked project, in order:
`20261102100000_household_wine_identity_reconciliation.sql`,
`20261102110000_household_cuvee_identity_links.sql`, and
`20261102120000_household_place_identity_links.sql`. These add a bounded
per-wine candidate preview, reusable owner-confirmed cuvée links and
household-only region/appellation links. They do not create a link, approve a
date or publish a profile by themselves.

Before this push, the draft PR's database, web, audit, Worker and CI-gate
checks all passed. The linked dry run listed exactly those three migrations,
zero seeds and zero roles. A fresh protected schema/data backup of `public`,
`private`, `auth`, `storage` and `capture_guard` was saved outside Git at
`/private/tmp/cellarmanager-gate4-links-backup.mlJh9D` (directory 0700,
files 0600), with SHA-256 `0daecd725808254d9469d45b298c3b9b99241415fb68330dba33c8b777faf2e3`
for `schema.sql` and `87dacaea8e62ef97a91a4415ecf5123d7bf2f7e5a978f5728f9501f4bcf67337`
for `data.sql`. This is sensitive, temporary recovery material, not a durable
managed backup. The export restored into a separate local database with
trigger checks disabled **only during that local data-restore session**.
Its preflight counts were 810 wines, four households, six users, 23 saved
profiles and three reference rows.

All three migrations applied successfully on that fresh clone. The cuvée
and geographic regression tests passed in rollback transactions (17 and 25
assertions respectively); the earlier per-wine test uses a seeded household
fixture absent from the restored live copy, but passed in the PR's fresh
Supabase CI. The clone retained the five preflight counts above, and the
new household cuvée, region and appellation link tables remained empty.
The linked push then reported exactly the three migrations, and a fresh
linked dry run showed **zero pending migrations, seeds or roles**. The
preview app loaded for the signed-in owner and displayed the new cuvée and
region/appellation panels after its service-worker update. This verifies
availability, not a completed cellar mapping or a published date. No live
aggregate postflight query was run, so unchanged live counts are not claimed
as independently measured. The disposable 2 November rehearsal database was
dropped after these checks; the protected temporary export was retained for
deliberate recovery only.
