# CSV reset and cellar reconciliation

## Resetting the CSV wizard

After a successful import, the import button remains disabled so the same file
cannot be submitted twice by accident. Use **Import another CSV** or
**Reset import** to clear the selected file, mapping, preview and report. Saved
mapping profiles remain available for future files with the same headers.

## Location rules

A cellar location rule is optional. A plain value acts as a case-insensitive
prefix:

- `AG` matches `AG1`, `AG2`, `AG-B3`;
- `SV` matches `SV1`, `SV-12`.

Advanced regular expressions remain supported. When rules overlap, the longest
matching rule wins, preserving the existing cellar matching behavior.

## Imports before cellars exist

An import may be performed before any cellar has been created. Active bottles
are then stored with their original location and a null `cellar_id`; the import
preview and report display the number of affected rows and bottles.

The Cellars page displays this stock as **Bottles waiting for a cellar**. It can
be reconciled in either of two ways:

1. create or edit a cellar with a matching location rule; matching holdings are
   assigned automatically;
2. use **Match bottles to cellars** to apply all current rules.

Reconciliation uses the normal move service. This means quantities are merged
safely when needed, optimistic versions are respected, and every assignment is
recorded in the movement journal.
