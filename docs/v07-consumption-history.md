# v0.7.4 Consumption history

The Statistics tab now has a read-only consumption history. It lists bottles
explicitly recorded as drunk, first for the selected 30-day or 12-month
statistics period (named on the history switch), with an option to show all
recorded history. Each line shows
the date, wine, quantity, and recorded source location when available. A wine
link opens its current catalog card; imported rows are labeled as historical.

Only accepted `REMOVE` operations with reason `DRANK`, a server receipt, a
positive quantity, and an in-range client timestamp are included. Pending or
rejected operations, gifts, other removals, and moves are excluded. Imported
`REMOVE`/`DRANK` rows are included only when the household has one unambiguous
legacy archive; opening balances are never consumption. If there are multiple
archives, the imported part is suppressed and the screen explains why.

The list is not limited to Activity's latest 100 operations. It is derived from
the local synchronized records and never writes inventory. Current holdings
remain the authority for today's stock. The selected-period bounds match the
existing statistics charts. The screen initially renders 20 records, with a
button to reveal more.

Acceptance checks: a confirmed drink appears once; a gift or unconfirmed
request does not; changing the statistics period filters the list; all history
can reveal an older drink; opening balances do not appear; an imported drink is
marked as historical and does not change stock.
