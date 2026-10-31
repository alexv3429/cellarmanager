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
- [Explicit identity triage decisions](drinking-window-gate4-identity-decisions.json)
  are local to this audit. They are neither global aliases nor permission to
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
| Rows with unambiguous producer, cuvée, release and place identities | 9 | Identity is a prerequisite, not a date/source approval. |
| Existing separately reviewed draft with the same release, format and three dates | 1 | Burgaud Côte du Py 2022 / 750 ml; already present in version 2, not imported again. |
| Quarantined bundle rows | 669 | Every row has a recorded reason; **zero newly approved** for publication. |

The blocking reason counts overlap: 213 producer identities, 632 cuvée
identities, 661 release identities, 208 appellation/place relationships and
one region still need resolution; all 669 non-duplicate rows lack the
necessary editorial review of dates and source rights. Canonical coverage is
small because the shared identity catalogue is still sparse, **not** because
the other 661 wines are known not to exist.

The eight other identity-ready rows are Burgaud James 2008 and 2022; Barraud
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

## Publication boundary and next actions

1. Keep all 669 unreviewed rows, including the eight identity-ready rows,
   outside an approved publication manifest. Do not synthesize missing
   identities or infer rights from a URL.
2. In the app, a curator reviews the most useful exact-release candidates:
   confirm the release and format, inspect evidence for the *three proposed
   milestones*, decide source reuse, and record approval or correction. Create
   genuinely missing canonical producer/product/release identities through the
   existing audited in-app workflow, one verified identity at a time.
3. Review any fallback's category and explicit membership before its dates;
   do not promote the eight broad research estimates by default.
4. Re-run the manifest and restored-catalogue rehearsal after review. The
   approved publication manifest must contain only rows whose current
   approvals, source rights and membership pass the database preflight.
5. Make all 23 complete profile documents available in the app's curator
   workflow; the coverage manifest alone is not an import. The Gate 4 UI now
   accepts multiple JSON files, saves each through the existing curator-only
   import RPC, reports every failure, and retains failed files for retry. It
   does **not** approve or publish them. The supplied ZIP must be extracted
   before selecting its JSON files; the full 23-file import passed on the
   disposable copy, but live import remains to be performed.
   Gate 5 can publish approved rows only after those checks and explicit
   release authorization. One Côte du Py row alone is **not** the owner's
   intended 6/6 outcome. The remaining profiles must be usable for continued
   in-app review without a developer PR; unreviewed estimates must not be
   shown as recommendations.

The owner has since specified a stronger release outcome: nearly all active
wines in the real cellar must have a coherent three-date window in the
official app. The working floor is 95%, with every uncovered exception
listed, and with reviewed exact, reviewed broader, private and labelled-model
sources counted separately. The current manifest measures proposal readiness,
**not** wine-card coverage, so this gate is not ready to pass. Its next
read-only measurement is a whole-cellar source-by-source baseline and a
ranked list of uncovered wines/bottles. Editorial review should then target
the high-impact rows and scoped fallbacks; importing 670 unreviewed proposals
cannot satisfy the outcome by itself.

This audit exposes a material gap in the original six-PR plan: the 23-file
bundle is a research package, not a pre-approved reference base. Unless
additional curator review is completed, calling the *whole* bundle a live
common base at Gate 5 would be incorrect. The six-PR budget is unchanged;
do not silently redefine Gate 4 as completed or open a seventh PR.
