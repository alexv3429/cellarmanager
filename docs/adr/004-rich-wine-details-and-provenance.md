# ADR 004: rich wine details and provenance

- Status: Accepted
- Date: 2026-08-16
- Implemented: v0.4.1

## Context

The v0.3 wine record contains enough information to distinguish a physical
inventory reference, but not enough to describe, enjoy, or enrich a wine.
v0.4 needs personal notes, drinking windows, pairings, geography, composition,
serving guidance, certifications, and external identifiers. Later provider
integration must also distinguish user-maintained facts from retrieved data and
must never overwrite either silently.

Rich details must not redefine the v0.3 inventory identity. A holding continues
to represent a quantity of one wine reference in one physical location; there
is no new per-bottle entity.

## Decision

- Singular shared facts are nullable, typed columns on `wines`: country,
  region, classification, vineyard, sweetness, alcohol by volume, drinking
  window, serving-temperature range, and serving guidance.
- Repeating shared facts use normalized household-scoped child tables for grape
  composition, food pairings, certifications, and external identifiers.
- A personal note belongs to a user, wine, and household. It is not shared wine
  metadata and another member cannot read it through PostgreSQL RLS.
- None of the new fields or child rows participates in conservative wine
  identity or inventory matching.
- `wine_field_provenance` is append-only source history for shared wine fields.
  Each logical field has at most one current source row, while prior rows remain
  non-current evidence with their value snapshots.
- Supported source kinds are `unattributed`, `manual`, `csv_import`, `legacy`,
  and `provider`. Pre-v0.4 values and writes from clients that do not identify
  their origin are truthfully marked `unattributed` rather than assigned an
  invented source.
- Provider provenance requires a provider name and retrieval time. It can also
  retain a source record, URL, and confidence. A future enrichment proposal is
  reviewed before the canonical value and current provenance change together.
- Browser roles retain read-only table access. Future editing and enrichment
  steps mutate details through guarded RPCs so a value and its provenance change
  transactionally.
- New shared detail tables and fields are included in the PostgreSQL publication
  and PowerSync client schema. User-specific synchronization rules must retain
  the same privacy boundary as PostgreSQL before personal notes are enabled in
  the UI.
- PostgreSQL decimal values remain `numeric` for validation and are represented
  as text in the PowerSync SQLite schema, preserving their exact serialized
  value for later parsing by the client.

## Provenance rules

1. Missing provenance is not evidence that a value is safe to replace.
2. `unattributed` and `manual` values are treated as user-maintained during
   enrichment review.
3. Retrieval never mutates canonical wine data. It creates a candidate for a
   later explicit review/apply action.
4. Applying a value retires the previous current provenance row and appends a
   new current row with a value snapshot.
5. Clearing a value is also a sourced change and records a JSON `null` snapshot.
6. Source metadata describes where a value came from, not whether the value is
   guaranteed correct.

## Alternatives considered

- A single JSON details column would make validation, filtering, migrations,
  and PowerSync queries fragile.
- Adding every repeating value as a PostgreSQL array would hide item identity
  and complicate deterministic editing and provenance.
- Storing provider data directly on `wines` without source history would make
  silent replacement and stale enrichment difficult to detect.
- Creating one record per physical bottle would substantially change holdings,
  imports, and inventory operations without helping wine-level enrichment.

## Consequences

- Schema changes are additive and existing holdings and wine identity remain
  unchanged.
- Repeating values require focused RPCs and UI work in later v0.4 steps.
- Provider candidates and retrieval jobs remain separate future structures;
  this ADR defines only canonical accepted values and their provenance.
- The client schema contains the future tables before views use them, allowing
  later behavior PRs to stay focused.

## Validation

The database acceptance suite verifies field constraints, household foreign
keys, provenance history, RLS visibility, browser privileges, replication
publication membership, and PowerSync-role access. The web gate validates the
matching client schema.
