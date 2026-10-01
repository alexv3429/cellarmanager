# Archived v0.1 enrichment restoration (0.6.16)

This step makes selected, previously deferred v0.1 research available beside the
affected household wines. It does **not** import barcode links, update current
wine facts or recommendations, publish shared reference identifiers, or change
inventory. The preserved v0.1 archive remains the source of truth for the
historical material.

## Reviewed source and scope

The accepted private archive has source SHA-256
`ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436`.
The new plan verifies that hash, every exported table hash and row count, and
the accepted reconciliation before reading the deferred material. Wine matching
uses the preserved wine UUID, never a name, vintage, identifier, or fuzzy match.

The source contains 46 external identifiers on 10 wines and 10 historical
enrichment profiles. Most identifiers are retailer product codes; one is an
old LWIN reference. **There are no archived bottle barcodes.** None of these
codes is promoted to the current wine-barcode links or shared reference model.
The profiles have 47 identifier candidates, one of which is not present in the
accepted identifier table; that profile-only candidate remains deferred.

For each affected wine, the tool proposes one bounded, household-visible
historical observation. It includes the 46 accepted external identifiers with
their source URLs and short, clearly archived summaries of composition,
drinking window, maturity, pairings, and serving information. Full critical
review excerpts are not copied; only their reference count is noted. Three
market-value profile entries remain deferred to v0.7.11. The observation is
displayed under the wine's **Your observations** section, with app-generated
labels translated for French users while source values remain unchanged.

## Preview, rehearsal, and apply

The default command writes a private plan and rollback-only SQL. Keep its
output outside version control and review it before any write. The example
paths and UUIDs below are placeholders, not permission to apply to a live
household.

```bash
npm run v01:enrichment -- \
  --archive-dir /private/path/cellarmanager-v01-final-rebaseline \
  --expected-source-sha256 ccec6071c59a8aeb26b562c5c0e0705651f76a76a5c8346b5f82965eb179b436 \
  --household-id HOUSEHOLD_UUID \
  --recorded-by OWNER_USER_UUID \
  --out-dir /private/path/v01-enrichment-preview
```

Run `legacy-enrichment-preview.sql` against the intended database and review its
JSON result. It must show 10 exact, unmerged matched wines, zero missing wines, 10 new or
existing-identical observations, no fact fills, and unchanged inventory counts.
The preview returns a fingerprint of the target state. After accepting that
result, generate a rehearsal with `--rehearse` and
`--expected-preview-fingerprint FINGERPRINT`. Rehearsal executes the guarded
write path but rolls back. Only a separately approved final run should use
`--apply` with the same reviewed fingerprint. The guarded apply rejects a
changed target state, missing wines, conflicting deterministic observation IDs,
or inventory-count changes, and is idempotent when rerun by the same owner.

Generated plans and SQL include private cellar data. The tool creates output
with owner-only file permissions, refuses output inside the repository, and
does not connect to or modify a database by itself. The actual restoration is
not performed by the pull request.

## Acceptance

- Verify the real archive plan reports 46 accepted identifiers, 10 profiles,
  one deferred profile-only identifier, three deferred market values, 10
  proposed observations, and no blockers.
- Review the rollback-only SQL preview and its exact-wine matches and
  fingerprint before any rehearsal or apply.
- Confirm the 10 notes appear as historical observations in the intended
  household, including in French, without changing current maturity or wine
  facts.
- Confirm no GTIN link, shared reference, stock, or market valuation is
  created; repeat the preview to verify idempotency.
