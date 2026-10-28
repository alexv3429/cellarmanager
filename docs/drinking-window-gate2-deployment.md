# Gate 2: authorized inert database deployment (24 October 2026)

This records the **live** database operation and 24 October signed-in checks
separately from the earlier
[private-clone rehearsal](drinking-window-gate0-audit.md). The later check
linked one owner-confirmed pilot identity; it did not approve the draft
reference, opt in a household, or release shared drinking-window advice.

## Authorization and target

- After merging PR #207, the cellar owner explicitly said, “And you can apply
  the migrations.” This authorizes the **19 named pending migrations** in the
  [living release plan](drinking-window-release-plan.md) on the linked
  `cellarmanager-v02-dev` project (`sxdqcvnjtayfxinyospb`), not a reference
  publication or broader data repair.
- The active Cloudflare Worker version was
  `6b89c961-66c2-43c5-a806-98fb7d589e13` at 100%. Its successful GitHub
  build check maps it to merged commit
  `c2900d0ca845a60ebcb47c8937d206b6b702d517` (PR #207). The merged
  commit's database, web, dependency, and CI checks also completed
  successfully.
- Supabase's
  [incident record](https://status.supabase.com/incidents/01M5J8ZQ04EZXAYF10Q75MGC1T)
  reported an ongoing **Management API** incident. Linked ledger reads, both
  backup operations, the SQL Editor preflight, dry-run, and subsequent
  migration command all responded successfully. The incident did not show a
  Postgres failure in these checks; it remains a reason to watch for transient
  CLI errors.

## Just-in-time protection and preflight

- A new protected local schema/data export of `public`, `private`, `auth`,
  `storage`, and `capture_guard` was created immediately before deployment.
  The directory was mode `0700` and both dump files mode `0600`. The data dump
  warned about circular foreign keys; restoring it into a disposable local
  database succeeded with triggers disabled **only for that clone's restore
  session**. The clone was deleted after validation. The export is retained
  temporarily outside Git for recovery until the owner walkthrough; it is
  sensitive and is not a durable managed backup.
- The fresh restore and **live, aggregate-only SQL Editor preflight** both
  showed 788 wines, 4 households, 6 auth users, and 0 reference versions.
  The expected Beaujolais region, Morgon appellation, Burgaud producer, and
  Barraud producer each had exactly one row. Six other expected producer
  names had zero exact normalized matches. These match the Gate 0 rehearsal;
  no conflicting seed identity appeared.
- `supabase db push --dry-run --skip-vault` listed **exactly** the 19 files
  from `20261016120000_shared_producer_catalogue_seed.sql` through
  `20261023200000_choice_aware_shadow_review.sql`, with no seed or role file.
  `--skip-vault` deliberately excluded unrelated Vault updates.

## Execution and smoke results

- The authorized `supabase db push --skip-vault --yes` completed with exit
  code 0 and listed all 19 migrations as applied. A fresh linked ledger read
  showed **0 pending migrations**, latest remote and local migration both
  `20261023200000`.
- The post-migration live read showed **788 wines, 4 households, 6 users,
  1 draft reference, 0 active references, 0 publications, 0 enabled runtime
  switches, and 0 enabled household rollouts**. The app homepage returned
  HTTP 200 and its public health endpoint returned `ready` with Supabase
  configured.
- Database privilege checks showed the owner identity and ageing-choice
  write functions unavailable to `anon` and reachable by `authenticated`
  (their internal owner checks still apply). The maturity read functions
  remained reachable by `authenticated`, not `anon`. Shadow comparison and
  publication functions were not executable by either ordinary role.

## Signed-in pilot check and private comparison (24 October)

- The owner account for the `v0.1 import validation` household was signed in;
  sync showed up to date. The catalogue then held **802 wines** and 1,277
  bottles (the protected pre-migration export held 788 wines). No stock action
  was performed by this check.
- Three existing advice responses were compared, including their full core
  payloads, between the protected pre-migration restore and the live database.
  Mas de la Seranne *Antonin et Louis* 2018 (manual), Burgaud *James* 2008
  (manual), and Alvina Pernot *Les Caillerets* 2021 (model) were identical
  after excluding only additive source/reference metadata. This verifies the
  unchanged-advice sample for those wines, not every cellar wine.
- The signed-in owner UI confirmed **only** the previously owner-approved
  Burgaud *Morgon Côte du Py* 2022 canonical identity, release
  `d1738cd6-f055-2a55-ba83-3f770c3f39cb`. *Les Charmes* and *James* were
  deliberately left unlinked. No wine description, shared membership, stock,
  manual window, approval, publication, switch, or household rollout was edited.
- Linking triggered a fresh **existing-model** calculation for Côte du Py.
  The superseded projection on the card had been `2026 / 2029 / 2036`; after
  reloading the card, the current model is `2026 / 2031 / 2039`. The proposed
  **draft** reference is separately `2025 / 2028 / 2035`; it is **not** live
  advice. The app briefly displayed the old model dates immediately after the
  link; a client refresh-order fix is pending review. This is an identifiable
  recalculation on the deliberately linked wine, not evidence that the draft
  was activated. Because advice changed, Gate 2 is not accepted without owner
  review of this explanation and the live card.
- An owner-bound, private whole-cellar report was recorded against draft
  version `42ea0688-9f14-540b-d346-37decd458d1f`: report
  `cf06fe82-2530-422c-a252-ce52d2f37aed`, hash
  `99f6b975ea565f82ec8410c50c91781f4f8c20b1728f95196ee0e764254d9890`.
  Of 802 wines, **one** has changed proposed dates (Côte du Py 2022), two
  retain manual dates, five have identity conflicts, 84 lack a matching key,
  and 710 have no draft match. The report flags **four unresolved publication
  issues**: one row, one ageing group, and two memberships lack current
  approval. Neither the owner nor this check approved them.
- The signed-in owner screen rendered the private report and its counts, but
  the one changed wine was buried among unmatched rows. A review-screen
  sorting fix is pending so actionable proposals appear first. Mobile layout,
  edit/clear, local ageing choice, and emergency-off walkthroughs remain open.

The draft remains unpublished; no household has opted in. Gate 2 remains **In
progress**, and Gate 1 remains **In progress**. The private report is evidence
for review, not permission to publish. The exact disposable local restore
database used for the before/after comparison was deleted after verification;
the separate protected recovery export remains available outside Git.

## Recovery and remaining work

Keep the emergency switch off and do not approve/publish the draft if a live
wine card or access check is unexpected. The protected export can support a
deliberate operator recovery, but restoring it over a subsequently active
database could erase later user changes; it is **not** an automatic rollback.
Diagnose a failed future migration against the ledger before retrying, and
never repair a conflict by silently relinking a household wine.

PR #209 merged; its preview comparison was inspected by the owner, who found
the proposed rationale clear and asked about the provenance of the current
model dates. The signed-in owner account does not display the separate,
curator-only drinking-window review workspace. This is not an authorization
failure of the cellar comparison, nor permission to self-approve the four
draft subjects. PR #210 makes model provenance and the
curator decision form more explicit; it does not record a decision.

The main-branch Workers build for merge commit `1183a872e65227b6d083c8d22b96239fc50b1116`
completed successfully. The official app initially showed the old PWA shell:
its report said “awaiting your review” and sorted unmatched wines first. A
visible “Update now” PWA prompt was accepted in a read-only signed-in check;
the official app then showed Côte du Py first, separate current and unpublished
dates, four pending reference checks, and no owner decision. Its card still
showed model dates `2026/2031/2039`, using Morgon red place baseline,
Beaujolais 2022 vintage, and Jean-Marc Burgaud producer style. It explicitly
reported no reviewed cuvée profile. The three-date manual editor and private
group selector rendered; neither was saved. No live reference, cellar,
approval, opt-in, switch, or stock data was changed by this check.

Next: have the owner inspect the Côte du Py before/after explanation and the now-visible
private comparison, plus the three-date editor, mobile layout, local ageing
choice, manual edit/clear, and emergency-off behavior. Review the four draft
issues on their merits before any Gate 3 approval or publication. Keep the
global switch and household opt-in off while Gates 1–2 are open.

## 26 October follow-up: release-specific replacement and review scope

The owner separately authorized **only** merged PR #215's migration
`20261026100000_burgaud_release_specific_draft.sql` on linked
`cellarmanager-v02-dev` (`sxdqcvnjtayfxinyospb`). This did not authorize a
curator verdict, publication, runtime switch, household opt-in, or inventory
change. A fresh CLI dry run named exactly this one migration and no seeds,
roles, or Vault operations.

Before applying it, a fresh schema and data export of `public`, `private`,
`auth`, `storage`, and `capture_guard` was stored outside Git on the local host
in `/private/tmp/cellarmanager-pr215-backup.bfJgld` (directory mode `0700`,
files `0600`). Its SHA-256 values are
`e23565cf174ea5187e5ac2767e0a20a67a1fa82a4994f980c1d034d7556c9609`
for `schema.sql` and
`733d1a27a2e995b6ae247eda21c31e02323dfc3aeb02a12df603d6e536210358`
for `data.sql`. The data dump repeated the circular-FK warning from the
earlier backup. A disposable local Supabase Postgres database was prepared
with the required extension schema; the schema and data restored with
`ON_ERROR_STOP=1`, and triggers were disabled **only in that restore session**.
The restored pre-migration snapshot had 810 wines, 4 households, 6 auth users,
one regional draft, and zero publications. Running #215's SQL as the trusted
`postgres` deployment role on this clone succeeded. It left version 1
`withdrawn` and version 2 `draft`, exact release / 750 ml / 2025–2028–2040;
wine and household counts, publication count, and enabled rollout count were
unchanged. The disposable database was then dropped. Initial attempts with
the wrong restore/deployment roles failed transactionally; no live migration
was attempted until the correctly configured clone succeeded.

The authorized `supabase db push --skip-vault --yes` then applied exactly
`20261026100000` with exit code 0. The linked ledger shows it applied and
zero migrations pending. Aggregate-only live queries confirmed version 1
`withdrawn`, version 2 `draft` with `scope=release`, `vintage_year=2022`,
`format_ml=750`, and 2025 / 2028–2040. The live counts remained 810 wines,
4 households, and 6 auth users, with **zero publications, enabled runtime
switches, and enabled household rollouts**. Version 2 has zero draft,
eligibility, and evidence-fit issues; its one review/publication issue is
`missing_current_approval` on the row. The public app returned HTTP 200.
No owner comparison of this new version has yet been approved.

The owner then explicitly selected their existing signed-in pilot-household
**owner** account for drinking-window curation, distinguishing it from the
household's member account. Before the grant, this account already had the
seven ordinary shared-profile curator scopes but no `drinking-window` scope;
no account had that scope. The audited
`set_enrichment_curator_eligibility` function added only `drinking-window` to
its existing scopes and retained the earlier rationale as part of the new
grant rationale. A live check found exactly one active account with the new
scope and still one unresolved row review, zero publications, and zero
rollouts. **No approve/disagree decision was recorded on the owner's behalf.**
The account should now see Catalogue → Shared drinking-window review →
Actual reference drafts; the owner must judge the three dates and their
evidence before any next step. The old four-item regional review is withdrawn
and cannot be approved. A fresh whole-cellar comparison is required after
the row decision because the earlier report targeted the withdrawn version.

The protected export is temporary and sensitive, not a managed backup.
Retain it until the owner walkthrough and a deliberate recovery decision;
restoring it over the live database would erase subsequent user changes and
must never be an automatic rollback. Gate 2 remains In progress and Gate 3
remains Blocked pending the curator decision, fresh owner comparison, and
remaining owner acceptance checks.

## 27 October follow-up: owner-initiated draft comparison refresh

The owner separately authorized **only** PR #219's migration
`20261027100000_owner_draft_shadow_refresh.sql` on linked
`cellarmanager-v02-dev` (`sxdqcvnjtayfxinyospb`) after backup and preflight.
The CLI dry run named exactly that one migration, with no seeds or roles;
`--skip-vault` excluded unrelated Vault operations. No publication, curator
decision, runtime switch, household opt-in, or stock change was authorized.

A fresh schema and data export of `public`, `private`, `auth`, `storage`, and
`capture_guard` is retained outside Git at
`/private/tmp/cellarmanager-pr219-backup.jwh0ek` (directory mode `0700`,
files `0600`). SHA-256:
`8c01c64e28d7d3038bb838c1593e7cb16cd788e30c5604060d6137536ae580d3`
for `schema.sql`, and
`afca57d04902c1e73d55f8a8a7cc33dc3f1fa69d3b42757820910f9c4287d531`
for `data.sql`. The data dump again warned about circular foreign keys.
The backup restored into a disposable local Postgres database with triggers
disabled **only in the data-restore session**. The first restore stopped on
a local role-permission difference; the disposable database was recreated
and restored with its administrator role. After setting its database owner
to the deployment role, PR #219's SQL succeeded there with `ON_ERROR_STOP=1`.
The restored snapshot had 810 wines, four households, six auth users, four
prior private reports, one draft version, zero publications, zero enabled
runtime switches, and zero enabled household rollouts. Those counts were
identical after rehearsal. The new function was executable by `authenticated`
but not `anon`; the underlying report recorder remained inaccessible to
`authenticated`. The disposable database was dropped after verification.

The authorized `supabase db push --skip-vault --yes` applied exactly
`20261027100000` with exit code 0. A post-deployment CLI dry run reported
zero pending migrations. A fresh **live schema** export confirms the new
function is `SECURITY DEFINER`, checks the signed-in household owner's
identity and an existing owner-bound report on an unpublished draft, grants
execution only to `authenticated`, and leaves the report recorder granted
only to `service_role`. The migration contains no data changes; no new live
report was requested during postflight. The live data counts were not
re-queried in this check, so the restored-copy counts above are not presented
as post-deployment live counts. The preview owner walkthrough remains open.

The protected export is temporary and sensitive, not a managed backup.
Retain it until the owner walkthrough and a deliberate recovery decision;
restoring it over an active database could erase later user changes and is
not an automatic rollback. Gate 2 remains In progress and Gate 3 remains
Blocked; the draft is not published or active for any household.

## 27 October follow-up: preserve an unchanged owner decision on refresh

The owner separately authorized **only** PR #220's migration
`20261027110000_owner_draft_shadow_refresh_reuse.sql` on linked
`cellarmanager-v02-dev` (`sxdqcvnjtayfxinyospb`) with backup and preflight.
The CLI dry run named exactly that migration, with no seeds or roles;
`--skip-vault` excluded unrelated Vault operations. The PR's web, database,
dependency, Worker build, and CI gate checks passed before deployment.

A fresh schema and data export of `public`, `private`, `auth`, `storage`, and
`capture_guard` is retained outside Git at
`/private/tmp/cellarmanager-pr220-backup.ijUEok` (directory mode `0700`,
files `0600`). The schema export completed before the push, but the data
export was **still running when the migration was applied**. An interim
15 MB data-file hash was mistakenly recorded in the first edition of this
log; it was not the hash of a completed backup. The data dump subsequently
completed with its PostgreSQL completion marker. Final SHA-256:
`4bfc5a72683860a45d804bf66f5f71f0099b8158ebaad50ffc73dcc49ecc3aa2`
for `schema.sql`, and
`f55950607b79a8d42b3160d8f720d69d8151af2c826341947e41a05104f8ecfd`
for `data.sql` (117,175,591 bytes). The dump repeated the circular-FK
warnings. This timing did **not** meet the promised complete-and-verified
backup-before-push procedure; do not repeat it.

After this was discovered, the completed export was restored with
`ON_ERROR_STOP=1` into an isolated local database. The first restore stopped
on a local role mismatch; the disposable database was recreated under its
administrator role and both schema and data then restored successfully.
The restored snapshot contained 810 wines, four households, six auth users,
two reference versions, 12 private reports, one owner decision, and zero
publications or household rollouts. The isolated database was removed after
validation. This proves the completed export is restorable; it is not a
tested rollback of the live service.

The authorized `supabase db push --skip-vault --yes` applied exactly
`20261027110000` with exit code 0. A post-deployment dry run reported zero
pending migrations. A fresh live public-schema export confirms the owner-only
`SECURITY DEFINER` wrapper now compares the full current snapshot with the
latest report and returns its ID when unchanged; its grant remains limited to
`authenticated`. The function's schema changed, but it contains no data
update, publication, opt-in, or stock operation. We did **not** request a new
live report or record an owner decision during postflight, and did not
re-query live data counts. The preview owner walkthrough remains open: the
old refresh had already superseded the owner's acceptance, so the latest
comparison needs one fresh explicit owner decision. Subsequent unchanged
refreshes should retain it; an actual cellar or draft change still requires
a new decision.

The protected export is temporary and sensitive. Retain it until the owner
walkthrough and a deliberate recovery decision; restoring it over an active
database would erase later user changes and is not an automatic rollback.
Gate 3 remains blocked; no drinking-window reference was published or
activated by this migration.

## 28 October follow-up: owner suggestions and unpublished draft staging

After PRs #222 and #223 merged, the owner explicitly authorized the pending
database deployment with backup and rehearsal. The target remained linked
`cellarmanager-v02-dev` (`sxdqcvnjtayfxinyospb`). A linked-ledger check and
`supabase db push --dry-run --skip-vault` named exactly three local-only
migrations: `20261028100000_owner_drinking_window_candidate_submission.sql`,
`20261028110000_drinking_window_candidate_draft_staging.sql`, and
`20261028120000_drinking_window_draft_identity_titles.sql`. There were no
pending remote-only migrations, seeds, roles, or Vault operations in this push.

A fresh protected export of `public`, `private`, `auth`, `storage`, and
`capture_guard` completed **before** the live push. It is retained temporarily
outside Git at `/private/tmp/cellarmanager-pr222-223-backup.ufOGs1` (directory
mode `0700`, both files `0600`). Completed-file SHA-256: `schema.sql`
`a68fef81bc92a4aac31fc2c4e269eec37327f2c523bb16b43b902ca2e57c5815`
(1,691,952 bytes); `data.sql`
`da0f105ab82fb3361eb199958bf0fcee774d8ccbcc5eca2bc67a1fb813845fb8`
(117,224,750 bytes). The data dump warned about existing circular foreign
keys. Schema and data restored with `ON_ERROR_STOP=1` into a disposable local
Supabase Postgres database; triggers were disabled **only in the data-restore
session**. An initial schema attempt under the non-superuser `postgres` role
stopped on a role-ownership command, so that disposable database was recreated
and restored under `supabase_admin`. The restored baseline had 810 wines, four
households, six auth users, two reference versions, and zero publications,
enabled switches, or enabled rollouts. All three migrations then succeeded in
order on that clone as the deployment role; those counts stayed unchanged and
both private staging tables were present. The disposable database was dropped.

The authorized `supabase db push --skip-vault --yes` applied exactly the three
files with exit code 0. A fresh linked ledger shows all three applied and no
pending migration. Aggregate-only live postflight still shows 810 wines,
four households, six users, two reference versions, **zero** publications,
enabled switches, enabled household rollouts, owner submissions, or candidate
stagings. Anonymous execution of owner submission and curator staging is
denied; `authenticated` has only the guarded RPC entrypoints, not direct read
access to either private staging table. The public app returned HTTP 200.
No live owner submission, curator staging, approval, comparison, publication,
household opt-in, stock action, or advice activation was performed in this
deployment check. An end-to-end owner/curator walkthrough remains open.

This export is temporary and sensitive, not a managed backup. Do not restore
it over subsequent live user changes automatically. Gate 2 and Gate 4 remain
in progress; Gate 3 publication is still separately gated and unauthorized.
