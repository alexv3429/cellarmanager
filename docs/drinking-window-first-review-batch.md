# Drinking-window delivery 3/6: first review batch

This is a **research-only set of eight three-milestone proposals**, not eight
approved shared references. It turns the owner's later Alsace and Beaujolais
2022–2023 estimates into a machine-checkable review batch while retaining the
different 2022 workbook values and the empty 2023 workbook rows. It does not
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
| Conflicts with retained 2022 workbook optimum | 4 | The owner proposal and historical pair stay separate. In particular, the Beaujolais differences are large. |
| No 2023 workbook pair | 4 | These are new estimates, not workbook-derived dates. |
| Approved shared references | 0 | No group membership, specific evidence, reuse-rights decision or whole-window curator approval is asserted. |

The first two categories are not interchangeable: `standard`/`premium` in the
workbook are *not* established synonyms for generic/Grand Cru or generic/Cru.
The proposed groups must be defined with explicit eligibility and exclusions.
Alsace may need grape, dryness and site distinctions; Beaujolais Nouveau must
not be included in a generic cellar-ageing profile. There must be no automatic
region-wide application while membership is unresolved.

Before converting any of these proposals into draft reference rows, a curator
must decide for each whole triplet:

1. Whether to accept, revise or reject the proposed three years after
   examining the conflicting/empty source history and wine-specific evidence.
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
