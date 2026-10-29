# Gate 0 database deployment — 29 October 2026

This records the owner-authorized backup, local rehearsal, and linked-project
application of the nine pending drinking-window migrations. It is **not**
publication of a shared profile or completion of the product feature.

## Scope and protection

- Target: linked Supabase project `cellarmanager-v02-dev`
  (`sxdqcvnjtayfxinyospb`). No seed or role file was deployed.
- Before application, a protected local schema and data dump of `public`,
  `private`, `auth`, `storage`, and `capture_guard` was created outside Git.
  The local copy is retained temporarily for recovery; it is not a managed,
  durable backup and must not be committed or shared.
- The dump was restored into an isolated local PostgreSQL database. The first
  migration rehearsal encountered a local database-owner permission mismatch;
  after aligning the clone's ownership with the linked project, all nine
  migrations succeeded. No change was made to the linked project during that
  correction.
- The final linked dry run listed exactly these nine migrations, in order:

  1. `20261028130000_drinking_window_draft_row_corrections.sql`
  2. `20261028140000_drinking_window_exact_source_intake.sql`
  3. `20261029100000_drinking_window_producer_profile_intake.sql`
  4. `20261029110000_drinking_window_editorial_estimate.sql`
  5. `20261029120000_drinking_window_in_app_release.sql`
  6. `20261029130000_drinking_window_fallback_authoring.sql`
  7. `20261029140000_drinking_window_fallback_corrections.sql`
  8. `20261029150000_drinking_window_candidate_identity_creation.sql`
  9. `20261029160000_drinking_window_place_identity_creation.sql`

## Result and postflight

All nine were applied successfully to the linked project. A fresh dry run
reported no pending migrations; local and remote histories both ended at
`20261029160000`. The restored-clone checks and live postflight retained 810
wines, 4 households, and 2 reference versions. The linked project still had
zero publications, zero enabled household rollouts, zero enabled runtime
switches, and zero producer-profile candidate stagings. The isolated clone
also confirmed that anonymous users cannot execute the new curator intake or
publication functions. The official app's public entry point returned HTTP
200 after application; an authenticated end-to-end app test was not part of
this database deployment.

PR #227 remains open. No supplied producer file was imported, no dates were
published, and no household was opted in. Gates 1–5 of the
[product contract](drinking-window-product-contract.md) remain to deliver the
complete app-managed workflow within the six-PR budget.
