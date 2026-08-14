# CSV import regression fixtures

These files are synthetic, deterministic inputs for the complete v0.3 CSV
import pipeline. They contain no personal cellar data and are never sent to the
linked Supabase project.

- `messy-resolvable.csv` reaches a committable preview after explicit wine and
  storage selections. It covers common French headers, normalization, existing
  and new wines, ambiguity, missing storage, repeated new-wine identities,
  capacity warnings, and an unmapped multiline note.
- `blocked-values.csv` is structurally valid but must remain blocked because it
  contains invalid values and unresolved wine and storage decisions.
- `malformed-structure.csv` must be rejected before mapping because it contains
  malformed quoting and a row with the wrong number of columns.

Keep the expectations in `csvImportRegression.test.ts` explicit when changing
a fixture. A fixture change is a product-contract change, not a snapshot update.
