# Gate 0: linked deployment audit (22–23 October 2026)

This is a **read-only-on-production, partial** audit of the linked Supabase project
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

## Private-clone rehearsal (23 October)

With the owner's explicit approval, a protected temporary snapshot of the
linked `public`, `private`, `auth`, `storage`, and `capture_guard` schemas and
their data was restored into an isolated local database. The helper schema
and local `pgcrypto`, `unaccent`, and `pg_trgm` extensions were required for
the restore. The source and restored counts matched for wines, households,
auth users, and reference versions; no private rows or identifiers are
included in this record.

- All **13 pending migrations** applied in order to the restored database
  without error. The seed left one **draft**, no active reference version,
  the global switch off, and no opted-in households.
- Before the batch, maturity responses were captured for every
  member-accessible wine-card and household-overview read in the snapshot.
  After the batch, with references off, there were **zero changes** to their
  existing advice fields and **zero visible reference windows**. The new
  source label was excluded from the core-payload equality check because it
  is an additive field. Checked read-RPC execute privileges were unchanged
  for anonymous and authenticated roles, and for the wine-card service role.
  Anonymous and ordinary authenticated roles cannot execute the publication RPC; the service role
  can. Anonymous cannot read drafts; authenticated can reach the draft RPC,
  which performs its own curator check.
- A second clean local restore from the same snapshot reproduced the source
  counts and pre-migration function shape, proving the recovery route for
  this snapshot. Both scratch databases and the temporary snapshot were then
  removed. The snapshot is **not** in Git and is not recoverable from this
  workspace. No migration or publication was applied to the linked project;
  no application advice or access policy was changed there.
- The proposed pilot has **one plausible household wine** by producer,
  cuvée, and vintage, but **no canonical release link**. It would not match
  the release-scoped membership yet. This is a private identity-review task,
  not permission to infer or auto-link it from a similar name.

**Gate 0 decision: no-go for a live migration today.** The private replay and
recovery checks passed, but the deployed Worker commit is still unverified,
the pilot identity needs owner confirmation, and Gate 1 remains open. A
fresh preflight and separate operator authorization are required before any
live migration.

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
   adds household opt-in. The *whole ordered batch* passed the private-clone
   comparison. A live deployment must still not stop at the intermediate
   global-reader migration.
3. The deployed web client contains curator and comparison calls whose RPCs
   are among the pending migrations. The current app/build check does not
   demonstrate that those screens work against the older database. Verify
   compatibility explicitly during rehearsal and the post-deployment smoke.
4. A representative private replay and a second clean restore succeeded.
   This is not a substitute for a fresh backup, preflight, and explicit owner
   authorization at the time of live migration. The temporary snapshot has
   been deleted, so a new protected backup is needed for that operation.

## Remaining Gate 0 actions

1. Record the active Cloudflare deployment **commit** via an operator build
   record or a verifiable commit annotation. The version ID and deployment
   time are known, but neither proves the source commit.
2. Recheck the aggregate preflight immediately before seeding and resolve any
   new duplicate/conflicting identity or nonempty reference library. Do not
   change live data merely to make the preflight green.
3. Ask the owner to confirm the one plausible pilot wine's exact identity;
   link it to the canonical release only through an authorized local-review
   workflow. No automatic name-based link is accepted.
4. At deployment time, take a **new** protected backup, rerun the preflight,
   and obtain separate authorization for the named live migration batch.
   The prior snapshot was deliberately deleted. Gate 0 remains **In progress**
   until the active build and pilot identity are verified.
