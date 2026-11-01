# Gate 4 (slot 5/6) — initial shared-base preparation

This is a **pre-publication audit**, not an import of 670 approved windows. It
follows the [product contract](drinking-window-product-contract.md) and the
[living release plan](drinking-window-release-plan.md). Gate 5 must not treat
this dossier, a parsed JSON file, or a canonical name match as permission to
publish drinking advice.

## Input and reproducibility

- Owner bundle: `CellarManager_23_profils_audit_qualite_2026-10-26.zip`, SHA-256
  `21c0736da3f010023378f433ace49e435c71c3f88505f6fc3c6884766e59acba`.
  The bundle stays private; its JSONs, source URLs and cellar data are not
  committed here.
- All 23 schema-v1.1 producer files parse; they contain 670 proposed
  exact-release three-date windows. The bundle's own quality audit says no
  proposal was approved and no online source page was fully verified for all
  three dates. Its B/C/D grades concern source metadata, **not** editorial
  approval or proof that a listed 750 ml format is documented.
- A disposable copy of the restored catalogue was brought to the merged Gate
  3 schema. A read-only [canonical snapshot query](../scripts/drinking_window/gate4_canonical_snapshot.sql)
  supplied its producers, products, releases, places, aliases and current
  reference-row approvals. The snapshot itself remains private.
- The [full-bundle import rehearsal](../scripts/drinking_window/gate4_import_rehearsal.mjs)
  generated a private SQL input and imported **all 23 documents and 670
  proposals** through the curator-only app RPC in a single rollback-only
  transaction on that disposable copy. It verified that the reference-row
  count stayed unchanged. The generated SQL was removed immediately after
  the successful run; the linked project was not touched.
- [Identity triage hypotheses](drinking-window-gate4-identity-decisions.json)
  are local analyst inputs to this audit, **not owner or curator decisions**.
  They are neither global aliases nor permission to
  create or attach a canonical release. In particular, a classification or
  hierarchical region label is not silently collapsed into a public name.
- The [coverage manifest](drinking-window-gate4-coverage.json) records **each
  file and each proposed row** with its exact status, blocking reasons and
  canonical release ID only when unambiguous. It intentionally excludes
  source URLs, proposed dates and household data. Regenerate it using
  `node scripts/drinking_window/gate4_coverage_manifest.mjs PROFILE_DIR
  CANONICAL_SNAPSHOT.json docs/drinking-window-gate4-identity-decisions.json
  OUTPUT.json` after extracting the owner bundle into a private directory.

## Result on the restored catalogue

| Measure | Count | Meaning |
| --- | ---: | --- |
| Producer files / proposed rows | 23 / 670 | Complete bundle audited, not staged or published. |
| Rows locally resolvable with analyst-supplied identity hypotheses | 9 | This is a private triage result, **not** nine app-ready or curator-approved matches. |
| Existing separately reviewed draft with the same release, format and three dates | 1 | Burgaud Côte du Py 2022 / 750 ml; already present in version 2, not imported again. |
| Quarantined bundle rows | 669 | Every row has a recorded reason; **zero newly approved** for publication. |

The blocking reason counts overlap: 213 producer identities, 632 cuvée
identities, 661 release identities, 208 appellation/place relationships and
one region still need resolution; all 669 non-duplicate rows lack the
necessary editorial review of dates and source rights. Canonical coverage is
small because the shared identity catalogue is still sparse, **not** because
the other 661 wines are known not to exist.

The eight other *locally resolvable under those triage hypotheses* rows are Burgaud James 2008 and 2022; Barraud
En Buland 2021 and Sur La Roche 2023; Chagnoleau À la Côte 2019; Boillot
Gevrey Evocelles 2021 and Moulin-à-Vent Plantier Favre 2022; and Langoureau
Bas de Vermarain 2018. They remain quarantined for editorial/source review.
James is a distinct canonical release from Côte du Py and does **not** inherit
the owner's approval of Côte du Py's 2025 / 2028–2040 dates. The manifest
rejects an explicit Côte du Py → James mapping in its automated test.

## Appellation and region fallbacks

The eight three-date Alsace/Beaujolais 2022–2023 estimates in the
[first review batch](drinking-window-first-review-batch.md) remain
**research-only**. No group has reviewed membership, source rights and all
three dates together. They therefore contribute **zero approved fallback
rows** to this base. The historic workbook's `standard`/`premium` bins are
not equivalent categories, and one region must never borrow another's
window. A curator can add a reviewed appellation or region profile through
the app once its scope, eligible wines and evidence are established.

## Real-catalogue matching check

The [rollback-only rehearsal](../scripts/drinking_window/gate4_real_catalogue_rehearsal.sql)
uses restored catalogue wines and synthetic, unpublished exact, Morgon and
Beaujolais rows to assert exact → appellation → region selection, including
all three years from one row. Its synthetic years are test fixtures only.
The database execution **passed** on 31 October in the disposable restored
copy with merged Gate 3 migrations: exact, appellation and region each selected
the intended whole triplet, and the transaction rolled back. The first attempt
exposed an obsolete `drink_by_year` fixture column; the corrected three-year
script passed. Seven focused Node tests and full local repository CI also
passed. This does not approve the synthetic fallback dates or publish them.

## Actual cellar coverage and profile impact — 1 November

A fresh **aggregate-only, read-only** SQL Editor check on the linked project
ran the same `get_wine_maturity` function that supplies the app, in the pilot
owner's context. It returned 802 active wine cards and 1,272 bottles: **751
model-estimate windows, two cellar-manual windows, and 49 unavailable**.
All 753 available windows had three ordered years, or **93.9% of wines**;
there were **zero active reviewed-reference windows** because the shared
reference is not published or enabled. The old model already does nearly all
of the current work. Simply adding nine windows to cross the 95% floor would
not establish the intended profile-based feature.

The [reproducible coverage query](../scripts/drinking_window/gate4_real_cellar_coverage.sql)
was run transactionally on a fresh isolated 1 November restore (802 active
wines, 1,272 bottles). It found the same 751 model / two manual / 49
unavailable wine-card split. Among the 49 unavailable cards, 34 were tagged
`unsupported-place-profile`, nine had no vintage, and six had an
`appellation-color-conflict`. These are distinct repair paths: missing
vintages cannot be invented, colour/appellation conflicts need a wine-card
check, and unsupported places need genuinely applicable reviewed profiles.

The same restored-copy query found a separate, more important linkage gap:
**785 of the 802 active wine cards had no shared wine identity link**; 15
linked to a package, one to a product and one to a release. Thus the 753
complete windows above must not be described as evidence of shared-profile
matching. The current reference reader does not derive producer or cuvée
identity from the household's free-text labels. It can use a reviewed
appellation/region fallback where the place is unambiguous, but an exact
producer/cuvée window requires a reviewed canonical link. This is a Gate 4
release blocker, not a defect in the owner's cellar entries.

The [candidate-only profile-impact analyzer](../scripts/drinking_window/gate4_profile_impact.mjs)
compared the 23 private JSON files with labels in the fresh isolated copy,
using a **private, local-only producer spelling map**. By producer spelling,
488 wine cards (845 bottles) potentially relate to the supplied profiles.
Only 249 cards (470 bottles) also match a cuvée name or explicit alias and
colour exactly; **183 cards (353 bottles)** additionally have an explicit
row for the same vintage and bottle size. These are *opportunities to
review*, not canonical matches or approved advice. The remaining cards may
need verified name reconciliation, additional vintage/format rows, or a
carefully scoped broader profile. The analyzer leaves wine-level data and
the spelling map outside Git and rejects ambiguous cuvée labels rather than
assigning them automatically.

Gate 4 now has an actionable order: resolve the 49 unavailable windows
without inventing missing vintages, then review the highest-impact exact
profile candidates, then identify legitimate producer/appellation/region
fallbacks for the rest. At every step, measure **total three-date coverage**
and **reviewed-profile coverage** separately. The exact-row opportunities
must not be counted as active shared dates before curator review and
publication.

Before any linked archive import, a fresh protected backup of `public`,
`private`, `auth`, `storage`, and `capture_guard` was saved outside Git at
`/private/tmp/cellarmanager-gate4-pr231-backup.F2ZCVx` (directory mode 0700,
files mode 0600). SHA-256: schema
`e4c01b28ddfaf37c0756deb518d8096e435d2ccb7a549b9ad45c69e2092234cf`,
data `56aa203ae9effca865bb2db1e57b41366243bf667513b7a2d6e5b1fdd411ed64`.
Both files restored with `ON_ERROR_STOP=1` into a new isolated database; the
data dump disabled triggers **only in that restore session**. The resulting
copy had 810 total wines, four households, one pre-existing research archive
and two reference rows. The full 23-file/670-proposal import passed through
the curator RPC inside one transaction and rolled back. Afterwards the copy
still had one archive, two reference rows and 810 wines. The linked project
was not changed by the rehearsal. This temporary export is sensitive
recovery material, not a durable managed backup.

## Publication boundary and next actions

1. Keep all 669 unreviewed rows, including the eight identity-ready rows,
   outside an approved publication manifest. Do not synthesize missing
   identities or infer rights from a URL.
2. In the app, a curator reviews the most useful exact-release candidates:
   confirm the release and format, inspect evidence for the *three proposed
   milestones*, decide source reuse, and record approval or correction. Create
   genuinely missing canonical producer/product/release identities through the
   audited, separately confirmed in-app identity workflow. A verified
   selection can be batched; identity creation is not a date approval.
3. Review any fallback's category and explicit membership before its dates;
   do not promote the eight broad research estimates by default.
4. Re-run the manifest and restored-catalogue rehearsal after review. The
   approved publication manifest must contain only rows whose current
   approvals, source rights and membership pass the database preflight.
5. **Completed 1 November:** all 23 complete JSON documents (670 proposed
   windows) were selected in the Gate 4 preview under the authorized owner
   curator account and saved into the linked project's curator archive. The
   app reported `23 profils complets conservés pour révision. Aucune date
   n'a été publiée.` All 23 appeared under saved complete profiles. The
   Publication tab still showed draft version 2 with one unpublished window;
   publication was disabled. This is a linked **research-archive write**, not
   a profile approval, reference-row change or cellar opt-in. The Gate 4 UI
   accepts multiple JSON files, saves each through the curator-only import
   RPC, reports every failure and retains failed files for retry. The
   supplied ZIP had to be extracted before selecting the JSON files.
   Gate 5 can publish approved rows only after those checks and explicit
   release authorization. One Côte du Py row alone is **not** the owner's
   intended 6/6 outcome. The remaining profiles must be usable for continued
   in-app review without a developer PR; unreviewed estimates must not be
   shown as recommendations.

The first linked, read-only mapping preview after import demonstrates the
remaining identity work. For **Frantz Chagnoleau**, all 51 proposed rows were
initially set aside because the profile producer name did not resolve to one
canonical producer. Selecting the existing unique `Frantz Chagnoleau`
producer in the preview changed the diagnosis to **51 cuvée identities not
uniquely resolved**; still zero rows were ready. The local-only impact triage
had found 22 exact cuvée-label/colour wine cards (48 bottles) for this
profile, but label overlap is not a canonical link or date approval. The
preview changed no shared identities, draft rows or cellar advice. It shows
why a successful 23-file upload alone cannot meet the feature goal.

The curator then selected the two existing, uniquely identifiable shared
products, `À la Côte` and `Les Raspillères`, in the read-only mapping preview.
The result was still **0 ready / 0 unchanged / 51 set aside**: 42 lacked a
unique shared cuvée identity, while nine now failed the region check. The
profile calls that region `Bourgogne — Mâconnais`; the current staging RPC
requires an exact canonical region label and offers no region mapping in the
app. The audited local identity-decision file proposes `Bourgogne` as the
parent region, but that proposal is not a linked curator selection or an
approved date. Gate 4 needs an explicit, validated region mapping and a path
to review the remaining canonical product/release identities; no approximate
match may silently become a reference row.

The restored cellar itself has `Chagnoleau · A la Cote` in **2019, 2021 and
2022**. The 2019 wine is linked to a shared 750 ml **package** and its 2019
release. The 2021 and 2022 wines have no shared-reference link. The JSON
proposes À la Côte dates for 2019 and 2022, but **not 2021**. This distinction
was missing from the first linked preview explanation: an existing household
wine is not itself a canonical shared release, and lack of a shared release
does not imply that the wine is absent from the cellar. The current active
reference selector also accepts `product` and `release` links but not
`package` links, so even the existing 2019 package link needs a verified
reader fix before this profile can appear on that wine card. Keep the draft
unpublished until these paths are tested end to end.

**Gate 4 continuation, 1 November (still in draft #231):** Two additive
migrations and the curator UI now provide an explicit, import-scoped mapping
from a profile's region/appellation wording to existing canonical places,
without creating a global alias. The staging preview still checks that the
chosen appellation belongs to the chosen region, and a missing release or
format remains quarantined. A separate reader fix resolves a confirmed
package link through its release and checks the bottle size; it also lets
cellar-only producer rules use that same confirmed lineage. No fuzzy cellar
text is promoted to a shared identity.

Both migrations applied cleanly **only to an isolated database restored from
the protected backup**, not to the linked Supabase project. The two focused
pgTAP suites passed there (44 package/core-selection assertions and 26
profile-exchange assertions), along with focused web tests. On that copy,
10 of the 15 active package-linked wine cards now have a complete canonical
context; three remain blocked by an unresolved appellation and two by an
unresolved region. Chagnoleau À la Côte 2019 resolves; 2021 and 2022 remain
unlinked. The provided Chagnoleau JSON was imported only into that isolated
copy for a **preview**, with the existing shared producer and two cuvées
selected, plus `Bourgogne — Mâconnais` → `Bourgogne`, `Saint-Véran` →
`Saint-Veran`, and `Viré-Clessé` → `Vire-Clesse`. The preview returned
**1 ready (À la Côte 2019 / 750 ml), 42 cuvée-identity blockers and eight
release-identity blockers**. This is an identity result, **not an approval of
the proposed dates**. No reference row was staged or published by this test.

**Further Gate 4 tooling in the same draft #231:** A third, additive migration
and curator UI action prepare *selected* missing shared producer, cuvée and
vintage identities directly from a saved producer JSON. The curator must
first search/map existing producer, cuvée and place identities; a preview
lists each chosen vintage, whether its cuvée/release exists or would be
created, and the cited release-existence URLs (across bottle formats).
Blocked or ambiguous entries cannot be created. The curator then records a
reason and explicitly confirms the batch. An immutable audit row records the
decision. No drinking dates are approved or staged, no household wine is
linked, and nothing is published. The client displays those boundaries next
to the action so that a successful identity batch cannot be mistaken for a
drinking-window approval.

This third migration compiled on the isolated protected restore; 17
rollback-only database assertions passed for curator access, multi-format
sources, missing vintages, stale previews, explicit confirmation, audit and
zero date/cellar changes. Five focused UI tests, one client-contract test, the full 902-test web suite
(one existing skip), and the production web build passed. The linked project
has **not** received this migration, and no real curator identity batch has
been executed. This is an app workflow for resolving canonical gaps, not an
assertion that the supplied 670 proposals are reviewed or that household
linkage is complete.

The [read-only discrepancy query](../scripts/drinking_window/gate4_identity_matched_discrepancies.sql)
compares only an unadjusted current legacy projection and an exact proposed
row for the same confirmed release, vintage, colour, place and format. It
flags a five-year-or-greater gap on any of the three milestones; it never
chooses dates. On the protected copy, only **one** wine/draft-row pair was
comparable and it had **no five-year flag**. This tiny sample is not evidence
that the remaining 669 proposals agree with the old model.

**Remaining Gate 4 blockers:** the 42 Chagnoleau cuvées and eight releases
above need actual curator identity decisions using the new path; 785 of 802 active wine cards
were unlinked at the baseline; and the supplied proposed dates/source rights
still need actual curator review. The newly available place mapping, package
reader and identity batch do not themselves deliver near-all profile-based coverage or
authorize publication. Re-run the whole-cellar source mix after any linked
migration is separately backed up, rehearsed and authorized.

The owner has since specified a stronger release outcome: nearly all active
wines in the real cellar must have a coherent three-date window in the
official app. The working floor is 95%, with every uncovered exception
listed, and with reviewed exact, reviewed broader, private and labelled-model
sources counted separately. The current manifest measures proposal readiness,
**not** wine-card coverage, so this gate is not ready to pass. The first
whole-cellar baseline above now gives the source mix and unavailable reasons.
Editorial review should target
the high-impact rows and scoped fallbacks; importing 670 unreviewed proposals
cannot satisfy the outcome by itself.

This audit exposes a material gap in the original six-PR plan: the 23-file
bundle is a research package, not a pre-approved reference base. Unless
additional curator review is completed, calling the *whole* bundle a live
common base at Gate 5 would be incorrect. The six-PR budget is unchanged;
do not silently redefine Gate 4 as completed or open a seventh PR.
