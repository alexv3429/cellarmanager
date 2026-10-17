# Drinking-window delivery 3/6: first review batch

This is a **research-only set of eight three-milestone proposals**, not eight
approved shared references. It turns the owner's later Alsace and Beaujolais
2022–2023 estimates into a machine-checkable review batch. The older workbook
bins are shown **only as historical context**: their applicability has not
been established as equivalent to any proposed group. It does not
modify a database, publish a profile, change an effective window, or grant
access to another household's data.

Run `npm run drinking-window:first-batch` to inspect the batch. A curator with
the private workbook audit export can also run:

```sh
npm run drinking-window:first-batch -- --candidates /absolute/private/path/candidates.json
```

That option checks the workbook SHA-256, source cell, vintage, colour, region,
historical bin and pair against the audited source export. It does **not**
upload the workbook or store its private contents in Git. The checked export
must come from `npm run drinking-window:audit` for the hash recorded in
`scripts/drinking_window/first_review_batch.json`.

| Review status | Count | Meaning |
| --- | ---: | --- |
| Different years from a 2022 historical bin; scope unverified | 4 | A numerical difference is not a conflict between equivalent profiles. The old bin and proposed group stay separate. |
| No 2023 workbook pair | 4 | These are new estimates, not workbook-derived dates. |
| Approved shared references | 0 | No group membership, specific evidence, reuse-rights decision or whole-window curator approval is asserted. |

The workbook's `standard`/`premium` labels are *not* established synonyms for
generic/Grand Cru or generic/Cru. The checker validates only that the archived
source cells and years were transcribed correctly; it does not prove the two
scopes equivalent. Where a useful legal hierarchy exists, a reviewed
classification may guide a profile. Elsewhere, define local early-drinking,
representative, or long-ageing classes with explicit membership. No wine gets
a broader reference by default while its class is unresolved.

## Owner review: four proposed profile families

These are the questions a cellar owner can usefully review. Dates are shown as
`start tasting / probable optimum start–end` and remain proposals, not advice.
Answer *agree*, *revise*, *split the group*, or *not sure* for each family;
research can continue where the answer is uncertain.

| Proposed family | 2022 | 2023 | Scope question |
| --- | --- | --- | --- |
| Alsace generic white | 2024 / 2026–2030 | 2025 / 2026–2030 | Is “generic white” too broad across grapes and styles? Which wines would you include or exclude? |
| Alsace Grand Cru white | 2025 / 2028–2038 | 2026 / 2028–2038 | Does Grand Cru alone suffice, or should grape, dryness, or site split the profile? |
| Beaujolais generic red | 2024 / 2025–2029 | 2024 / 2025–2029 | Should Beaujolais and Beaujolais-Villages share a profile? Exclude Nouveau. |
| Beaujolais Cru red | 2025 / 2028–2035 | 2024 / 2026–2033 | Are all crus too diverse for one group? Which need a shorter or longer profile? |

Once the group means something precise, the owner can assess whether the three
dates fit their preference for fresher or more evolved wines. The owner does
not need to verify canonical database IDs, source reuse rights, or publication
constraints; those remain curator/implementation work. Even an owner's assent
to a date estimate does not turn contextual articles into exact published
drinking windows.

Before converting any of these proposals into draft reference rows, a curator
must decide for each whole triplet:

1. Whether to accept, revise or reject the proposed three years after
   examining the differing/empty source history and wine-specific evidence.
2. The canonical region and reviewed group definition, plus which places,
   products or releases actually qualify; do not infer eligibility from the
   old workbook bin alone.
3. A source record and reuse-rights decision that support the dates and scope.
   Contextual regional articles alone do not substantiate exact calendar
   years for every wine in a group.

The publication preflight from delivery 2/6 remains closed. Once an initial
set is genuinely reviewed and entered as a draft version, delivery 4/6 can
compare its shadow results with the current model. The source dossier and
older Castagnier/Chagnoleau gaps remain in
[`drinking-window-missing-date-review.md`](drinking-window-missing-date-review.md).
