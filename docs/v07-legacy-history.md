# Archived v0.1 movement history (0.7.2)

This step makes useful, exact-source v0.1 stock history available for future
timelines. It does **not** replay movements, adjust holdings, infer purchases,
or change current wine facts. The private archive stays outside Git.

## What the accepted archive actually contains

The verified source has 919 movement rows, not 919 purchases or consumptions:

| Source action | Rows | Treatment |
|---|---:|---|
| `import` | 831, totalling 1,205 bottles | `OPENING_BALANCE`: the initial stock snapshot, **not** an acquisition or ADD |
| `remove` with `drunk` note | 2, totalling 2 bottles | Historical `REMOVE` with `DRANK` reason |
| `enrich` | 85 | Excluded: metadata work with zero stock delta |
| `update` | 1 | Excluded: metadata edit with zero stock delta |

These counts come from the accepted v0.1 archive after its source hash, each
table-export hash, and every row count are checked. Unknown actions, nonzero
metadata deltas, ambiguous removal notes, missing source wines, invalid UUIDs,
bad timestamps, or malformed locations block the plan rather than being
guessed into history. The one archived metadata update is left for later
purchase-data review; it is not a stock movement.

`public.legacy_inventory_events` stores only normalized event facts and
provenance. The original source movement UUID and holding/cellar references
remain separate from modern location IDs. The old user identifier is **not**
attributed to a current account. The household read policy allows members to
see their own shared history; browsers cannot insert, edit, or delete rows.
The unified `inventory_reporting_events` view identifies legacy events as
`LEGACY_V01` and sets `was_applied_to_stock = false`. Current `holdings` remain
the sole authority for stock.

## Preview-first restoration

The generator writes private plan and SQL files outside the repository. It
does not connect to any database. Example paths and UUIDs are placeholders:

```bash
npm run v01:movements -- \
  --archive-dir /private/path/cellarmanager-v01-final-rebaseline \
  --expected-source-sha256 ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436 \
  --household-id HOUSEHOLD_UUID \
  --imported-by OWNER_USER_UUID \
  --out-dir /private/path/v01-movements-preview
```

Run the generated `legacy-movements-preview.sql` against the **intended**
database. It reports exact-wine matches, new/identical/conflicting rows,
inventory counts, and a target-state fingerprint, then rolls back. Do not
proceed with missing wines, conflicts, or an unexpected source count. Review
the preview with the Owner before any write.

Generate a rehearsal with `--rehearse` and
`--expected-preview-fingerprint REVIEWED_FINGERPRINT`. It takes the guarded
write path and then rolls back. Only after an accepted rehearsal and renewed
Owner approval may `--apply` generate SQL that commits with that exact
fingerprint. Apply takes a household advisory lock, rejects changed target
state, inserts only new rows, checks that every target row matches, and proves
that wine, cellar, location, holding, bottle, and modern-operation counts did
not change. A repeat import is idempotent (`existing-identical`).

The PR does not apply the archive to any household. Generated files contain
private cellar IDs and historical location labels; use owner-only file
permissions and never commit them or paste their contents into public logs.

## Acceptance and next UI step

- The synthetic database test proves household isolation, write denial,
  historical location separation, and unchanged holdings/modern operations.
- The normalization test proves opening balances are not purchases and only
  the confirmed `drunk` removals become consumption candidates.
- An actual archive preview must report 831 opening events, 2 confirmed drink
  events, 86 excluded non-stock rows, zero blockers, and no missing target wines
  before a real import is even considered.
- Step 0.7.3 must add and verify the household-filtered PowerSync rule before
  displaying legacy rows offline. Merely adding the table to the publication
  and local schema does not establish that remote sync rule or a UI timeline.
