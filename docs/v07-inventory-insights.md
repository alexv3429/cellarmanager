# Initial inventory statistics

The Statistics tab inside Activity is a read-only first slice of the planned
v0.7 inventory dashboard. It uses household-scoped local PowerSync tables and
makes no stock changes.

- **Bottles today** is the sum of current `holdings.quantity`, which remains
  authoritative.
- **Added / removed** are accepted ADD / REMOVE operations whose client action
  date falls in the selected period, plus archived REMOVE entries from a single
  unambiguous v0.1 archive. MOVE, pending and rejected requests are excluded.
  The imported opening balance is not counted as an addition.
- **Recorded as drunk** counts only REMOVE entries with reason `DRANK`. Other
  removals are included in “removed,” not mislabeled as consumption.
- **Net change** is added minus removed. An addition is not necessarily a
  purchase; acquisition dates and prices are outside this slice.
- **Total bottles over time** starts at one valid imported opening snapshot,
  leaving earlier months blank. It is shown only when all subsequent accepted
  movements are usable and the reconstructed final total exactly equals current
  holdings. Otherwise the screen shows the confirmed flow without drawing a
  potentially false stock curve.

Modern operations use their client action date for period assignment; offline
devices with an inaccurate clock can put an operation in the wrong period.
Server receipt is required before it counts. The current inventory total is
not affected by that clock caveat.
