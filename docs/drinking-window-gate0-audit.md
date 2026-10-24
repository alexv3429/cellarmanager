# Gate 0: linked deployment audit (22–24 October 2026)

This is a **read-only-on-production** audit of the linked Supabase project
`sxdqcvnjtayfxinyospb` and the deployed app. It does not approve a migration
or a drinking-window publication. The [living release plan](drinking-window-release-plan.md)
remains the source of status and acceptance gates.

**Later outcome:** after separate owner authorization, the 19-migration batch
was applied on 24 October. See the [Gate 2 deployment record](drinking-window-gate2-deployment.md)
for live results. The checks and no-go decisions below describe the state
*before* that application.

## Fresh full-batch reconciliation (24 October)

This supersedes the **technical evidence** from the earlier 13-migration
rehearsal below; it does not authorize a live migration or a publication.

- GitHub confirms PR #206 merged on `main` as commit
  `7ed4afa4763cdb382f605bdf4bd49d083ad6e873`. Its successful
  [Cloudflare build check](https://github.com/alexv3429/cellarmanager/commit/7ed4afa/checks)
  names build `8802dc14-38e8-4bb6-b7d4-e27ea8b16bf7` and Worker version
  `2ea7a27c-a96f-46eb-95b7-35bf26722690`. A fresh read-only Wrangler
  deployment listing showed that exact version at **100%** from
  `2026-10-23T19:51:56Z`. This is an actual commit-to-version mapping, not an
  inference from timestamps. Recheck after another deployment.
- A fresh read-only linked migration listing for project
  `sxdqcvnjtayfxinyospb` showed **19 local-only migrations**, from
  `20261016120000` through `20261023200000`, with no new remote migration in
  that interval. The five original catalogue counts and the six expected
  producer-name counts in the [aggregate preflight](../scripts/drinking_window/gate0_preflight.sql)
  remained as recorded below. The batch includes PRs #203–#206.
- A new protected temporary export of `public`, `private`, `auth`, `storage`,
  and `capture_guard` was restored into an isolated local database. The dump
  and restored database agreed on **788 wines, 4 households, 6 users, and 0
  shared reference versions**. No row or user identifier is retained here.
  The data-only dump's circular foreign keys required disabling triggers
  **only within the clone's restore transaction**. The repeatable
  [clone capture helper](../scripts/drinking_window/gate0_clone_capture.sql)
  refuses to run outside a disposable `cm_gate0_` database.
- Before the batch, the clone captured owner-accessible maturity responses
  for **782 unmerged wines and all 4 household overviews**. All 19 migrations
  applied in order without error. The same 786 responses were captured after
  the batch. After removing only additive reference/source metadata, **zero
  core advice responses differed or disappeared**. Every unmerged wine's
  active-reference matcher returned `unpublished`; the global switch remained
  off, there were **0 enabled household rollouts**, **0 publications**, and
  **1 draft**. Anonymous cannot execute the new identity or ageing-choice
  write RPCs; authenticated users can reach them, where the owner check is
  enforced. The existing maturity reader remained available to authenticated
  users and unavailable to anonymous callers.
- A **second independent restore** from the same temporary export again
  produced 788 wines, 4 households, 6 users, and 0 reference versions. In a
  rolled-back transaction on the migrated first clone, the already
  owner-confirmed Burgaud Côte du Py 2022 wine was linked through the
  owner-only identity RPC to its unique canonical release. The draft shadow
  comparison then reported **one `draft_match` / `changed` wine**. This proves
  the proposed pilot can match after an explicit owner link; it does **not**
  mean the live wine is linked or that the draft is approved.
- Both disposable databases and the protected temporary export were deleted
  after verification. The linked project was only read; **no live schema,
  identity, window, permission, or stock data was changed**.

The technical Gate 0 rehearsal and provenance checks now pass for this
point-in-time batch. Before any live application, take a **new** protected
backup, rerun the linked preflight and migration inventory, recheck the
deployed commit, and obtain separate authorization for the named 19-migration
batch. The live pilot wine still lacks its canonical link; only the owner may
make that link after the inert RPC deployment. Gate 1's UI walkthrough and
mobile/edge-case acceptance also remain open.

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
  the release-scoped membership yet. On 23 October, the cellar owner confirmed
  that this entry is the intended Jean-Marc Burgaud Morgon Côte du Py 2022.
  This confirms the wine's identity only: it does not authorize a live link,
  publication, opt-in, or migration. No private row identifier is recorded here.

**Historical 23 October decision: no-go for a live migration that day.** The
13-migration replay and recovery checks had passed, but the deployed Worker
commit was not yet verified and the confirmed pilot wine lacked its canonical
release link. The 24 October full-batch evidence above supersedes that
technical finding; it does not authorize a live migration. Gate 1, a fresh
preflight, and separate owner authorization remain open.

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

## Remaining deployment-time checks and owner actions

1. Recheck the active Cloudflare version-to-commit mapping after any new
   deployment, especially after merging this audit PR.
2. Recheck the aggregate preflight immediately before seeding and resolve any
   new duplicate/conflicting identity or nonempty reference library. Do not
   change live data merely to make the preflight green.
3. The owner confirmed the plausible pilot wine's exact identity. A rolled-back
   clone simulation produced a draft match; the **live** wine is still
   unlinked. After an authorized inert deployment, let the owner use the
   identity-review UI and inspect a fresh real-cellar comparison. No automatic
   name-based link is accepted.
4. At deployment time, take a **new** protected backup, rerun the preflight,
   and obtain separate authorization for the named live migration batch.
   Both temporary snapshots were deliberately deleted. The technical rehearsal
   is accepted for the current batch, but that does not accept Gate 1, authorize
   Gate 2, or approve the pilot reference.
