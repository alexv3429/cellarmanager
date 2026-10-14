# Drinking-window identity review

The workbook audit and the shared reference catalogue now have a read-only
comparison step. It suggests exact normalized name/alias matches for each
candidate's required identity fields and keeps all decisions open. Surname
containment appears only as a possible producer-name hint. It is not an alias,
a verified identity, or a basis for publication. Region comes from a matched
appellation's place hierarchy; a producer-wide row does not inherit a region
from the producer's other wines. A `1C`/`GC` classification is not silently
treated as an appellation.

The snapshot contains shared producer, product, release, place, and alias
identities only. It excludes household wines, bottles, locations, prices,
notes, and manual windows. All generated files stay in a private directory
outside Git, are created with owner-only permissions, and are never uploaded by
these commands. The commands refuse to overwrite previous output.

```sh
mkdir -m 700 /tmp/cellarmanager-window-review
npm run drinking-window:audit -- \
  --file /path/to/Caves_2.0.xlsx \
  --out-dir /tmp/cellarmanager-window-review \
  --expected-sha256 42b935d4fd2e161605d245b15b853d4ee7c1a0a9eed1ea14d460a80857373911
npm run drinking-window:snapshot -- \
  --project-ref YOUR_LINKED_DEV_PROJECT_REF \
  --out-dir /tmp/cellarmanager-window-review
mkdir -m 700 /tmp/cellarmanager-window-identity-results
npm run drinking-window:review -- \
  --candidates /tmp/cellarmanager-window-review/candidates.json \
  --identity-snapshot /tmp/cellarmanager-window-review/identity_snapshot.json \
  --out-dir /tmp/cellarmanager-window-identity-results
```

The output is `identity_review.json` (each source cell, proposed IDs, and open
reasons) plus `identity_summary.json` (counts and snapshot time). A `suggested`
status means a unique exact normalized canonical name or reviewed alias was
found; it does **not** confirm that the workbook meant that entity. `missing`
and `ambiguous` need curation. `blocked_by_*` means an upstream identity must
be settled before the dependent field can be searched. The report always sets
`publishable: false`. It never fills the missing start-tasting year, resolves
the old standard/premium bin, or assesses source rights.

## Development-catalogue baseline, 11 October 2026

Against the linked `cellarmanager-v02-dev` shared catalogue snapshot and the
audited workbook SHA above, the comparison returned:

| Item | Count |
| --- | ---: |
| Staged workbook pairs | 226 |
| Quarantined rows | 4 |
| Regional candidates with a unique region suggestion | 142 |
| Producer-level candidates with all scope identities suggested | 0 of 84 |
| Producer-level candidates with one unverified name hint | 25 of 84 |
| Producer candidates without an exact canonical name/alias | 84 of 84 |
| Producer candidates with an unresolved appellation label | 29 of 84 |
| Complete, publishable three-date windows | 0 |

The catalogue snapshot contained 17 producer records, 22 products, 16
releases, and 151 places. The short sheet names (for example, `Barraud`) are
not reviewed producer aliases; a possible surname match remains a hint. The
29 appellation gaps include labels such as `Bourgogne`, `Bourgogne GC`, and
several `1C` tiers that need explicit place/classification decisions. The
five Chagnoleau producer-wide rows still need a reviewed region and eligible
wines. The 142 regional matches still need local ageing-group eligibility,
source-rights review, and a sourced start-tasting year. These counts describe
this development snapshot, not today's production cellar or completed advice.

Next curation should verify producer aliases and missing canonical wine
identities, settle classification-versus-appellation labels, and review the
producer-wide region/eligibility. Only after that should evidence and all
three years be reviewed as one window. No draft row should be published simply
because it acquired an identity suggestion.

## Workbook-specific producer research, 11 October 2026

The optional, source-hash-pinned research file
`scripts/drinking_window/producer_research_20261011.json` documents four
possible matches to the development catalogue. It is **not** a global alias
list or an owner/curator approval. The open questions in this historical
research table are updated by the owner-confirmed interpretations below.
Use it with a new private output directory:

```sh
npm run drinking-window:review -- \
  --candidates /tmp/cellarmanager-window-review/candidates.json \
  --identity-snapshot /tmp/cellarmanager-window-review/identity_snapshot.json \
  --out-dir /tmp/cellarmanager-window-research-results \
  --producer-research scripts/drinking_window/producer_research_20261011.json
```

The reviewer validates the workbook hash, exact source sheet and producer
text, a unique canonical producer name in the current snapshot, and any
conflicting catalogue alias. It refuses stale or ambiguous mappings. A
`research_supported` producer permits *further read-only comparison* of
products and releases, but is not counted as a confirmed scope identity and
cannot publish a window.

| Workbook sheet | Catalogue producer proposed | Rows | Why it is plausible | Still open |
| --- | --- | ---: | --- | --- |
| Barraud | Daniel Barraud | 1 | [Domaine history](https://www.domainebarraud.com/le-domaine.html) names Daniel and the family domaine. | Confirm the 2023 Sur la Roche cuvée and its Premier Cru classification; that product is absent from this snapshot. |
| Boillot | Louis Boillot | 13 | [Producer range](https://www.bbr.com/producer-847-louis-boillot) covers Burgundy and Beaujolais. | Confirm the short surname, each appellation tier, and eligibility of the producer-appellation rows. |
| Cal Demoura | Mas Cal Demoura | 5 | The [domaine](https://www.caldemoura.com/the-estate) identifies its name and [lists the cuvées](https://www.caldemoura.com/les-vins). | Check the 2023 Belle Fiolle label: the *current* domaine page calls it Vin de France, whereas workbook cell `Cal Demoura!C4` says Terrasses du Larzac. Do not assume the current classification applied in 2023. None of the five 2023 releases exists in this snapshot. |
| Chagnoleau | Frantz Chagnoleau | 6 | The [domaine distributor](https://www.dvp-vins-domaines.com/fr/domaine/8/domaine-chagnoleau) names the producer and Pouilly-Fuissé Madrigal. | Madrigal is absent as a catalogue product; five other rows are producer-wide and still need a reviewed region and eligible wines. |

This research adds a candidate producer ID to 25 of the 84 producer-level
rows, leaving 59 without a producer candidate. The other workbook sheets
(`Barthod`, `Bouzereau`, `Carillon`, `Castagnier`, `Clavelier`, and
`Montcalmes`) have no corresponding producer in this development snapshot;
they need their own canonical-entity review, not a guessed surname alias.
There are still **zero publishable windows**: no first-tasting year, rights,
ageing-group membership, or complete identity has been approved. The next
curation pass should confirm or reject each producer proposal and settle the
wine/place disagreements before any shared-data write.

## Owner-confirmed source interpretations, 15 October 2026

The optional, workbook-hash-pinned
`scripts/drinking_window/source_interpretations_20261015.json` records what the
owner clarified after the research pass. It is a review overlay, not a change
to the workbook, a global catalogue alias, or drinking advice. The original
`source_identity` stays in the private report; `review_identity` shows a
corrected interpretation only for the two exact source rows below. The
reviewer rejects a changed workbook hash, locator, vintage, or source text.

| Source | Owner-confirmed interpretation | Remaining work |
| --- | --- | --- |
| `Barraud!E5:F5` | Sur la Roche 2023: `Pouilly-Fuissé` appellation and `Pouilly-Fuissé Premier Cru` classification, rather than treating `1C` as part of the appellation name. | Create/confirm the canonical cuvée and release; review Premier Cru eligibility, source rights, and start-tasting year. |
| `Cal Demoura!E4:F4` | Belle Fiolle 2023: `Vin de France`, not the workbook's `Terrasses du Larzac`. | Model this national designation separately from a geographic appellation, review the wine's region and release, source rights, and start-tasting year. Never infer a Terrasses du Larzac match from this row. |
| Boillot's 13 producer-appellation rows | Blank cuvée means an intentional group of several cuvées, not every cuvée under that producer and appellation. | Define reviewed eligible cuvées/releases for each group and settle the `1C` place tiers. |
| Chagnoleau's five producer-wide rows | Vintage-wide white-wine guidance received from the producer; blank appellation is intentional. | Confirm region and eligible wines; retain only the vintages present, without interpolation. Madrigal remains a separate release row. |

Run the review with both optional files and a **fresh** private output
directory (the development identity snapshot above is dated 11 October and
should be refreshed before any catalogue decision):

```sh
npm run drinking-window:review -- \
  --candidates /tmp/cellarmanager-window-review/candidates.json \
  --identity-snapshot /tmp/cellarmanager-window-review/identity_snapshot.json \
  --out-dir /tmp/cellarmanager-window-owner-results \
  --producer-research scripts/drinking_window/producer_research_20261011.json \
  --source-interpretations scripts/drinking_window/source_interpretations_20261015.json
```

Against that 11 October development snapshot, 2 rows receive an exact
owner-confirmed correction and 18 receive a scope-intent note (13 Boillot,
5 Chagnoleau). Barraud's corrected appellation and classification each find
one catalogue suggestion, but Sur la Roche is still absent as a product.
Belle Fiolle no longer suggests the wrong appellation or region. The report
still has **zero publishable windows**. The owner's clarification establishes
these interpretations, not the missing start-tasting dates, evidence rights,
catalogue entities, or wine-to-group memberships.
