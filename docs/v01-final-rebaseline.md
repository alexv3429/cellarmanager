# v0.1 → v0.2 final import re-baseline

This document records the final CellarManager v0.1 import baseline after the
v0.2 wine reference model was completed.

It is an acceptance record, not a copy of the private source database or its
generated source exports.

## Authoritative source

SHA-256:

`ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436`

The source SQLite database and generated full-source evidence remain outside
version control.

## Final normalized result

The August 2026 deterministic dry-run produces:

- 763 source wines → 763 v0.2 wines
- 5 source cellars → 5 v0.2 cellars
- 153 configured v0.2 locations
- 821 positive current holdings → 821 v0.2 holdings
- 1,203 current bottles → 1,203 v0.2 bottles
- 0 fabricated inventory operations
- 0 blockers

All reconciliation gates pass.

Of the 824 legacy holding rows:

- 821 are positive current stock
- 2 are in a non-current state
- 1 has zero or negative quantity

Blank legacy locations are deterministically mapped through the source
cellar's explicit unspecified location. The current source requires this for
93 holdings, all mapped to `STC`.

## Wine reference model

The final v0.2 normalized wine fields include:

- producer
- cuvée
- vintage / NV
- color
- appellation
- area
- physical bottle format in millilitres

`color`, `appellation`, `area`, and `format_ml` are therefore modeled fields,
not deferred legacy data.

The legacy textual `format` field remains preserved in the full source export.
`format_ml` is the normalized physical-format destination used by v0.2.

## Conservative identity

Wine semantic matching uses:

`producer + cuvée + vintage + color + format_ml`

Appellation and area remain supporting metadata and do not silently merge or
split wine references.

The authoritative source currently contains 6 semantic identity groups with
more than one source wine. They remain separate because source UUIDs are
preserved. The importer never silently semantic-merges them.

## Source preservation

The dry-run exports every v0.1 table unchanged as deterministic JSONL and
records schema, row count, primary-key information and SHA-256 hashes in its
manifest.

Fields intentionally deferred beyond v0.2 therefore remain recoverable from
the archived source evidence. Examples include:

- drinking windows and advice
- richer wine identity/enrichment data
- market/value observations
- cellar layout metadata
- purchase prices
- legacy movement history

Those fields are not fabricated into v0.2 structures merely to make the
migration appear complete.

## Inventory authority

The migration creates no historical v0.2 inventory operations.

After migration:

- current stock is authoritative PostgreSQL `holdings`
- new inventory history comes from accepted v0.2 inventory operations
- preserved legacy movement history may be modeled explicitly in a later
  milestone

## Reusable import normalization contract

The v0.1 importer is a one-off legacy migration, not the permanent product CSV
importer.

However, the normalization principles established here are intended to be
reused by the future CSV ingestion pipeline:

- normalize surrounding and repeated whitespace
- normalize casing where the data model requires it
- parse and validate vintage / NV
- normalize physical bottle format
- distinguish identity fields from supporting metadata
- use conservative semantic matching
- surface ambiguous matches instead of silently merging
- validate quantities and locations before mutation
- provide a deterministic preview/reconciliation result before import
- preserve unmodeled source information rather than silently discarding it

A future CSV importer should place a column-mapping and review layer in front
of those rules rather than treating each CSV row as an unquestioned database
row.
