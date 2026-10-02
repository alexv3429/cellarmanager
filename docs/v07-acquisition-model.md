# v0.7.5 Acquisition and purchase model

An inventory `ADD` says only that bottles entered the cellar. It does **not**
prove a purchase. A `wine_acquisitions` row records a separate, explicit
household event: purchase, gift, or other acquisition. Each row belongs to one
wine and has a positive bottle quantity; its calendar date and seller/source
can be unknown. A purchase may have an actual price paid **per bottle** and an
explicit three-letter currency. Unknown prices stay `NULL`, never zero by
default. A gift or other acquisition cannot have a price paid.

The Owner can view, add, correct, and void manual records from a wine card while
online. Recording an acquisition does not queue an inventory operation, alter
holdings, or change the current bottle count. A voided manual record is hidden
from the card but retained for audit; imported source rows are read-only.
Only the household Owner can read this financial history; it is deliberately
not in the household's offline PowerSync stream. Members cannot read prices.

The schema carries a source fingerprint and record ID for idempotent,
provenance-labelled v0.1 restoration in step 0.7.6. It does not infer a
purchase from an opening balance or a modern `ADD`. The accepted v0.1 archive's
acquisition/allocation tables are empty; any future restoration of purchase
dates and prices must first establish exact source meaning and wine identity.
The [0.7.6 audit](v07-legacy-purchase-prices.md) found only price values on old
holding rows, so it preserves them separately without inventing acquisitions.

The model does not claim that all acquired bottles remain in stock. Cost-based
valuation in step 0.7.10 will need explicit allocation or a clearly labelled
approximation; purchase history alone is not a current-stock valuation.

The migration also fixes the shared `private.is_household_owner` predicate to
return `false`, not `NULL`, when there is no membership. This closes a denial
gap for security-definer callers that use `IF NOT ...` and is covered by a
cross-household write test.
