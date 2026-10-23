# Gate 0: linked deployment audit (22–23 October 2026)

This is a **read-only, partial** audit of the linked Supabase project
`sxdqcvnjtayfxinyospb` and the deployed app. It does not approve a migration
or a drinking-window publication. The [living release plan](drinking-window-release-plan.md)
remains the source of status and acceptance gates.

## Observed state

- The merged repository head was `f0a060ba1fbaf7293a371c84c528cb67b79b3f64`
  (PR #201). GitHub reported a successful Cloudflare Worker build for that
  commit. The public `/api/research/status` readiness check passed and reported
  app version `0.6.0`; that endpoint does **not** expose a commit hash, so the
  active Worker revision is not independently proved by this check.
- On 23 October, Cloudflare's read-only deployment list showed a 100% Worker
  deployment created at `2026-10-22T20:53:20Z`, version
  `ad8af3e4-e6aa-452e-908e-2975f6226d36` (number 420). This was just after
  PR #201's merge at `2026-10-22T20:52:25Z`, but the version metadata does not
  identify its source commit. Timing alone is not a verified hash mapping.
- `supabase migration list --linked --project-ref sxdqcvnjtayfxinyospb`
  showed the following **13 local-only** migrations, in order:

  ```text
  20261016120000_shared_producer_catalogue_seed
  20261016130000_household_producer_preference_review
  20261016150000_barraud_sur_la_roche_2023_identity
  20261016170000_household_wine_identity_review
  20261016200000_drinking_window_review_workspace
  20261017120000_drinking_window_publication_preflight
  20261017150000_drinking_window_shadow_comparison
  20261017180000_drinking_window_shadow_review
  20261017190000_drinking_window_publication
  20261017200000_drinking_window_active_reader
  20261017210000_drinking_window_staged_rollout
  20261022100000_burgaud_2022_first_shared_window_draft
  20261022110000_drinking_window_reference_curation
  ```

- PR #201's local clean-database CI passed the database suite, but a clean
  database cannot prove that these migrations succeed on existing catalogue
  identities or preserve real household advice.
- The aggregate preflight query ran successfully on the already-migrated local
  test database inside a read-only transaction. On 23 October, the same
  aggregate-only checks were run in the linked project's SQL Editor. They
  returned **0** reference versions; **1** Beaujolais region; **1** Morgon
  appellation; **1** Jean-Marc Burgaud producer; and **1** Daniel Barraud
  producer. Six other intended producer names (Barthod, Bouzereau, Carillon,
  Castagnier, Clavelier, Montcalmès) each had **0 exact normalized-name**
  matches. These counts reveal no conflict in the checked identities, but do
  not prove the full migrations will succeed on existing data. No household
  rows were retrieved and no database write was made.

## Migration-time risks to test, not assumptions to waive

1. The shared-producer and Barraud migrations create canonical identities;
   the Burgaud migration creates two release identities and an unpublished
   draft. They reject ambiguous/conflicting identities rather than silently
   merging them. The Burgaud migration also requires an **empty** shared
   reference-version library. The aggregate, read-only
   [`gate0_preflight.sql`](../scripts/drinking_window/gate0_preflight.sql)
   has now been run on the linked project; recheck it immediately before any
   migration attempt because the state may change.
2. The active-reader migration renames and replaces the existing maturity
   reader functions. Its new reference path checks the global runtime switch,
   which is inserted as **disabled**; the subsequent staged-rollout migration
   adds household opt-in. Rehearse the *whole ordered batch* and compare
   existing advice before/after. Do not stop at the intermediate global-reader
   migration in a live deployment.
3. The deployed web client contains curator and comparison calls whose RPCs
   are among the pending migrations. The current app/build check does not
   demonstrate that those screens work against the older database. Verify
   compatibility explicitly during rehearsal and the post-deployment smoke.
4. A backup/restore route and a representative private rehearsal have not
   been demonstrated. A test on a fresh synthetic database is useful but is
   not a substitute. Do not apply the 13 migrations to the live project until
   the private rehearsal, backup verification, and owner authorization are
   recorded in the release plan.

## Remaining Gate 0 actions

1. Record the active Cloudflare deployment **commit** via an operator build
   record or a verifiable commit annotation. The version ID and deployment
   time are known, but neither proves the source commit.
2. Recheck the aggregate preflight immediately before seeding and resolve any
   new duplicate/conflicting identity or nonempty reference library. Do not
   change live data merely to make the preflight green.
3. With explicit permission for private data handling, take a protected,
   temporary snapshot of the linked project, rehearse the 13 migrations on a
   separate local database, compare representative maturity responses and
   permissions before/after, and verify restore. Keep the snapshot out of Git
   and remove it after recording only aggregate evidence.
4. Update the [release plan](drinking-window-release-plan.md) with exact
   observations and a go/no-go decision. Gate 0 remains **In progress** until
   this evidence exists.
