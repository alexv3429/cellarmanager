# Drinking-window release plan — living delivery record

This is the **single progress record** for shipping reviewed, three-milestone
drinking windows in CellarManager. The [reference policy](drinking-window-reference-policy.md)
defines the rules; the [implementation plan](drinking-window-implementation-plan.md)
and [rollout runbook](drinking-window-staged-rollout.md) contain technical detail.
Neither a merged PR nor a passing synthetic test makes this feature released.

**Release target:** A cellar owner can see a reviewed shared window with **start
tasting / probable optimal start / probable optimal end**, know exactly why it
matched, compare it with the advice they currently see, choose whether to use
it, override it privately, and return safely to the previous advice. A curator
can maintain the shared reference without a code PR for each wine. Wines with
no reviewed match retain clearly labelled existing-model advice, or no advice
if that model cannot assess them. The owner-authorized pilot comes before
broader use. No percentage of catalogue coverage is silently implied by this
release target.

## Status at 25 October 2026

**Not released.** The merged work through PR #209 provides the database
foundation, candidate staging, draft diagnostics, review decisions, shadow
comparison, publication/opt-in mechanisms, a curator review screen, and the
owner's private ageing-group choice. The Burgaud 2022 Côte du Py / James row
is a **draft**, not approved or active. With the owner's explicit
authorization, all **19 migrations** were applied to the linked
`cellarmanager-v02-dev` project after a fresh backup, restore, and live
preflight. The linked ledger now has **0 pending migrations**; the deployed
Worker version maps to merged commit
`c2900d0ca845a60ebcb47c8937d206b6b702d517`. The global switch and all
household rollouts remain off. The signed-in owner check confirmed one pilot
identity and generated a private 802-wine comparison: one changed draft
proposal, four unapproved draft items. Three unrelated existing advice
payloads matched the pre-migration snapshot. The linked pilot's existing
model dates recalculated after identity confirmation; this and the remaining
owner walkthrough keep Gates 1–2 open. The owner inspected the clarified
preview comparison and understood the draft rationale. On the official app,
an available PWA update was applied and the merged comparison, model card,
three-date editor, and draft-only local group selector were inspected without
saving changes. Mobile, manual edit/clear, stale-report, emergency-off, and
owner acceptance are not yet complete. The signed-in
owner account does not show the curator-only reference workspace, so the four
draft decisions cannot be recorded from that account. The workbook audit has
226 two-date pairs but
no complete three-date shared rows. The existing model and personal timing
controls remain in use. See the [Gate 2 deployment record](drinking-window-gate2-deployment.md).

On 25 October, the owner supplied a [Burgaud producer research
package](producer-research-format.md). It has 14 cuvée profiles, 26 vintage
effects, 53 exact cuvée/vintage calibrations, and 150 proposed windows. It is
research-only: every proposal says `DO_NOT_PUBLISH`, and the 64 release-review
candidates still have no canonical identity, curator, rights, or publication
approval. Its James and Côte du Py 2022 estimates conflict with the single
regional pilot row. **Gate 3 remains blocked; do not approve the existing row
unchanged.** Validate and review the producer format and then decide the two
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
Burgaud proposes James 2022 at 2026 / 2030–2038, versus the unpublished
regional draft's 2025 / 2028–2035. The revised file adds an exact Côte du Py
2022 / 750 ml proposal of 2025 / 2028–2040, leaving the former 14 Burgaud
proposals unchanged. This closes the *research-file coverage* gap, not the
evidence or approval gap: the 2040 probable optimum end is inferred from a
general Vinous drinking range and conflicts with another retailer's
“drink before 2031” guidance; the reproduced Decanter description may be
misattributed. The proposal itself marks confidence low and is not approved.
Do not publish the regional draft as-is or activate the replacement merely
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

Statuses below mean **Not started**, **In progress**, **Blocked**, or
**Accepted**. A step becomes Accepted only when its named evidence is recorded
here, not when its PR merges. Dates are not delivery promises.

| Gate | Status | Immediate outcome |
| --- | --- | --- |
| 0. Reconcile deployment state | Accepted | All 19 migrations replayed on a private clone; the fresh backup, restore, live preflight, and deployment record complete the just-in-time checks. |
| 1. Close owner-facing behavior | In progress | Three-date editing, comparison, identity review, and private group choice are merged. The official card, editor, and draft selector were inspected read-only; mobile, actual edit/clear, stale-report, emergency-off, and owner acceptance remain. |
| 2. Deploy database capabilities | In progress | The authorized 19-migration batch is live, with 0 pending. Three existing advice payloads matched the snapshot; one owner-confirmed pilot link recalculated its old-model advice. The official app displays PR #209 after its PWA update, while switch, publication, and household opt-in remain off. Owner acceptance is still required. |
| 3. Publish one real pilot | Blocked by gates 1–2 and human reviews | One approved cellar can see a verified real window. |
| 4. Make reference maintenance routine | Not started | Authorized curators can add/correct evidence-backed versions in the app. |
| 5. Establish and measure initial coverage | Blocked by gate 4 | One additional high-impact reference is reviewed; gaps remain visible. |
| 6. Release and operate | Blocked by gates 3–5 | The supported feature has repeatable checks, monitoring, and rollback. |

## Gate 0 — reconcile the actual deployment (technical owner)

The [Gate 0 audit, updated 24 October](drinking-window-gate0-audit.md)
records a fresh read-only linked inventory of **19 pending migrations**,
the exact merged-commit-to-deployed-version mapping, a successful full-batch
private-clone replay, zero changed core advice responses across 782 wines
and 4 overviews, and a second clean restore. In a rolled-back transaction,
the owner-confirmed pilot wine linked to its unique canonical release and
produced one draft match. The live wine remains unlinked. The temporary export
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

1. Review the Burgaud 2022 draft's three dates, both release identities,
   long-ageing membership, rights, and evidence. The dates are the owner's
   estimate; third-party descriptions establish identity/relative ageing,
   **not** those exact years. Record explicit approval or disagreement for
   the row, group, and memberships; repair any objection in a new draft.
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
   code PR per wine**. Show provenance and disagreement history.
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

1. Run the acceptance set on the deployed app: opted-in and unopted-in
   households, manual override, local preference, missing/ambiguous reference,
   version supersession, mobile use, and emergency-off. Record actual results,
   not just test names.
2. Document who reviews new sources, who may publish, how an owner reports a
   wrong date, how a correction is versioned, and when the emergency switch is
   used. Monitor match/ambiguity/fallback and owner rejection rates without
   leaking cellar contents.
3. Announce the feature as available only after the pilot passes, the routine
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

**Next action:** stage the owner's Côte du Py choice as an **exact-release,
unpublished** candidate without letting the old regional rule apply to James;
decide James's three milestones separately. The 2040 Côte du Py endpoint is an
owner estimate, not independently established as an optimum end. Use a safe
replacement path for the existing reviewed-group draft and its possible
private-choice references, rather than a blind deletion or one-off SQL rewrite.
Assess evidence fit and reuse rights,
obtain fresh curator decisions, and generate a fresh whole-cellar owner
comparison. Do **not** approve the old four-item draft unchanged. Walk through
actual manual edit/clear, matched/unmatched,
local-choice, mobile, stale-report, and emergency-off cases against the
revised pilot. Record owner acceptance before accepting Gates 1–2.
Then have an already authorized drinking-window curator review the revised
subjects on their merits, or explicitly arrange that authorization; do not
grant it merely because the pilot owner can see the comparison. Obtain curator
decisions before any Gate 3 publication. Keep the reference switch and
household opt-in off; no draft
publication is authorized by the migration approval. Decide when to remove
the protected temporary backup after the owner walkthrough.
