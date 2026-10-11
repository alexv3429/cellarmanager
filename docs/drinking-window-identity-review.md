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
