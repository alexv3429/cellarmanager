# Drinking-window release plan — living delivery record

This is the **single progress record** for shipping the
[drinking-window product contract](drinking-window-product-contract.md). That
contract now defines the target behavior and outcome gates. The older
[reference policy](drinking-window-reference-policy.md),
[implementation plan](drinking-window-implementation-plan.md), and
[rollout runbook](drinking-window-staged-rollout.md) are historical/technical
inputs where they differ; reconcile them before general release. Neither a
merged PR nor a passing synthetic test makes the feature released.

**Release target:** One complete, provenance-labelled three-date window from
the most specific applicable shared profile, or a private cellar choice,
followed by a personal offset when applicable. Curators can maintain and
publish complete shared profiles from the app without a developer PR or a
second curator; users can suggest individual changes. The supplied producer
profiles become a reviewed common base, with appellation and region fallbacks
and the labelled existing model as last resort. The initial pilot is a safety
gate, not the permanent way to distribute updates. See the contract for exact
precedence and acceptance examples.

## Current delivery checkpoint — 30 October 2026

The [PR #227](https://github.com/alexv3429/cellarmanager/pull/227) is
**merged and database-deployed, but the feature is not released**. Its seven new
database migrations, plus two earlier pending drinking-window migrations,
were [backed up, rehearsed and applied](drinking-window-gate0-nine-migration-deployment.md)
to the linked project on 29 October 2026 with the owner's authorization.
It is a useful curation foundation, **not** the complete product contract.
Its current behavior is:

1. A reviewer uploads the owner-supplied v1.1 producer JSON files to an
   unpublished research queue. Import does not assert rights, approve a date,
   or change anyone's advice. A reviewer explicitly matches each proposed
   vintage and bottle size to a canonical release before adding it to a
   working reference version. When a producer, cuvée, release, region or
   appellation is genuinely missing, the reviewer can create its shared
   identity in the app after searching for duplicates and recording a reason.
   Those identity decisions are audited; they do not link household wines or
   promote dates. The 23-file bundle parses as 670 research proposals; none
   has been imported into the linked project. A read-only inventory found
   only 8 canonical producers, 3 cuvées/releases, 2 regions and 2
   appellations on that project, so identity creation is essential rather
   than optional for the broader batch.
2. A reviewer may maintain a producer/appellation, producer/region,
   appellation, or region fallback **in the app**. Every fallback has its own
   named ageing category, explicitly eligible wines or places, and three
   vintage-specific years. No region borrows another region's dates. Exact
   release rows continue to outrank broader fallbacks; the existing model
   remains the last resort when there is no reviewed match.
3. The reviewer documents either exact source-stated dates or an explicitly
   labelled, shareable editorial estimate with context links. Group scope and
   membership have separate reviewable explanations. Corrections to dates,
   group definition, or membership are audited, detach superseded evidence,
   and require fresh approval. A draft can be copied without inheriting old
   approvals or cellar comparisons.
4. The reviewer runs the complete draft preflight. A pilot cellar owner
   requests and approves a fresh whole-cellar comparison. Publication is a
   separate in-app action requiring a one-time publisher grant; the migration
   grants that role to **nobody**. Other households remain unchanged. Existing
   opt-in, personal override, and emergency-off behavior remain in place.

**Local verification completed:** all 131 migrations replayed from an empty
disposable database (with the local Supabase storage schema prerequisite but
without its data). All 30 rollback-only drinking-window database suites,
including the eight new suites, passed with the synthetic seed. A positive test
followed review → zero-issue preflight → matched-wine comparison → owner
approval → authorized publication → another household unchanged. It also
exposed and fixed a post-publication comparison regression before deployment.
Web lint, 881 tests, and the production build pass. None of these tests is
evidence that a real producer profile or live household has been activated.
PR #227 also passed its GitHub database, web, dependency-audit, Worker-build,
and aggregate CI gates. The linked database now has the nine migrations;
no profile has been imported, published, or enabled for a household.

**Gate 1 work in slot 2/6 (29 October):** PR #228 adds a private,
owner-managed producer rule for a confirmed producer/cuvée, producer/appellation,
or producer/region, always bound to one vintage and colour. Wine-specific dates
still win; then an applicable cellar rule; then a published exact or eligible
broader shared row; then the labelled existing model. A member's timing offset
shifts all three published years together, while the original shared years
remain visible; it does not shift explicit cellar dates. The wine card offers
rule scope, three years, reason, and removal. Its form uses the **unshifted**
shared/model years as defaults so one member's personal preference cannot be
silently saved for the whole cellar. The single Gate 1 migration was
[backed up, rehearsed, and deployed](drinking-window-gate1-deployment.md)
to the linked database after all PR CI checks passed and the owner authorized
it. The owner tested creating, selecting, and removing a cellar-only rule in
the PR preview on 30 October; a live aggregate check confirmed zero rules
remain. The cross-member personal-offset behavior was not manually checked
in that walkthrough. PR #228 is merged; no shared dates were published. A disposable
local clone passed the new migration, all 31 drinking-window SQL suites, and
the 39 new rollback-only assertions. The full local repository CI passes,
including web lint (existing warnings), 885 tests, and the production build;
PR CI passed before linked deployment. Gate 1
does not include the routine user/curator publication flow, full profile
exchange, or populated common base; those remain Gates 2–5.

**Gate 2 work in slot 3/6 (30 October, PR #229 open):** A curator can
stage an exact canonical wine/vintage and three dates directly in an
unpublished version. That row remains unreviewed until its evidence, rights,
and dates receive fresh review. The existing cellar-owner suggestion path
remains the user entry point. After a zero-issue preflight, the curator must
inspect a fingerprint-bound aggregate impact preview, then may publish
directly in the app. Publication no longer requires a separate publisher
grant or cellar-owner pilot approval; eligible wines in all households use
the published reference automatically. Private wine and producer rules keep
their precedence. The former owner comparison is informational; historical
decisions remain visible but do not control publication. The immutable
publication trail and emergency-off switch remain. The owner authorized the
single Gate 2 migration after CI passed, backup, and rehearsal; it is now
applied to the linked project. **No dates were published or activated**.
Gates 3–5 still cover full JSON exchange, the reviewed initial base, and
official release. Future linked-database migrations still need separate owner
authorization after backup and rehearsal.
The isolated local rehearsal database passed all 32 rollback-only
drinking-window SQL suites, including direct authoring and cross-household
publication assertions. Repository CI passed locally (885 web tests,
lint with existing warnings, and production build), and all
[PR #229](https://github.com/alexv3429/cellarmanager/pull/229) CI checks pass.
The linked project was [backed up, rehearsed, deployed, and checked](drinking-window-gate2-routine-publication-deployment.md)
successfully. Postflight found 810 wines, four households, six users, two
reference versions, zero publications and zero enabled switches. The signed-in
curator workflow has not yet been walked through; Gate 2 is not accepted.

**Execution status (the contract defines each exit test):**

**Hard PR budget:** [PR #227](https://github.com/alexv3429/cellarmanager/pull/227)
is **slot 1/6, Gate 0**. Gates 1–5 have one PR each, slots 2/6–6/6. This
counts #227; it does not permit six additional PRs. Fixes go into the open
gate PR or the next planned gate PR after merge. Gate 5 must include actual
deployment and postflight verification; merging its PR is not enough. If the
remaining work cannot be delivered safely within these slots, stop and ask
the owner before changing scope or opening another PR. Record slot and gate
in every PR description.

| Gate | Status now | Next concrete action |
| --- | --- | --- |
| 0. Lock product contract | Verified by owner on 29 October 2026; #227 merged and nine migrations safely deployed | Preserve the agreed contract and acceptance cases. |
| 1. Core selection and private preferences | #228 merged; linked migration applied; owner tested create/select/remove; cross-member offset has automated but not manual coverage | Preserve precedence and private-rule behavior through later gates. |
| 2. User and curator workflows | In progress in slot 3/6, PR #229; CI green; single migration backed up, rehearsed, linked-deployed and checked; no reference published | Walk through a user proposal and curator review in the preview; publication and second-cellar effects remain to be verified with an approved draft and an explicit release decision. |
| 3. Complete profile exchange | Partial foundation in #227 | Import/export full producer JSON plus agreed appellation and region templates, retaining non-date facts and batch diff/review; resolve the current one-row-per-release/version constraint if multiple bottle sizes need distinct dates. |
| 4. Prepare initial common base | Not started | Process all 23 supplied files and reviewed fallbacks in staging; prepare an approved publication manifest and quarantine every exception with a reason. |
| 5. Release and verify | Not started | Rehearse and authorize migrations, publish the approved initial base, pilot on mobile, then verify ordinary cross-household publication and rollback on the official app. |

**Merge/deployment rule:** Do not describe #227 as feature-complete or ask the
owner to deploy its migrations as the end state. Update this record whenever
implementation changes a gate. Before each merge/test request, state the exact
behavior available, the missing behavior, data/migration effects, a test path
and expected result, and any decision required. No passing test or bulk import
silently approves unverified dates.

## Historical status at 28 October 2026

The older gate numbers in this historical section belong to superseded
rollout plans. They are **not** the six current contract gates or extra PR
slots; the current gate board and PR budget above govern work from #227 onward.

**Current implementation slice (merged and database-deployed, not released):** PR #222 lets
a cellar owner submit a three-date suggestion for a confirmed exact release
and bottle size from its wine card, and see its review status. An authorized
reviewer can inspect it in the review queue. Merged PR #223 adds a
reviewer action that copies a selected unpublished reference version, carries
forward its rows, groups, memberships and evidence links, and stages one
reviewed exact-release suggestion in the copy. The review list now names the
exact producer, cuvée, vintage, colour and bottle size for release rows. The old version, owner
comparisons, and all cellar advice remain unchanged. It neither copies old
approvals nor treats submitted URLs as reviewed evidence; the new draft must
link its own verified sources, pass preflight, receive fresh curator review,
and follow separate publication/owner-choice gates. All three migrations in
this slice were applied to the linked project on 28 October after a protected
backup and successful restored-clone rehearsal. No suggestion or new draft was
created during deployment, and publication and rollouts remain off. It advances Gate 4 but does not
complete it. **Merged PR #225 is not yet database-deployed**. It gives an authorized
reviewer an in-app correction action for an unpublished exact-release row:
change its three dates and rationale, or link/remove an **existing** reviewed,
reusable exact-release maturity-window source. Changes are audited and stale
the prior row approval and whole-cellar comparison; they do not publish dates.
The **current proposed slice, not deployed**, lets a curator register an exact
source page as pending, then explicitly check its three dates and documented
display/reuse rights. Approval creates a pointer-only reviewed evidence record;
the curator must still link it to the draft and review the changed window.
It does **not** turn an owner-submitted URL into proof, nor support a general
ageing description or multi-source research synthesis as direct evidence for
three exact years. Owner-authored synthesis with explicit sharing permission
needs its own reviewed evidence path. Safe supersession, a paginated maintenance
queue, and the mobile interface redesign also remain. The first-100-candidate workspace is only a
bounded intake view, not a complete paginated maintenance queue.

**Pre-release interface gate:** the owner finds the current drinking-window
interface messy. Once the underlying contribution, correction and versioning
pieces are in place, redesign the owner and curator journeys before enabling
the feature for general use. A clear path from suggestion through review,
correction, publication, comparison and local choice must be demonstrated on
mobile; a working backend or a merged PR alone is insufficient.

**Not released.** The merged work through PR #215 provides the database
foundation, candidate staging, draft diagnostics, review decisions, shadow
comparison, publication/opt-in mechanisms, a curator review screen, and the
owner's private ageing-group choice. On the **linked project**, the old Burgaud
2022 Côte du Py / James regional row is now **withdrawn** and cannot be
approved or published. PR #215's migration has staged one exact Côte du Py
2022 / 750 ml **draft** at 2025 / 2028–2040; its curator review is now
approved, but it is not published or active.
With the owner's explicit authorization, the initial **19 migrations** were
applied to the linked `cellarmanager-v02-dev` project after a fresh backup,
restore, and live
preflight. PR #215's separately authorized migration was then applied on
26 October after another protected backup and successful restored-snapshot
rehearsal. The linked ledger now has **0 pending migrations**. The last recorded
deployed Worker version mapped to merged commit
`c2900d0ca845a60ebcb47c8937d206b6b702d517`; a fresh build-hash check
has not been recorded for PR #215, whose SQL is backward-compatible with the
deployed client. The global switch and all household rollouts remain off. The
signed-in owner confirmed one pilot identity, which recalculated that wine's
existing-model dates. An earlier private 802-wine comparison against the now
withdrawn regional draft is **stale**; it cannot approve version 2. Three
unrelated existing advice payloads matched the prior pre-migration snapshot.
The owner inspected the clarified comparison and model-card provenance. The
official app's three-date editor and draft-only local group selector were
opened but not saved. Mobile, manual edit/clear, stale-report, emergency-off,
and owner acceptance are not complete. The confirmed pilot-owner account now
has the explicitly approved curator review scope and has recorded an approval
with a reason. The official review workspace shows zero pending items. The
first 27 October private comparison of version 2 covered 802 active pilot wines:
one proposed date change, two preserved manual windows, five conflicting
local identities, 84 missing keys, and 710 unmatched wines. A zero-issue
preflight was recorded against the same draft hash. After the owner corrected
those five wine cards, a fresh owner-visible comparison found **zero**
identity conflicts: one proposed date change, two preserved manual windows,
84 missing keys, and 715 unmatched wines. The older reports remain immutable
history, not current work or five wines to approve. Nothing has been published
or enabled.
PR #219 adds an owner-only button to record a fresh private comparison of an
already owner-bound, unpublished draft. On 27 October, its **single** migration
`20261027100000_owner_draft_shadow_refresh.sql` was applied to linked
`cellarmanager-v02-dev` after a fresh protected schema/data backup, successful
restore and migration rehearsal on an isolated local database, and a CLI dry
run naming only that migration. A post-deployment dry run shows zero pending
migrations, and the live schema export confirms the authenticated-only refresh
grant while the report recorder stays service-only. The rehearsal preserved
810 wines, four households, six auth users, zero publications, and zero enabled
runtime switches or household rollouts. See the
[deployment record](drinking-window-gate2-deployment.md).
PR #220's unchanged-refresh migration is now live, and the owner confirmed
that a saved whole-cellar decision survives refresh. The owner then approved
the current 802-wine comparison in the preview. A fresh read-only live audit
found one current, owner-approved, non-manual pilot match, zero publication
issues, and a matching zero-issue preflight. No reference has yet been
published or enabled; the pilot publication remains a separate decision.
The newly supplied 23-profile research bundle passes technical validation
but its 670 proposed windows remain unapproved; see the
[intake record](drinking-window-producer-bundle-intake-2026-10-27.md). The
workbook audit has 226 two-date pairs but no complete three-date
shared rows. The existing model and personal timing controls remain in use.
See the [Gate 2 deployment record](drinking-window-gate2-deployment.md).

On 25 October, the owner supplied a [Burgaud producer research
package](producer-research-format.md). It has 14 cuvée profiles, 26 vintage
effects, 53 exact cuvée/vintage calibrations, and 150 proposed windows. It is
research-only: every proposal says `DO_NOT_PUBLISH`, and the 64 release-review
candidates still have no canonical identity, curator, rights, or publication
approval. Its James and Côte du Py 2022 estimates conflicted with the original
regional pilot row, which is now withdrawn. **Gate 3 remains blocked; do not
reuse that broad row.** Validate and review the producer format, then decide the two
release-specific alternatives before any publication.

PR #212 supersedes only the first package's **exchange contract and local
validator**, not a shared reference or curator decision. The proposed 1.1
contract requires an explicit bottle size for each exact release and external
observation, and source/basis labels for pairing hypotheses. Its copyable
template contains placeholders, not Burgaud or other producer evidence. The
revised Burgaud research remains outside the repository and unapproved; even
a valid file cannot create a release, approve dates, or change advice. Gate 3
still needs separate James and Côte du Py identity, date, evidence-fit, rights,
and curator decisions. Gates 1–2 remain In progress; no release gate is
accepted by this schema change.

PR #213 makes validation enforce that full exchange
schema and emits a read-only review packet for **each explicitly evidenced
release and bottle size**. It separates release-existence sources from
date-proposal sources and does not silently reuse 1500 ml observations for
750 ml proposals. This closes a format-validation gap for incoming producer
files; it does **not** stage Burgaud data, grant curator access, approve dates,
publish a version, or complete any gate. Incoming producer files can follow
the same validation path without becoming effective advice automatically.

The owner has now supplied four private v1.1 producer files. Clavelier (18
exact release proposals), Barthod (17), and revised Burgaud dataset 1.0.3 (15) pass the new local
validator. Boillot has 22 proposals but fails on five repeated uses of one
source ID in its Épenotes structure/pairing entries; de-duplicating those
pointers **in memory only** passes validation. Preserve the submitted file and
record any mechanical correction in a separate private review copy before
staging; do not silently edit the evidence. All 72 proposed release windows are
still marked unapproved and all 144 source records have rights unreviewed.
Burgaud proposes James 2022 at 2026 / 2030–2038, versus the withdrawn
regional draft's 2025 / 2028–2035. The revised file adds an exact Côte du Py
2022 / 750 ml proposal of 2025 / 2028–2040, leaving the former 14 Burgaud
proposals unchanged. This closes the *research-file coverage* gap, not the
evidence or approval gap: the 2040 probable optimum end is inferred from a
general Vinous drinking range and conflicts with another retailer's
“drink before 2031” guidance; the reproduced Decanter description may be
misattributed. The proposal itself marks confidence low and is not approved.
Do not reactivate the regional draft or activate the replacement merely
because it validates. The next review must resolve these release-specific
dates, source fit, rights, and identities;
none of the four files is active shared advice.

Eight more owner-supplied v1.1 producer files were received on 25 October:
Cazeneuve (42 exact proposals), Clos Marie (31), Chagnoleau (42), Jacques
Carillon (24), Castagnier (22), Jobard-Morey (32), Mas Jullien (35), and
Michel Bouzereau (39). **All eight pass local schema and cross-reference
validation**: 120 cuvée records, 267 exact cuvée/vintage/format proposals,
and 377 source pointers in this batch. Every proposal remains explicitly
`candidate_not_approved` and the validator reports zero publishable rows.
The files also declare 80 source discrepancies and 82 research gaps; passing
the format check is not a source, rights, canonical-identity, or three-date
approval. The packages remain private and outside the repository, and none
has been imported into the linked database or made effective advice. The
previous Boillot pointer error is still separate and unresolved.

Merged PR #215 added an **inert migration**, now applied to the linked project:
version 1 became `withdrawn` without deleting its evidence, reviews, or private-choice
references; version 2 has one exact Côte du Py 2022 / 750 ml draft row with
the owner's provisional **2025 / 2028–2040** dates. James is not staged.
Draft and active matchers enforce format, while the older unqualified preview
cannot match a format-specific row. A rollback-only local test found zero
shape, eligibility, or evidence-fit issues for version 2 and **one missing
curator approval**. This is a staged candidate, not published advice. The
linked database now has version 2 as a draft, but no wine advice, publication,
runtime switch, or household rollout was activated. A protected backup
restored to a disposable local database; the migration succeeded there before
live application. Live checks found 810 wines, 4 households, 6 auth users,
0 publications, 0 enabled switches, 0 enabled rollouts, 0 draft/eligibility/
evidence-fit issues, and 1 missing curator approval. After the owner identified
their signed-in pilot-owner account, an operator used the audited eligibility
function to add only its `drinking-window` review scope. No review decision
had been recorded at the time of that deployment check. The owner has since
approved the exact draft in the curator role and accepted a current
whole-cellar comparison as the pilot cellar owner. Gates 1–2 remain In
progress. The database preflight for Gate 3 is green, but Gate 3 is not
accepted: the remaining owner-facing checks, separate publication authority,
and live postflight evidence are still required.

Statuses below mean **Not started**, **In progress**, **Blocked**, or
**Accepted**. A step becomes Accepted only when its named evidence is recorded
here, not when its PR merges. Dates are not delivery promises.

| Gate | Status | Immediate outcome |
| --- | --- | --- |
| 0. Reconcile deployment state | Accepted | All 19 migrations replayed on a private clone; the fresh backup, restore, live preflight, and deployment record complete the just-in-time checks. |
| 1. Close owner-facing behavior | In progress | Three-date editing, comparison, identity review, and private group choice are merged. The official card, editor, and draft selector were inspected read-only; mobile, actual edit/clear, stale-report, emergency-off, and owner acceptance remain. |
| 2. Deploy database capabilities | In progress | The authorized 19-migration batch, PR #215 replacement, PRs #219–#220 owner-refresh migrations, and PRs #222–#223 owner-suggestion/draft-staging migrations are live. The #222–#223 batch followed a completed protected backup and restored-clone rehearsal; see the [deployment record](drinking-window-gate2-deployment.md). Three existing advice payloads matched the prior batch snapshot; one owner-confirmed pilot link recalculated its old-model advice. The owner tested unchanged refresh and approved the current comparison. Switch, publication, and household opt-in remain off. |
| 3. Publish one real pilot | Blocked by unfinished Gate 1–2 checks, separate publication authorization, and live postflight | One approved cellar can see a verified real window. |
| 4. Make reference maintenance routine | In progress (intake and staging live; correction merged but not deployed; source verification proposed) | Owner exact-release suggestions can enter curator review; a reviewed suggestion can be staged in an unpublished copy. PR #225 adds correction and linking of existing verified evidence. This PR proposes a pending-to-reviewed source/rights workflow for directly stated exact dates. Reviewed owner-authored synthesis, safe supersession, pagination, and separate publication still remain. |
| 5. Establish and measure initial coverage | Blocked by gate 4 | One additional high-impact reference is reviewed; gaps remain visible. |
| 6. Release and operate | Blocked by gates 3–5 | The supported feature has repeatable checks, monitoring, and rollback. |

## Gate 0 — reconcile the actual deployment (technical owner)

The [Gate 0 audit, updated 24 October](drinking-window-gate0-audit.md)
records a fresh read-only linked inventory of **19 pending migrations**,
the exact merged-commit-to-deployed-version mapping, a successful full-batch
private-clone replay, zero changed core advice responses across 782 wines
and 4 overviews, and a second clean restore. In a rolled-back transaction,
the owner-confirmed pilot wine linked to its unique canonical release and
produced one draft match. At that audit the live wine was still unlinked; the
owner later confirmed its identity in the app. The temporary export
and both scratch databases were removed. **Gate 0 technical evidence was
accepted for this batch.** The separately authorized live application and its
just-in-time checks are recorded in the
[Gate 2 deployment record](drinking-window-gate2-deployment.md).

1. Compare the deployed Worker build and linked database migration history with
   the merged repository. Record exact hashes and pending migrations here.
2. Audit all pending migrations for existing-data compatibility and access
   changes. Rehearse them on a representative **private** clone/snapshot,
   record backup and restore steps, and verify that existing advice is
   unchanged while the reference feature is off.
3. Inventory the proposed pilot wine's **real** household identity links,
   vintage, colour, existing dates, and whether the draft would actually
   match after an explicit owner link. Resolve uncertainty with the owner,
   not a fuzzy-name guess. A private-clone simulation is sufficient for this
   predeployment gate; the **live** owner link and fresh report belong to
   gates 2–3 after the review RPC exists on the target.

**Accept only with:** migration inventory, rehearsal result, backup/restore
evidence, live/merged hash comparison, and a rolled-back private-clone pilot
match report linked in this record.

**Stop if:** an existing household's advice changes before opt-in, a
migration cannot be replayed safely, or the pilot identity is uncertain.
Read-only inspection needs no production write; applying migrations is a
separate, explicitly approved action.

## Gate 1 — close owner-facing behavior (product and technical owners)

PR #203 implements action 1
without changing the existing model's four-year calculation: new personal
manual windows require three dates, while an older personal `drink by` year
remains visible and is retained unless the owner explicitly clears it. A
manual window also remains visible without a model projection. Until the
database advertises three-date support, the new client retains the existing
four-date editor and sends no null fourth year. A rollback-only run of the new
migration plus 74 maturity database assertions passed on the local database;
web lint, 829 tests, and build passed. This is **not deployed** and does not
accept Gate 1. Its migration joined the successful full-batch rehearsal.

PR #204 addressed action 3: a new owner-bound shadow report compares the
proposed three dates with the current manual window, currently selected shared
reference, or model **after that owner's personal timing adjustment**. If an
active reference has an ambiguous/conflicting identity, the baseline is shown
as unavailable, as on the cellar screen. The report hash changes when the
owner's timing changes; service-side publication replays that same owner-bound
hash. Owners cannot approve one another's reports, and a later report makes
an earlier review stale. Each request makes a fresh report. Old reports lack an
owner binding and are hidden from the new owner list; a fresh comparison is
required. The migration and 26 comparison, 24 owner-review, and 34 publication database
assertions passed in rollback-only local transactions. This remains
**not deployed or owner-walked-through** and does not accept Gate 1.

PR #205 makes the existing private canonical-identity review reachable
from an individual wine card, then refreshes maturity and match details after
an owner changes the link. A new report snapshot carries the matched
ageing-group definition and reference-row rationale together with the proposed
dates; editing that definition changes the review hash. Six new database
assertions and 84 existing shadow/comparison/publication assertions passed in
rollback-only local transactions; focused web tests and build passed. This
does **not** add a local ageing-group override or activate any shared date.

Merged PR #206 adds an owner-only, version- and scope-specific local choice of an
applicable ageing group, an explicit unclassified option, and a way to clear
the choice. The choice is fingerprinted to the confirmed wine identity,
private to its household, and has no effect on shared membership. A draft
choice does not activate shared dates; active matching and the owner comparison
use it only for an opted-in reference. The comparison hash includes the
choice revision so a reviewed report cannot be silently reused after a change.
Twenty-six new database assertions and the 84 existing
shadow/comparison/publication assertions passed in local transaction tests;
web lint, 837 tests, and build passed. This is **not deployed or accepted**.
The fresh 19-migration private-clone rehearsal has now passed Gate 0.

1. Make the private manual override use the agreed **three** milestones. Keep
   legacy four-year records readable without inventing or silently dropping a
   `drink by` date. Prove precedence: manual override > opted-in reviewed
   reference > labelled existing model > unavailable.
2. Give an owner a comprehensible way to confirm/change the wine's canonical
   identity and local ageing-group eligibility or preference where needed;
   never let that private choice silently alter the shared group definition.
   Identity review is now reachable from the wine card, a matched group's
   definition appears in the comparison, and PR #206 adds a private group
   preference. Owner review of that behavior remains required.
3. Make the whole-cellar comparison show the **dates the owner actually sees**,
   including any private model timing adjustment, as well as proposed three
   dates and their sources. Implemented in merged PR #204; verify against
   the actual pilot cellar before accepting the gate.
4. Test mobile layout, manual edit/clear, no match, ambiguous match, changed
   identity, stale comparison, and emergency-off behavior with real UI paths.

**Accept only with:** automated precedence/compatibility tests and a recorded
owner walkthrough on a representative cellar, including a before/after report
for one manual, one matched, and one unmatched wine. That walkthrough may
follow gate 2's *inert* schema deployment because the required RPCs are not
on the linked project yet.

**Stop if:** a date changes without an intelligible source or a private choice
leaks into shared data.

## Gate 2 — deploy the inert capabilities (operator + cellar owner)

The [authorized 24 October deployment and signed-in check](drinking-window-gate2-deployment.md)
completed the database batch, linked-ledger verification, switch/rollout
checks, permission checks, public app smoke, owner-confirmed pilot identity
link, private comparison, and a three-wine unchanged-advice sample. A
protected temporary backup is retained outside Git. Confirming the pilot
identity recalculated its existing-model advice, which requires explicit
owner review; mobile/edge-case walkthroughs are also open. Therefore Gate 2
is **In progress**, not Accepted.

1. Obtain explicit authorization for the **named** migration batch and target
   project after gate 0 rehearsal and automated gate 1 checks. Take a new
   protected backup and rerun preflight. Apply migrations in order, then
   deploy or verify the compatible Worker/client build. Gate 1's *live* owner
   walkthrough is completed after this inert deployment, not before it.
2. Run database and UI smoke checks against the target: current wine card,
   owner-confirmed canonical pilot link, draft review, fresh shadow report,
   access boundaries, and global emergency-off. Have the owner inspect the
   real UI before accepting gate 1; this still does not publish a window.
   Keep publication and household opt-in disabled during this check.
3. Record migration IDs, deployment hashes, smoke results, and recovery action.

**Accept only with:** target-specific execution log and a verified unchanged
existing-advice sample. **Stop and assess recovery if:** permissions broaden,
an existing wine changes advice, or the old client cannot coexist with the
new schema.
The owner approves the production write; CI passing alone does not authorize
it.

## Gate 3 — one real, consented pilot (curator + cellar owner + operator)

1. PR #215's inert migration is applied. Review the exact Burgaud Côte du Py
   2022 / 750 ml draft's three dates, identity, owner evidence, and
   uncertainty. The dates are the owner's
   estimate; third-party descriptions establish identity/relative ageing,
   **not** those exact years. Record explicit approval or disagreement for
   its single row. James remains research-only and needs separate decisions.
2. Require zero draft, eligibility, evidence-fit, review, and publication
   preflight issues. Generate a fresh **whole-cellar** comparison. Have the
   pilot owner inspect the exact changed/unmatched wines and approve it.
3. Publish the immutable version with a trusted operator, opt in only that
   consenting cellar, and verify the same three dates/source on the wine card
   and catalogue. Verify manual override wins and a non-consenting cellar is
   unchanged. Exercise the emergency switch and restore the approved state.

**Accept only with:** decision IDs, preflight/report hashes, owner approval,
publication/version ID, affected-wine screenshots or test records, and a
non-opted-in control result, recorded here. **Stop if:** no actual cellar wine
matches, any review is stale, comparison differs from the visible advice, or
the control cellar changes. Publishing the draft is **not** this PR's action.

## Gate 4 — routine shared-reference maintenance (product + curator)

1. Provide authorized curator workflows to propose/edit a draft, attach and
   assess evidence/rights, define scoped groups/memberships, review all three
   dates together, and create a superseding immutable version **without a
   code PR per wine**. A disagreement must lead to an in-app correction action
   with a fresh review, not merely a text reason; until then it blocks
   publication. Show provenance and disagreement history.
2. Provide a safe owner suggestion/correction path; proposals do not publish
   themselves. Let owners review identity matches and keep local preferences
   private. Show when a new published version is available, with fresh
   comparison before opt-in.
3. Prove two-curator disagreement, stale approval after edit, overlapping
   groups, rights rejection, and old-version stability in tests and UI review.

**Accept only with:** a non-developer curator taking a new sample from proposal
to reviewed superseding version in a test environment, without SQL editing;
access-control tests and an owner walkthrough. **Stop if:** publication can be
triggered by an unreviewed suggestion or a previous version changes in place.

## Gate 5 — reference coverage, by evidence-backed batch (curator + owner)

1. Rank gaps by actual cellar impact. Reconcile the workbook's 226 two-date
   pairs with original source cells and rights; research/author an explicit
   first-tasting year rather than deriving one at runtime. Do not import
   private manual dates into the shared library.
2. Complete canonical producer, appellation, region, colour, vintage, and
   scoped ageing-group eligibility for each proposed row. Keep Alsace and
   Beaujolais independent; do not borrow another region as a shortcut. Check
   producer/cuvée guidance before broader place guidance.
3. For the first supported release, complete **one additional high-impact
   reference row beyond the pilot**, selected from a whole-cellar gap report,
   using the routine gate 4 workflow. Record why it was prioritized and which
   actual wines it covers. Then continue in small reviewed versions. After
   each, record counts of wines with
   manual, reviewed reference, existing-model, ambiguous, and unavailable
   advice, plus unexpected changes in a whole-cellar comparison. Owners opt
   in per version, not automatically.

**Accept the initial gate only with:** the whole-cellar coverage baseline, the
ranked top ten uncovered profiles by affected bottle count, and the first
additional reviewed row through the in-app workflow. **Accept any batch only
with:** source-cell/evidence pointers, rights decision,
three explicit years, membership review, zero preflight issues, measured
coverage and comparison review. **Stop if:** a generic profile treats all
grapes/cuvées alike without reviewed eligibility, or a gap is filled by an
unlabelled guess. Broad coverage is a continuing data programme, not a claim
that every wine must be covered to release a supported first version.

## Gate 6 — supported release and ongoing operation (product + operator)

1. Redesign the owner and curator drinking-window interface before general
   deployment. Test the mobile paths for proposing dates, understanding review
   status, correcting a proposal, comparing advice, and making a private
   choice with the owner. Remove ambiguity between a local estimate, a shared
   draft, and published advice.
2. Run the acceptance set on the deployed app: opted-in and unopted-in
   households, manual override, local preference, missing/ambiguous reference,
   version supersession, mobile use, and emergency-off. Record actual results,
   not just test names.
3. Document who reviews new sources, who may publish, how an owner reports a
   wrong date, how a correction is versioned, and when the emergency switch is
   used. Monitor match/ambiguity/fallback and owner rejection rates without
   leaking cellar contents.
4. Announce the feature as available only after the pilot passes, the routine
   curation workflow works, and the owner accepts the live behavior. State
   measured coverage and limitations visibly; continue gate 5 in batches.

**Accept only with:** a signed-off release checklist, deployment/version IDs,
current coverage report, operator runbook, and recovery rehearsal. **Stop if:**
the reference cannot be disabled promptly or a new version changes an owner's
dates without fresh consent.

## Change control — required on every relevant PR

Every PR changing drinking-window behavior, reference data, migrations,
curation, tests, or policy must update **this file in the same PR**. The CI
guard checks that it was changed; reviewers check that the update is
meaningful. At minimum, each update must:

- identify the affected gate, action completed or changed, and evidence;
- revise status/risks/dependencies honestly, including any new work discovered;
- state whether live advice, permissions, or deployment state changed;
- add a dated row below with the PR number once known (or branch name until
  the PR exists). A merge is not acceptance evidence by itself.

| Date / change | Gate and decision | Evidence / remaining risk |
| --- | --- | --- |
| 2026-10-22 · PR #201 | Establish this tracked release plan and CI update guard. All delivery gates remain open. No live advice or database state changes. | Existing merged implementation and draft are described above; CI proves a plan update accompanies future relevant PRs, but cannot judge its quality. |
| 2026-10-22 · PR #202 | Gate 0 moved to In progress after read-only linked migration/status checks and static review. No live advice, permission, or database change. | [Audit](drinking-window-gate0-audit.md) records 13 pending migrations, seed conflicts to preflight, and reader compatibility risk. Private rehearsal, backup/restore, active deployment hash, and owner authorization remain open. |
| 2026-10-23 · PR #202 update | Gate 0 aggregate linked preflight completed read-only; no live advice, permission, or database change. | Reference-version count 0; checked Beaujolais/Morgon/Burgaud/Barraud identity counts 1 each; six other producer names 0 exact normalized matches. Cloudflare version 420 deployed at 20:53:20Z on 22 October, but its commit remains unverified. Private rehearsal and restore evidence remain open. |
| 2026-10-23 · PR #202 private replay | Gate 0 remains In progress; no-go for live migration. No live application advice or access policy changed, and no migration was applied. | Owner-approved protected snapshot restored locally; all 13 migrations passed; every checked wine-card and household-overview core payload stayed unchanged with feature off; a second clean restore passed. Temporary data deleted. One plausible pilot wine has no canonical release link; active Worker commit remains unverified. See [audit](drinking-window-gate0-audit.md). |
| 2026-10-23 · PR #202 owner confirmation | Gate 0 remains In progress; no live wine identity, advice, permission, or deployment state changed. | Owner confirmed the proposed Burgaud Côte du Py 2022 pilot wine's identity. Its canonical release link is still absent, so no real match is established. Active Worker commit remains unverified; Gate 1 and live-migration authorization remain open. See [audit](drinking-window-gate0-audit.md). |
| 2026-10-23 · PR #203 | Gate 1 action 1 implemented locally; Gate 1 remains In progress and Gate 0 gains one migration to rehearse. No live advice, access, identity, or deployment changed. | New manual windows have three required years only after the database confirms support; the old database keeps the current four-date editor. Existing personal fourth dates remain visible and explicitly clearable after upgrade; manual advice is visible even without a model projection. Web lint, 829 tests, and build passed; 74 maturity database assertions passed with the new migration inside a rolled-back local transaction. Gate 1 identity, comparison, and owner walkthrough remain open; Gate 0 needs a fresh private-clone rehearsal of all 14 migrations. |
| 2026-10-23 · PR #204 | Gate 1 action 3 implemented in the merged owner-bound comparison; Gate 1 remains In progress. No live advice, permission, or deployment changed. | The current baseline includes personal timing; report hashes bind the owner and invalidate stale reviews. The 26 comparison, 24 review, and 34 publication SQL assertions passed locally. The pilot cellar walkthrough and a fresh private-clone rehearsal remain open. |
| 2026-10-23 · PR #205 | Gate 1 action 2 partly implemented in the merged wine-card identity review and ageing-group rationale; Gate 1 remains In progress. No live advice, permission, or deployment changed. | Six new SQL assertions plus 84 prior regression assertions passed locally. The private group preference and owner walkthrough were still missing after this PR; the migration batch grew to 16. |
| 2026-10-23 · PR #206 | Gate 1 action 2 local choice implemented, but not accepted or deployed. No live advice, linked database, or shared membership changed. The owner-only RPC adds a private access path, not a public permission expansion. | A confirmed wine can select an applicable group, remain unclassified at one scope, or restore reviewed membership for a particular reference version. The choice changes only opted-in matching; changing identity makes it stale, and a superseded version pinned by the cellar remains editable. Twenty-six new SQL and 84 regression assertions passed locally; web lint, 837 tests, and build passed. Gate 0 now needs fresh private-clone rehearsal of 19 migrations. Mobile, real-cellar walkthrough, and deployment authorization remain open. |
| 2026-10-24 · PR #207 | Gate 0 technical evidence accepted for the current 19-migration batch. Gate 1 remains In progress; Gate 2 requires explicit authorization. No live schema, identity, advice, permission, stock, or deployment change was made by this audit. | [Fresh audit](drinking-window-gate0-audit.md): merged commit mapped to the 100%-deployed Worker version; all 19 migrations applied to a protected private clone; 782 wine and 4 overview core responses unchanged; second restore matched source counts; rolled-back owner-confirmed pilot link yielded one draft match. Temporary export and both clones deleted. Just-in-time backup/preflight, live link, owner walkthrough, and publication review remain open. |
| 2026-10-24 · PR #208 | Gate 2 inert database batch deployed with explicit owner authorization; Gate 2 remains In progress pending signed-in owner checks. Live schema, canonical seed identities, and owner-only RPC permissions changed, but the operator made no pilot link, publication, opt-in, stock operation, or manual-window edit. | [Deployment record](drinking-window-gate2-deployment.md): fresh protected backup restored successfully, live preflight matched rehearsal, all 19 files applied and 0 pending, compatible Worker hash verified, 788 wines/4 households/6 users unchanged, one draft and zero active/publications/enabled switches/rollouts. Ordinary-role privilege and public-app smoke checks passed. Existing-advice sample and owner UI walkthrough remain open; sensitive temporary backup retained for recovery. |
| 2026-10-24 · PR #209 | A signed-in owner check linked only the previously approved Burgaud Côte du Py 2022 identity and generated a private 802-wine comparison; no shared draft was approved or published, no household opted in, and the emergency switch remains off. Gate 1 and Gate 2 remain In progress. | [Follow-up record](drinking-window-gate2-deployment.md): three other pre-migration advice payloads unchanged; one changed draft proposal, four items requiring human approval. Linking triggered a fresh old-model calculation for the pilot (`2026/2029/2036` → `2026/2031/2039`), distinct from the unpublished draft (`2025/2028/2035`). This PR moves the actionable row to the top of the report and refreshes the wine card promptly; web lint (pre-existing warnings), all 840 tests, and build pass. Owner mobile/edit/choice checks and approval review remain. |
| 2026-10-24 · PR #209 review clarity update | Gate 1 remains In progress; no reference, cellar data, approval, publication, or rollout changed. | The comparison now shows current and unpublished draft as separate three-milestone panels, explains the regional rule's limited wine eligibility in French, and requests no owner decision while the four reference checks remain open. Added a French owner-report regression test; web lint (pre-existing warnings), 841 tests, and build pass. Owner mobile walkthrough and reference approvals remain open. |
| 2026-10-24 · official app check after #209 | Gates 1–2 remain In progress; no wine, reference, approval, publication, or rollout was edited. | The main-branch Cloudflare build succeeded. The browser initially held the previous PWA shell and showed misleading “awaiting your review” wording; accepting its visible update prompt loaded the merged screen. Official Catalogue now shows the unpublished 2025/2028–2035 draft apart from current model 2026/2031–2039, with four pending reference checks and no owner decision. The wine card traces current model dates to Morgon red place baseline, Beaujolais 2022 vintage, and Jean-Marc Burgaud producer style; it explicitly lacks a reviewed cuvée profile. The three-date manual editor and draft-only private group selector were opened but not saved. |
| 2026-10-24 · PR #210 | Gates 1–2 remain In progress; Gate 3 still requires curator and owner decisions. No reference, cellar data, approval, publication, switch, or rollout is changed. | The current model's provenance is explained beside the comparison with a path to its profile trace. The curator draft screen surfaces pending items first, displays all three years separately, and requires an explicit decision instead of preselecting approval. The signed-in pilot owner account has no curator review workspace; an authorized curator must review the one row, one ageing group, and two exact-release memberships. |
| 2026-10-25 · PR #211 | Gate 3 remains blocked. The owner-supplied producer package is validated as a research-only exchange format; neither the shared draft nor live advice, access, database, switch, or rollout changed. | A read-only validator emits a James-specific dossier with the date conflict and no publication permission. Six new tests and the 41-test drinking-window suite pass. James 2022 and Côte du Py 2022 each need a separate three-year decision; canonical release, source fit, rights and curator review remain open. |
| 2026-10-25 · PR #212 | Gate 3 research intake is made safer with a producer-independent 1.1 exchange schema, format-aware read-only validator, and placeholder template. Gate 3 remains Blocked; Gates 1–2 remain In progress. No live advice, permission, database, deployment, switch, or rollout changes. | The revised contract requires explicit bottle size and pairing provenance; the template passes local schema validation and the 41-test drinking-window suite. Earlier Burgaud 1.0 research needs migration before validation under 1.1, and the revised private Burgaud file is not published or committed. Source fit, rights, canonical identity, competing James/Côte du Py dates, curator decisions, and owner comparison remain open. |
| 2026-10-25 · Burgaud dataset 1.0.3 intake in PR #213 | Gate 3 remains Blocked. The new private research file validates against the 1.1 contract and adds one exact Côte du Py 2022 / 750 ml candidate; no reference, draft, cellar advice, access, database, deployment, switch, or rollout changed. | The 14 prior Burgaud candidates, including James 2022, are unchanged. Côte du Py proposes 2025 / 2028–2040 versus the unpublished regional draft's 2025 / 2028–2035, with low confidence and no approval. Its 2040 endpoint is inferred from a general drinking range, disputes “drink before 2031” guidance, and a reproduced Decanter review needs attribution checking. Source fit, rights, canonical identity, curator decision, and fresh owner comparison remain open. |
| 2026-10-25 · Burgaud source reconciliation | Gate 3 remains Blocked; the revised research is not published or staged as shared advice. | [Pilot source review](drinking-window-first-shared-draft.md) compares the exact 2022 Côte du Py release with the proposed three milestones. A 2040 drinking horizon does not establish 2040 as the optimum end; exact-release merchants offer much shorter horizons, and the reproduced Decanter terroir description conflicts with the estate's. Keep the existing regional draft unpublished. Obtain an explicit owner/editorial choice for each release, then create a release-scoped draft with reviewed evidence and a fresh curator/owner comparison. |
| 2026-10-25 · Côte du Py owner choice | Gate 3 remains Blocked; no database draft, shared advice, switch, or cellar record changed. | After review of the conflicting evidence, the owner chose **2025 / 2028–2040** for an exact Côte du Py 2022 draft. It remains an owner-authored, low-confidence estimate, not three published critic milestones. James remains a separate unapproved proposal; rights, curator decisions, and owner comparison remain open. |
| 2026-10-25 · eight-profile research intake | Gate 3 remains Blocked; no producer file, candidate, reference, cellar advice, permission, database, switch, or rollout changed. | Cazeneuve, Clos Marie, Chagnoleau, Jacques Carillon, Castagnier, Jobard-Morey, Mas Jullien, and Michel Bouzereau pass the same local v1.1 validator: 267 exact proposals and zero publishable rows. Their 80 declared discrepancies and 82 research gaps require evidence and identity review before any selective staging. |
| 2026-10-26 · PR #215 release-specific replacement | Gate 3 remains Blocked. A new, inert migration withdraws the old regional draft without deleting its history or local-choice references, and stages one exact Côte du Py 2022 / 750 ml draft at **2025 / 2028–2040**. James is not staged. No linked database, Worker, cellar advice, publication, switch, or rollout has changed. | Rollback-only local migration and 24 focused SQL assertions passed: 750 ml matches, 1500 ml and James do not; draft/eligibility/evidence-fit diagnostics return zero issues and one curator approval is still missing. A prior local group-choice regression test was also found failing at assertions 17 and 20 on the unchanged local schema, so its remaining behavior requires a clean CI run. Applying the new migration is a separate, explicit live authorization. |
| 2026-10-26 · post-merge #215 deployment | Gate 2 remains In progress; Gate 3 remains Blocked. The owner separately approved only migration `20261026100000`, which was applied to linked `cellarmanager-v02-dev` after a protected backup, successful restore, and rehearsal. The owner explicitly identified the pilot-owner account for a narrow `drinking-window` curator-scope grant. No curator verdict, owner report approval, publication, switch, rollout, inventory edit, or advice activation occurred. | Dry run named exactly one migration; the restored snapshot had 810 wines, 4 households, 6 users, one regional draft and zero publications. Rehearsal yielded v1 withdrawn and v2 exact 750 ml draft. Live ledger has 0 pending; live counts remain 810/4/6, zero publications/switches/rollouts, and v2 has zero draft/eligibility/evidence-fit issues but one `missing_current_approval`. The signed-in account now has the review scope. Protected backup is retained temporarily; see [deployment record](drinking-window-gate2-deployment.md). |
| 2026-10-26 · PR #216 curator-copy follow-up | Gate 3 remains Blocked; no date, evidence, approval, publication, switch, rollout, or cellar record changes. | After the owner found the live review confusing, the proposed client now identifies the row's exact-release scope and bottle size, renders the seeded owner estimate and its 2040 caveat in French, groups repeated links to the same source, and labels evidence-review/reuse metadata as source-record status rather than date verification. The underlying draft and the requirement to check all three dates are unchanged. Curator and cellar-owner decisions remain open. |
| 2026-10-26 · PR #216 owner walkthrough follow-up | Gate 3 remains Blocked and Gate 4 remains Not started; no draft, approval, or publication changes. | The owner found “owner” ambiguous, the authorized-reviewer role unexplained, an external GitHub source opening a blank new tab, and “correction needed” misleading because the form records only a disagreement. The proposed client now names the CellarManager cellar owner as the date proposer, explains shared-reference review permission, opens source links in the same tab with a Back instruction, and states that disagreement blocks publication but cannot edit dates. A revised draft still needs separate preparation and review. Gate 4 must provide a real in-app draft correction path; a reason field is not that path. |
| 2026-10-26 · PR #216 decision-note presentation follow-up | Gate 3 remains Blocked and Gate 4 remains Not started; no draft, approval, or publication changes. | The owner found the extra ownership disclaimer heavy and wanted the linked Markdown note readable in the app. The proposed client removes that redundant note and opens the bundled, current-branch decision record in an in-app panel with rendered headings, tables, and links. GitHub remains an optional original-document link; other external evidence links are unchanged. This improves review usability only, without treating the owner estimate as producer evidence. |
| 2026-10-26 · PR #216 one-tap review disclosure | Gate 3 remains Blocked and Gate 4 remains Not started; no draft, approval, or publication changes. | The owner reported that the draft review card needed two taps to open. The browser's native `<details>` toggle and React's controlled `open` state could cancel each other on the first tap. The proposed client prevents the native toggle and lets the controlled state handle opening and closing; a click regression test covers both directions. No review decision is made by opening the card. |
| 2026-10-26 · post-merge curator approval and review-status follow-up | The owner recorded an approval and reason for the exact Côte du Py 2022 / 750 ml draft in the official app. The live review workspace now shows zero pending items, but version 2 is still an unpublished draft. Gate 3 remains Blocked, and no publication, household opt-in, or switch-on is implied. | The official UI displayed the current approval and reason, while incorrectly leaving the empty decision form open. This follow-up makes completion explicit, closes the item after saving, and keeps the completed item readable with an intentional re-review action. A fresh owner-bound whole-cellar comparison and owner acceptance are still required before any publication decision. |
| 2026-10-27 · private version 2 comparison and preflight | Gate 3 remains Blocked. A private report (`6d75d186-8ed4-41b7-b28c-be5d91aa52c7`) and matching zero-issue preflight (`0ba42f41-71ae-4e54-816f-ecac8f98856a`) were recorded on linked `cellarmanager-v02-dev`. No stock, cellar metadata, shared draft, approval, publication, switch, or opt-in was changed. | The report hash is `6be044ea01ea5bab2f5d009b43735f7f390b7ae05343bd6aa18f7c00990f4a01`; it covers 802 active wines. Exactly one changed row is Burgaud Côte du Py 2022, current model 2026 / 2031–2039 versus draft 2025 / 2028–2040. Two manual windows are preserved; five local appellation/region identity conflicts block owner approval, with 84 missing keys and 710 unmatched wines. The owner must inspect and correct the five wine cards; a fresh report is then required. |
| 2026-10-27 · owner-visible version 2 comparison | Gate 3 remains Blocked. The preceding service-recorded report had no owner binding and therefore was correctly hidden from the owner's Catalogue. After verifying the pilot household owner and draft status, a fresh report (`268ea38e-64d5-44ce-8588-e6b7bfd49194`) was generated with that owner as the request actor. No reference was published, no household opted in, and no stock or wine record changed. | The new 802-wine report has the same content hash `6be044ea01ea5bab2f5d009b43735f7f390b7ae05343bd6aa18f7c00990f4a01` and zero draft issues. The signed-in owner Catalogue was refreshed and shows version 2 above withdrawn version 1 under “Examiner les dates de dégustation partagées.” The five local identity conflicts still block approval. Future pilot reports must be generated in the verified owner's context; an unbound service diagnostic is not an owner-review report. |
| 2026-10-27 · corrected identities and comparison presentation | Gate 3 remains Blocked. The owner corrected the five previously flagged wine cards. A rollback-only preview showed those five now return `no_match` rather than `identity_conflict`; a new owner-linked report (`686ceb2d-3a70-4189-b162-7f5371c2c13f`) was recorded. No dates, reference, publication, rollout, or stock were changed by this follow-up. | The new 802-wine report hash is `9daff2f374cfa9558d707e4a69aece2bcae70e943a8913eaa7951f970405007e`: one changed Côte du Py row, two manual windows, zero conflicts, 84 missing keys, 715 unmatched. The UI now foregrounds only the latest non-withdrawn comparison, puts old snapshots and withdrawn version 1 behind a history disclosure, labels conflict counts as local wine-card checks rather than date approvals, and reopens the review when returning from a wine card. Version 1's James/Py regional row remains withdrawn; version 2 contains only the exact Côte du Py draft. The owner has not accepted the report or enabled the reference. |
| 2026-10-27 · owner draft-comparison refresh proposal | Gate 3 remains Blocked; this is a proposed capability, **not yet deployed**. The owner can request a new whole-cellar snapshot only for an unpublished draft already reported to that same owner and household. The button is shown only with such a draft. | A new owner-scoped RPC reuses the immutable snapshot recorder and existing stale-review checks; it does not reveal other drafts, edit wines, decide, publish, or change rollout. SQL permission/ownership and web interaction tests cover refresh after a wine edit. Applying the migration to the linked project is a separate authorized step. The owner must still review the fresh Côte du Py comparison, and publication remains off. |
| 2026-10-27 · owner decision-completion follow-up (proposed) | Gate 1 remains In progress and Gate 3 remains Blocked. No reference, decision, publication, rollout, stock, or database schema is changed by this client PR. | The existing owner-scoped report response already includes the latest saved verdict and reason. The proposed client shows that saved decision instead of a blank decision form, with an explicit action to change it; a fresh comparison has no decision and still requires owner review. After the owner found the decision hidden below the long wine list, the proposed layout puts changed/conflicting wines first, then the clearly labelled **whole-comparison** decision; unchanged, manual-preserved, and unmatched wines remain accessible in a collapsed section. Automated checks cover the 802-wine case. This improves the owner walkthrough, but does not record an approval or accept a gate on the owner's behalf. |
| 2026-10-27 · owner decision wording clarification (proposed) | Gate 3 remains Blocked. This is a client-copy refinement in the same PR; no owner verdict is recorded by the code change. | The draft button now says **Accept the proposed dates for my cellar** rather than **Approve this comparison**. The adjacent explanation and saved-decision state say explicitly that clicking does nothing immediately, but if the draft is later published, this consenting cellar automatically adopts the reference dates for eligible wines. A refusal leaves this cellar unchanged. Publication remains a trusted, separate operation; the owner should accept only after reviewing the whole 802-wine comparison and its one changed Côte du Py row. |
| 2026-10-27 · unchanged-comparison refresh correction (proposed) | Gate 3 remains Blocked. The owner accepted a draft comparison in the preview, then tapped **Refresh this draft comparison**. The live wrapper always created a new report even when its content was identical, leaving the approval on an older report and reopening the decision form. This PR proposes a narrow follow-up migration and UI feedback; **the migration is not applied and no decision is copied**. | The owner-only wrapper now recomputes the whole-cellar hash and returns the latest report ID if the owner, version, draft fingerprint, issue count, wine count, and content hash are identical. A changed cellar or draft still creates a new immutable report and requires a fresh explicit decision. The screen labels saved acceptance, explains why a changed wine remains in the comparison, and distinguishes unchanged refresh from a genuinely new comparison. SQL tests cover decision preservation and invalidation. Deployment requires a separate authorized migration preflight/backup; the owner must review and accept the current fresh report once if the prior acceptance was superseded. No publication or rollout is authorized. |
| 2026-10-27 · PR #220 authorized refresh deployment | Gate 3 remains Blocked. The owner separately approved only migration `20261027110000` on linked `cellarmanager-v02-dev`; it has now been applied. Live database function and permission state changed, but no owner decision, publication, household rollout, stock, or wine data was changed by the deployment. | [Deployment record](drinking-window-gate2-deployment.md): exactly one migration in the preflight, protected schema/data export, all PR checks green, successful push, zero pending migrations, and live-schema confirmation of unchanged-report reuse. No live report was requested during postflight. The owner must decide the already-superseded latest comparison once, then verify an unchanged refresh retains the saved decision. The visible Côte du Py difference remains a comparison result until publication. |
| 2026-10-27 · `codex/drinking-window-pilot-deployment` prepublication audit | Gate 3's database preflight is green, but the pilot is **not published** and Gates 1–2 are not yet accepted. The owner accepted the latest comparison and confirmed unchanged refresh preserves that decision. No live SQL write was made in this audit. | Read-only checks on linked `cellarmanager-v02-dev` show draft version 2, zero publication issues, a matching zero-issue preflight, latest report sequence 12 covering 802 wines with one non-manual match, current owner approval/hash, and an unchanged whole-cellar snapshot. Of four households, exactly one has a qualifying approval. Publications 0, enabled household rollouts 0, runtime switch off. The earlier PR #220 backup log used a hash from a still-running data dump; [the corrected record](drinking-window-gate2-deployment.md) gives the final hash and documents a successful isolated restore. Owner-facing checks, explicit publication authority, and live postflight remain open. |
| 2026-10-27 · 23-profile research bundle intake | Gate 4 remains Not started and Gate 5 remains Blocked; the ZIP was validated privately, not imported into the shared reference or cellar. | [Intake record](drinking-window-producer-bundle-intake-2026-10-27.md): all 23 JSON files pass schema 1.1.0 and cross-reference checks; 670 750 ml proposals are all `candidate_not_approved` and zero are publishable. The supplied B/C/D grades are metadata triage only, not verified date evidence. This PR also explains conflicting identities in the owner comparison before its disabled approval action. |
| 2026-10-28 · post-merge #222–#223 capability deployment | Gate 2 and Gate 4 remain In progress; Gate 3 remains Blocked. The owner authorized the exact three pending migrations. They were applied to linked `cellarmanager-v02-dev` after a completed protected schema/data backup and a successful restored-clone rehearsal. No suggestion, staged draft, publication, switch, rollout, stock, or cellar advice was changed by the operator. | [Deployment record](drinking-window-gate2-deployment.md): dry run listed exactly `20261028100000`, `20261028110000`, and `20261028120000`; all are in the linked ledger with zero pending. Live counts remain 810 wines, four households, six users, two reference versions, zero publications, zero enabled switches/rollouts, zero new submissions/stagings. Anonymous RPC execution and ordinary-role private-table reads are denied; the public app returned HTTP 200. The next Gate 4 slice must make draft correction and verified evidence review usable in-app. |
| 2026-10-28 · merged PR #225 exact-release correction | Gate 4 remains In progress; Gate 3 remains Blocked. The code and UI are merged, but migration `20261028130000` has not been applied to the linked project or released. A curator can correct the three dates and rationale of an unpublished exact-release row and attach/remove only existing, reviewed, reusable exact-release date evidence. Each edit has an append-only audit event; prior row approvals and whole-cellar comparison hashes become stale. | A restored, disposable database accepted the migration; 20 rollback-only SQL assertions covered access, stale approval, whole-draft invalidation, concurrency, evidence gating, same-source date links, audit, and no publication/rollout. All PR checks passed. Live deployment still requires separate authorization and preflight. |
| 2026-10-28 · proposed direct-date source intake | Gate 4 remains In progress; Gate 3 remains Blocked. This PR proposes an in-app two-step source workflow for an exact-release page that explicitly states all three proposed years. A pending private record contains the URL, paraphrased date-location note, and rights-page assessment. Only an explicit curator approval of both the dates and reuse rights creates a reviewed pointer-only evidence record. Rejection and stale drafts cannot create one; stale assessments can be closed as rejected. It is then offered for explicit draft linking, not auto-linked or published. | A restored disposable database accepted the proposed migration; 22 rollback-only SQL assertions covered role isolation, HTTPS rights pointers, both review checks, rejection, stale drafts, no automatic link, no publication and no rollout. The workflow does not prove owner-authored synthesis or infer exact dates from general ageing guidance. Neither this migration nor PR #225's prior migration has been applied live. |

**Next actions:** review this proposed source-intake PR. After merge and separate
authorization, rehearse and apply the exact pending migrations in order, with
backup and preflight. Then demonstrate a real exact-date citation through
intake, rights review, explicit linking, stale-approval handling and a fresh
curator decision. Provide a distinct reviewed path for owner-authored synthesis
with explicit sharing permission; then address safe supersession, a paginated
queue, and the mobile workflow. These
capabilities do not authorize publication. In parallel, complete the remaining
Gate 1–2 owner-facing walkthrough
(mobile layout, actual manual edit/clear on a chosen test wine, stale-report
behavior, and emergency-off readiness), record owner acceptance, and obtain
explicit authority for the exact version 2 pilot publication. Then take and
verify a **completed** protected backup and rerun the live preflight
immediately before invoking the trusted publisher. Its
transaction must enable only the one currently consenting household. Verify
the Côte du Py three dates and provenance on that household's card, the
unchanged advice in a non-consenting control household, and the emergency-off
and restore path. Any intervening cellar or draft edit requires a fresh
owner comparison; do not transfer consent silently. The 2040 endpoint remains
an owner estimate, not independently established as an optimum end. Do **not**
revive the old four-item draft; James remains research-only. Manual
edit/clear, local choice, mobile, stale-report, and emergency-off walkthroughs
remain for Gate 1/6 acceptance if not completed in that walkthrough. Keep protected backups until an explicit
recovery-retention decision.
