# v0.7.6: v0.1 acquisition dates and price evidence

The authoritative v0.1 SQLite file has SHA-256
`ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436`.
It contains **0 acquisition rows, 0 acquisition-allocation rows, and 0 populated
holding acquisition dates**. Its 824 holding rows all have `price_bought`
(821 positive current rows, two non-current rows, and one zero-quantity row).
Those prices have at most two decimals. The source does **not** record their
currency. A holding's archived quantity is not the number of bottles originally
acquired. No purchase event, purchase date, currency, or acquisition quantity
can therefore be reconstructed from these values.

This step preserves the prices as owner-private, read-only **legacy holding
evidence**, separate from `wine_acquisitions`. The wine card labels them as
archived prices, not purchases or current market values. Members cannot view
them; they are not sent through PowerSync. Import never changes wines, holdings,
or inventory operations. The exact source holding UUID and database hash make
repeat imports idempotent. A conflicting existing row blocks the import rather
than being overwritten.

## Private, preview-first restoration

The tool reads the SQLite file read-only and verifies its SHA-256. It validates
each source wine and holding, price precision, optional date, and the empty
acquisition tables before generating SQL. Keep all generated files outside Git
and restrict their permissions: the plan and SQL contain private cellar prices.

```bash
npm run v01:prices -- \
  --source-db /private/path/winecellar.db \
  --expected-source-sha256 ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436 \
  --household-id HOUSEHOLD_UUID \
  --imported-by OWNER_UUID \
  --out-dir /private/path/v01-price-preview
```

Execute the generated `legacy-prices-preview.sql` against the intended database.
It reports missing exact wine UUIDs, new/identical/conflicting rows, and a
target-state fingerprint; the transaction always rolls back. For this source,
expect 824 evidence rows, 0 acquisition dates, 0 missing wines, 0 conflicts,
and 0 extra rows before considering a write. An actual apply requires renewed
Owner approval.

After reviewing the preview, generate `--rehearse` with
`--expected-preview-fingerprint FINGERPRINT` and run that SQL first; it executes
the guarded insertion and rolls back. Only after a successful rehearsal and a
fresh accepted preview may `--apply` generate committing SQL with the same
fingerprint. The apply takes a household-scoped advisory lock, refuses missing
or changed targets, inserts only new source rows, checks the result, and proves
that stock and modern inventory-operation counts did not change.

This PR does **not** import private prices into any household. It provides the
model, owner display, verified extraction tool, and safe preview/apply procedure.
Cost-based current-stock valuation remains a separate, later step: these old
prices cannot be allocated to present bottles with certainty.
