# Producer research bundle intake — 27 October 2026

The cellar owner supplied `CellarManager_23_profils_audit_qualite_2026-10-26.zip`
(SHA-256 `21c0736da3f010023378f433ace49e435c71c3f88505f6fc3c6884766e59acba`).
The source archive stays outside this public repository. Its JSON files and
audit CSVs are research input, not an import into the shared reference or a
cellar. This record makes the intake reproducible without publishing the
unreviewed source registry or household-matching detail.

## Technical intake

All **23** JSON files pass the repository's 1.1.0 schema and cross-reference
validator. Together they contain **670** exact cuvée/vintage/750 ml
three-milestone proposals, **776** source records, **149** declared source
discrepancies, and **176** declared research gaps. The audit CSV has 670 data
rows, reconciling to the JSON proposals. Every proposal remains
`candidate_not_approved`; all 670 are 750 ml, and the validator reports
**zero publishable rows**. There are 575 low-confidence and 95
medium-confidence proposals, with none marked high. All 776 source records
still say `rights_not_reviewed` and prohibit raw-content storage.

The supplied CSV's B/C/D labels count 352/157/161 proposals respectively.
They describe *source metadata*, not checked page content or verified
three-date support. The accompanying audit explicitly assigns no A grade.
For example, its Côte du Py 2022 / 750 ml row has the same provisional
2025 / 2028–2040 dates as the already staged pilot, but grade C and low
confidence. That agreement does not constitute a second independent approval
or justify restaging the live draft. Conversely, James 2019 is a nine-bottle
triage candidate marked D/low, with a linked source identifier referring to
2017; its identity and date evidence require review before any staging.

The one substantive documentation addition flagged in the archive concerns
Dureuil-Janthial Rully blanc 2021. It preserves differing merchant advice and
leaves the proposed dates unchanged. Neither a merchant's “drink before” year
nor a possible drinking horizon is automatically an end of the *optimal*
period.

## Use in the shared-reference programme

1. Keep the ZIP as a private, versioned research source. Do not copy all 670
   proposals into the live reference, apply them to owner cellars, or treat
   metadata grades as evidence review.
2. Choose a small set of high-impact exact releases after reviewing actual
   cellar coverage. For each, verify producer/cuvée/vintage/format identity,
   read the cited pages, distinguish release existence from each proposed
   milestone, resolve contrary advice, and decide source rights.
3. Use the authorized draft/correction workflow planned in Gate 4 to submit
   those selected rows for curator review. A version may be published only
   after a fresh zero-issue preflight and owner-bound comparison; households
   still choose whether to use a published version.

This intake supplies a review queue and source pointers. It does not change
the existing Côte du Py pilot, authorize James, complete Gate 4, or establish
coverage for the 670 proposals.
