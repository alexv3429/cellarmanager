# Editing bottle and purchase details

The Bottles page exposes **Edit** / **Modifier** for correcting data that was
entered or imported incorrectly. The editor deliberately shows the boundary
between shared catalog identity and one physical purchase lot.

## What an edit changes

- Producer, cuvée, appellation, vintage, colour/type, region and bottle format
  belong to the **Wine** identity. Changing one updates every holding of that
  Wine.
- Price type, original amount, currency and purchase date belong to the
  selected **Acquisition**. Fees and shipping are preserved, and the effective
  per-bottle cost is recalculated.
- Older stock created before normalized Acquisitions stores a per-bottle price
  and acquisition date directly on its **Holding**; the editor keeps a clearly
  labelled compatibility path for it.
- Quantity, cellar and location remain movement operations rather than edits.

Bottle corrections currently require a connection; unlike add/move/remove, they
are not queued for later offline replay.

When a wine has several holdings, choose the relevant stock location first. If
that holding contains quantities from several purchases, choose the purchase
lot whose transaction data should change. The service will not silently fall
back to a legacy Holding price when normalized Acquisition records exist.

## Duplicate and concurrency protection

The edited identity is checked against other catalog Wines using the same
producer/cuvée/appellation/vintage/format identity rule as import. A possible
duplicate returns a conflict rather than merging records automatically.

The request includes the Wine and Holding versions loaded by the editor. If
another browser or offline synchronization changed either record first, the API
returns `409` and leaves the database untouched. Reload the list, review the new
values and retry.

## Database validation and transaction boundary

Before changing any row, the backend runs:

1. `PRAGMA quick_check`;
2. `PRAGMA foreign_key_check`;
3. Wine, Holding, Acquisition and allocation invariant checks.

The identity, selected transaction, compatibility Holding values and Movement
journal entry are then changed in one SQLite transaction. The same checks run
again before commit. Any failure causes a rollback, so a partially updated Wine
or price cannot be committed.

The journal stores the before/after Wine and Holding values and, when relevant,
the before/after Acquisition values with an `update` action and zero quantity
delta.

## CSV colour aliases

CSV import maps sweetness-qualified colour labels to their base colour. Examples
include `blanc moelleux`, `moelleux blanc` and `sweet white` → `white`, and
`rouge doux`, `rouge moelleux` and `sweet red` → `red`. Sparkling and fortified
style terms take precedence over a base colour. Truly mixed labels such as
`red / white` remain `other` with a warning because selecting one would invent
data. See `docs/csv-column-mapping.md`.

<!-- sweetness-preservation -->
## Colour and sweetness

Colour and sweetness are stored separately. CSV values such as `blanc moelleux`, `rouge liquoreux`, `sweet white`, and `sweet red` keep the base colour (`white` or `red`) and also populate the extended wine-identity sweetness field. A dedicated `Sweetness` / `Sucrosité` CSV column is supported and takes precedence over sweetness inferred from the colour cell. Sweetness can be corrected later from **Edit bottle**, and the update preserves all other identity details.

