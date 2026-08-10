# v0.1 → v0.2 production migration acceptance

This document records acceptance of the real CellarManager v0.1 cellar after
migration into the hosted v0.2 PostgreSQL household.

The migration itself was already applied before this acceptance pass. This
step does not re-import or mutate production data.

## Authoritative source

The source SQLite database SHA-256 is:

`ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436`

This matches the final v0.1 import re-baseline.

## Production inventory state

At acceptance time PostgreSQL contains:

- 763 wines
- 5 cellars
- 153 locations
- 821 positive holdings
- 822 total holding rows
- 1,203 bottles
- 4 inventory operations
- 0 pending inventory operations

The difference between 821 positive holdings and 822 total holding rows is one
zero-quantity holding row. It does not represent current stock.

PostgreSQL holdings remain authoritative for current inventory.

## Source UUID preservation

Every UUID from the final normalized import plan that was intended to survive
the migration still exists in the production household:

| Entity | Expected | Found |
| --- | ---: | ---: |
| Wines | 763 | 763 |
| Cellars | 5 | 5 |
| Locations | 153 | 153 |
| Holdings | 821 | 821 |

This proves the normalized source objects were not replaced or remapped after
migration.

## Post-import inventory operations

Four v0.2 inventory operations have been accepted since migration:

- MOVE 1 bottle
- REMOVE 1 bottle, reason DRANK
- REMOVE 1 bottle, reason DRANK
- ADD 2 bottles

Their net bottle-count effect is:

`+2 -1 -1 = 0`

The MOVE changes location only and has no bottle-count effect.

Therefore the current authoritative total remains 1,203 bottles, exactly the
normalized migration baseline, without implying that the production household
has been static since import.

All four operations are accepted and there are no pending operations.

## Conservative wine identity

The final normalized v0.1 source contains six semantic identity groups with
more than one source wine under the conservative identity:

`producer + cuvée + vintage + color + format_ml`

Production still contains exactly six such groups.

These references remain separate by UUID. No semantic merge was performed.

Appellation and area remain supporting metadata and do not redefine identity.

## Acceptance conclusion

The production v0.1 → v0.2 migration is accepted because:

- the authoritative source hash matches the final re-baseline
- all normalized source UUIDs are present in the production household
- wine, cellar and location counts match the import plan
- current bottle total reconciles to 1,203
- later accepted inventory operations explain production activity without
  changing the net bottle total
- no inventory operations are pending
- all six conservative ambiguous wine groups remain explicit
- current inventory authority remains PostgreSQL holdings

No second import is required or permitted as part of this acceptance step.

The complete private v0.1 source archive remains preserved outside version
control for later restoration of deliberately deferred metadata and history.
