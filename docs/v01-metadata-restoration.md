# Archived v0.1 metadata restoration

Roadmap step 0.4.12 restores only private v0.1 values that have a safe current
CellarManager destination. It does not run the retired inventory importer,
recreate the v0.1 runtime, semantic-match wines, or treat the historical
database as disposable test data.

## Authority and exact identity

The accepted private source remains outside version control. Its authoritative
SHA-256 is:

`ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436`

The v0.1 migration preserved all 763 source wine UUIDs. Restoration therefore
uses exact UUIDs only; it never guesses from producer, cuvée, vintage, color, or
format. The tool verifies the original reconciliation plan, every deterministic
JSONL export hash, and every export row count before it creates any SQL.

Generated plans and SQL contain private cellar information. They must be
written outside the repository with owner-only file permissions and must never
be committed.

## Current-model destinations

| Archived value | Current destination | Rule |
|---|---|---|
| Country, region, classification, vineyard | Household wine facts | Fill a missing value only |
| Grapes and certifications | Household wine facts | Validate the bounded current JSON shape; fill an empty list only |
| Sweetness | Household wine facts | Map only documented labels to the current five categories |
| Label alcohol | Household wine facts | Validate the current 0–30% boundary; fill a missing value only |
| Drinking window, its provenance, experience/advice, pairing advice, notes | One labelled household observation per wine | Preserve the original information without creating an active maturity override |

An equal fact is idempotent. A different current fact is reported as a conflict
and the current value wins. Archived guidance is visibly prefixed as v0.1 data;
it remains available beside the current recommendation but never replaces the
versioned maturity or pairing projection.

For the accepted archive, the normalized source plan contains:

- 27 sweetness facts;
- 744 archived guidance observations;
- 747 wine UUIDs with at least one restorable value;
- no invalid or ambiguous mappings.

The three other household fact fields already maintained in production are not
targeted by this archive. The transaction preview reports 27 missing sweetness
values, 744 new observations, 747 exact wine matches, zero missing wines, and
zero conflicts.

## Deliberately deferred data

No current-model approximation is invented for these archived values:

- 46 external identifiers and 10 legacy enrichment profiles remain deferred to
  v0.6.13, after barcode/identifier capture has a reviewed model;
- 919 movements remain deferred to v0.7.2;
- 56 market observations and one market value remain deferred to v0.7.11;
- acquisition and allocation tables are empty in this archive;
- legacy cellar layout rules are not reapplied because the current cellar and
  location setup has already been accepted and subsequently edited.

## Preview-first procedure

Run the tool against the preserved archive and a known household owner. The
default mode generates a SQL transaction that always rolls back:

```bash
npm run v01:metadata -- \
  --archive-dir /private/path/cellarmanager-v01-final-rebaseline \
  --expected-source-sha256 ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436 \
  --household-id HOUSEHOLD_UUID \
  --recorded-by OWNER_USER_UUID \
  --out-dir /private/path/cellarmanager-v01-metadata-preview
```

Execute `metadata-restoration-preview.sql` and review its single JSON result.
It includes inventory counts, matched and missing UUID counts, per-field fill /
equal / conflict counts, observation outcomes, and a fingerprint of the exact
current target state.

Only after that result is accepted, generate a rehearsal that executes the
complete guarded write path and then rolls it back:

```bash
npm run v01:metadata -- \
  --archive-dir /private/path/cellarmanager-v01-final-rebaseline \
  --expected-source-sha256 ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436 \
  --household-id HOUSEHOLD_UUID \
  --recorded-by OWNER_USER_UUID \
  --out-dir /private/path/cellarmanager-v01-metadata-rehearsal \
  --rehearse \
  --expected-preview-fingerprint REVIEWED_FINGERPRINT
```

After the rehearsal succeeds and the same preview remains current, guarded
apply SQL may be generated:

```bash
npm run v01:metadata -- \
  --archive-dir /private/path/cellarmanager-v01-final-rebaseline \
  --expected-source-sha256 ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436 \
  --household-id HOUSEHOLD_UUID \
  --recorded-by OWNER_USER_UUID \
  --out-dir /private/path/cellarmanager-v01-metadata-apply \
  --apply \
  --expected-preview-fingerprint REVIEWED_FINGERPRINT
```

Rehearsal and apply modes take a household-scoped advisory lock, lock the target
wine rows, recompute the preview fingerprint, reject missing wines or observation ID
conflicts, fills only absent facts, and inserts deterministic observations. It
checks wine, cellar, location, holding, and bottle counts again before commit.
Rehearsal always rolls back. Apply commits only after every guard passes; any
changed preview or inventory invariant rolls back the entire transaction.

Re-running the same accepted plan is idempotent: filled facts become identical,
and deterministic observation IDs become `existing-identical`.

## Validation

- run `npm run v01:test` against synthetic archives;
- run the real generated SQL in preview/rollback mode before apply;
- run the real write rehearsal and confirm that its transaction rolls back;
- confirm 763 wines, 5 cellars, 153 locations, and 1,203 bottles before and
  after restoration (holding row count may legitimately exceed the historical
  821 because later accepted operations can retain zero-quantity holdings);
- confirm an archived sweetness appears under **Wine facts** after refresh;
- confirm an archived window/advice entry appears under personal guidance with
  the v0.1 label while the current maturity recommendation remains unchanged;
- confirm current edited facts are preserved and a second preview is fully
  idempotent.
