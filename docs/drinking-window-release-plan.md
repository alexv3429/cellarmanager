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

## Status at 22 October 2026

**Not released.** The merged work through PR #200 provides the database
foundation, candidate staging, draft diagnostics, review decisions, shadow
comparison, publication/opt-in mechanisms, and a curator review screen. The
Burgaud 2022 Côte du Py / James row is a **draft**, not approved or active.
The linked `cellarmanager-v02-dev` project was observed with 13 pending
drinking-window/identity migrations in a read-only dry run. The workbook audit
has 226 two-date pairs but no complete three-date shared rows. These are
point-in-time observations, not a claim that the live project remains
unchanged; recheck them before a deployment decision. The existing model and
personal timing controls remain in use.

Statuses below mean **Not started**, **In progress**, **Blocked**, or
**Accepted**. A step becomes Accepted only when its named evidence is recorded
here, not when its PR merges. Dates are not delivery promises.

| Gate | Status | Immediate outcome |
| --- | --- | --- |
| 0. Reconcile deployment state | In progress | Linked migrations and static risks audited; live preflight, private rehearsal, and restore evidence still needed. |
| 1. Close owner-facing behavior | Not started | Three-date editing, personal choices, and an honest comparison are usable. |
| 2. Deploy database capabilities | Blocked by gates 0–1 and operator approval | New machinery is present but no advice changes by default. |
| 3. Publish one real pilot | Blocked by gate 2 and human reviews | One approved cellar can see a verified real window. |
| 4. Make reference maintenance routine | Not started | Authorized curators can add/correct evidence-backed versions in the app. |
| 5. Establish and measure initial coverage | Blocked by gate 4 | One additional high-impact reference is reviewed; gaps remain visible. |
| 6. Release and operate | Blocked by gates 3–5 | The supported feature has repeatable checks, monitoring, and rollback. |

## Gate 0 — reconcile the actual deployment (technical owner)

The [22 October read-only audit](drinking-window-gate0-audit.md) confirmed 13
pending migrations and identified the seed and reader-compatibility checks.
It did **not** prove the active Worker commit or rehearse against existing
private data. Gate 0 is not accepted.

1. Compare the deployed Worker build and linked database migration history with
   the merged repository. Record exact hashes and pending migrations here.
2. Audit all pending migrations for existing-data compatibility and access
   changes. Rehearse them on a representative **private** clone/snapshot,
   record backup and restore steps, and verify that existing advice is
   unchanged while the reference feature is off.
3. Inventory the proposed pilot wine's **real** household identity links,
   vintage, colour, existing dates, and whether the draft would actually
   match. Resolve uncertainty with the owner, not a fuzzy-name guess.

**Accept only with:** migration inventory, rehearsal result, backup/restore
evidence, live/merged hash comparison, and a pilot match report linked in this
record. **Stop if:** an existing household's advice changes before opt-in, a
migration cannot be replayed safely, or the pilot identity is uncertain.
Read-only inspection needs no production write; applying migrations is a
separate, explicitly approved action.

## Gate 1 — close owner-facing behavior (product and technical owners)

1. Make the private manual override use the agreed **three** milestones. Keep
   legacy four-year records readable without inventing or silently dropping a
   `drink by` date. Prove precedence: manual override > opted-in reviewed
   reference > labelled existing model > unavailable.
2. Give an owner a comprehensible way to confirm/change the wine's canonical
   identity and local ageing-group eligibility or preference where needed;
   never let that private choice silently alter the shared group definition.
3. Make the whole-cellar comparison show the **dates the owner actually sees**,
   including any private model timing adjustment, as well as proposed three
   dates and their sources. Today the comparison explicitly says that private
   model timing is not included; that discrepancy must be resolved or clearly
   excluded with owner approval before opt-in.
4. Test mobile layout, manual edit/clear, no match, ambiguous match, changed
   identity, stale comparison, and emergency-off behavior with real UI paths.

**Accept only with:** automated precedence/compatibility tests and a recorded
owner walkthrough on a representative cellar, including a before/after report
for one manual, one matched, and one unmatched wine. **Stop if:** a date changes
without an intelligible source or a private choice leaks into shared data.

## Gate 2 — deploy the inert capabilities (operator + cellar owner)

1. Obtain explicit authorization for the **named** migration batch and target
   project after gate 0 rehearsal. Apply migrations in order, then deploy the
   compatible Worker/client build.
2. Run database and UI smoke checks against the target: current wine card,
   draft review, shadow report, access boundaries, and global emergency-off.
   Keep publication and household opt-in disabled during this check.
3. Record migration IDs, deployment hashes, smoke results, and recovery action.

**Accept only with:** target-specific execution log and a verified unchanged
existing-advice sample. **Stop/roll back if:** permissions broaden, an existing
wine changes advice, or the old client cannot coexist with the new schema.
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

**Next action:** complete gate 0's read-only live-state and migration audit,
then update this record with exact evidence. Do not ask the owner to merge a
chain of infrastructure PRs as a substitute for a demonstrated outcome.
