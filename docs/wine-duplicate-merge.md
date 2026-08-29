# Wine duplicate detection and merge

Roadmap step 0.4.15 adds a conservative, owner-controlled way to consolidate
duplicate household catalog entries without rewriting inventory history.

## Candidate boundary

The local catalog suggests a group only when active rows have either:

- the same normalized producer, cuvée, vintage, color, and bottle format, with
  no conflicting confirmed shared references; or
- the same confirmed shared reference, vintage, color, and bottle format.

Appellation, area, and descriptive facts do not independently make two wines
duplicates. Different vintages, colors, or formats are never suggested. A
household owner must choose both the row to keep and one row to retire, then
confirm the irreversible catalog consolidation. Pending local inventory
operations block the browser action until they synchronize.

The review presents the records as a conventional field diff. It shows the
physical cellar/location positions behind each record and highlights differing
catalog values. After choosing the source and survivor, red values represent
the retired record and green values the kept record. Each difference can keep
either value or receive a manually corrected third value; that resolution is
applied transactionally and stored with the audit event.

## Merge semantics

`merge_wines` independently revalidates the conservative candidate on the
server and locks both rows. It then performs one transaction:

1. the selected target keeps its producer, cuvée, vintage, color, format, and
   existing descriptive values unless the owner explicitly resolves a shown
   difference to the source or a corrected value;
2. target facts that are still missing are filled from the source;
3. source holdings move to the target, adding quantities where both rows use
   the same physical location;
4. household observations and non-conflicting maturity or serving overrides
   move to the target;
5. if both rows have the same kind of personal override, the kept row's
   override remains effective and the retired row's override remains preserved
   behind the archived identity;
6. current source projections are superseded and target enrichment is allowed
   to recalculate from the consolidated facts and stock;
7. the source row is marked as merged and disappears from active Catalog,
   Inventory, manual entry, and CSV matching.

The source wine is not deleted. A `wine_merge_events` row stores before/after
snapshots, the detection basis, transfer counts, the owner, and the time. The
event also stores the explicit field resolutions. The source UUID remains
attached to past `inventory_operations`, preserving the
immutable journal and its original meaning. Opening old activity follows the
merge pointer to the current active wine.

An ADD received from stale local state is canonicalized to the final active
wine. A later new-wine ADD ignores retired semantic matches when exactly one
active catalog row has the supplied identity, so a completed merge does not
immediately recreate ambiguity.

## Security

- only an authenticated household owner can execute a merge;
- the server rejects cross-household, already-retired, self, and non-candidate
  merges;
- authenticated users cannot mutate `wines`, `holdings`, or merge audit rows
  directly;
- household RLS applies to merge history;
- a merged wine row is immutable and can point only to an active row in the
  same household.

## Acceptance

- exact normalized duplicates and compatible confirmed-reference aliases are
  suggested, while vintage/color/format differences and conflicting references
  are not;
- the owner can compare entries, select the survivor and source, and must tick
  the explicit confirmation before merging;
- bottle totals and per-location quantities remain correct, including an
  overlapping location;
- observations and non-conflicting personal overrides follow the active wine;
- old inventory activity retains the retired UUID and opens the active wine;
- merged entries no longer participate in Catalog, Inventory, CSV import, or
  manual-add matching;
- the flow remains readable without horizontal overflow on desktop and phone.
