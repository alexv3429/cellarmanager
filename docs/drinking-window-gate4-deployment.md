# Gate 4 identity tooling deployment — draft PR #231

This is slot **5/6** of the [living release plan](drinking-window-release-plan.md).
The owner authorized backup, rehearsal and linked application on 1 November
2026. This installed three additive schema/routine migrations only. It did
**not** approve a drinking date, create a canonical identity batch, link a
household wine, publish a reference, change stock or enable a rollout.

## Scope and preflight

- Linked project: `cellarmanager-v02-dev` (`sxdqcvnjtayfxinyospb`). All
  [draft PR #231](https://github.com/alexv3429/cellarmanager/pull/231) CI
  checks passed before deployment: web, database, dependency audit, Worker
  build and aggregate gate.
- The linked dry run named **only**
  `20261101100000_drinking_window_profile_place_mapping.sql`,
  `20261101110000_drinking_window_package_identity_reader.sql`, and
  `20261101120000_drinking_window_profile_identity_batch.sql`. It listed no
  seed or role file. The push used `--skip-vault`.

## Protected backup and restored-copy rehearsal

The schema and data export of `public`, `private`, `auth`, `storage` and
`capture_guard` is retained outside Git at
`/private/tmp/cellarmanager-gate4-pr231-deploy-backup.enBDEE` (directory mode
0700, files mode 0600). SHA-256:

- `schema.sql`: `e4c01b28ddfaf37c0756deb518d8096e435d2ccb7a549b9ad45c69e2092234cf`
- `data.sql`: `5837661fbed93b3c9ff6d67cab5b751191e7f47b8de0d9fed953c3b4afce7e06`

This is sensitive temporary recovery material, not a durable managed
backup. Never commit it or restore it over subsequent live changes
automatically.

The export restored with `ON_ERROR_STOP=1` into a separate local database,
after the standard Supabase extension prerequisites. Existing circular
foreign keys required disabling triggers **only for the local data-restore
session**. The first data-restore attempt used a local role without sufficient
table privileges; its incomplete disposable database was dropped, recreated,
and fully restored using local `supabase_admin`. The completed baseline was
810 wines, four households, six auth users, 23 private profile archives and
two reference rows.

All three migrations applied on that completed copy with exit code 0. Those
five baseline counts remained unchanged and the new immutable identity-batch
audit table was empty. Seventeen rollback-only assertions passed on the copy,
including curator/ordinary-user separation, multi-format existence pointers,
stale-preview rejection, confirmation, and no date or cellar writes. After
the test rolled back, the identity-batch audit table was still empty. The
new RPCs are executable by `authenticated` (with an internal curator check),
not by `anon`; `authenticated` cannot directly read the private audit table.
The disposable restored database was dropped after the checks; the protected
backup above was retained for deliberate recovery only.

## Linked result and remaining verification

The authorized linked push reported exactly the three migrations above. A
fresh linked dry run reported **zero pending migrations**, seeds or roles.
No curator identity action was invoked during deployment. The migrations
contain no existing-wine, reference-row, stock or publication data updates;
the protected-copy counts verified that behavior. No linked aggregate
postflight query has yet been run, so unchanged live row counts should not be
claimed as independently measured. The preview app returned HTTP 200 at
`/admin/shared-reference`; its existing signed-in catalogue loaded with
synchronization current and still labelled the visible Chagnoleau windows
as model estimates. This is a smoke check, not a date-approval or canonical-
identity test. The draft PR remains a **no-go for merge
and for publication** until actual identity/date review and real-cellar
coverage checks described in the [Gate 4 audit](drinking-window-gate4-initial-base.md)
are done.

## Subsequent curator action (not part of the migration push)

Later on 1 November, the signed-in curator used the Gate 4 preview to create
one verified shared cuvée and vintage identity for Dureuil-Janthial Rully
Premier Cru Les Margotés blanc 2021 / 750 ml, then approved only its checked
2024 / 2026–2034 editorial estimate into **unpublished reference version 2**.
The draft now contains two approved rows including the previously reviewed
Burgaud Côte du Py 2022. The other 28 Dureuil profile proposals were set
aside. The built-in draft check passed; its read-only effect preview found
one match among 804 wine cards. No version was published, no household
opted in, and no cellar wine was linked by these actions. The detailed
identity and source review is in the [Gate 4 audit](drinking-window-gate4-initial-base.md).

## Household-name tooling extension — 2 November

After the owner asked to finish the local-name reconciliation mechanism, three
more Gate 4 migrations were installed on the same linked project, in order:
`20261102100000_household_wine_identity_reconciliation.sql`,
`20261102110000_household_cuvee_identity_links.sql`, and
`20261102120000_household_place_identity_links.sql`. These add a bounded
per-wine candidate preview, reusable owner-confirmed cuvée links and
household-only region/appellation links. They do not create a link, approve a
date or publish a profile by themselves.

Before this push, the draft PR's database, web, audit, Worker and CI-gate
checks all passed. The linked dry run listed exactly those three migrations,
zero seeds and zero roles. A fresh protected schema/data backup of `public`,
`private`, `auth`, `storage` and `capture_guard` was saved outside Git at
`/private/tmp/cellarmanager-gate4-links-backup.mlJh9D` (directory 0700,
files 0600), with SHA-256 `0daecd725808254d9469d45b298c3b9b99241415fb68330dba33c8b777faf2e3`
for `schema.sql` and `87dacaea8e62ef97a91a4415ecf5123d7bf2f7e5a978f5728f9501f4bcf67337`
for `data.sql`. This is sensitive, temporary recovery material, not a durable
managed backup. The export restored into a separate local database with
trigger checks disabled **only during that local data-restore session**.
Its preflight counts were 810 wines, four households, six users, 23 saved
profiles and three reference rows.

All three migrations applied successfully on that fresh clone. The cuvée
and geographic regression tests passed in rollback transactions (17 and 25
assertions respectively); the earlier per-wine test uses a seeded household
fixture absent from the restored live copy, but passed in the PR's fresh
Supabase CI. The clone retained the five preflight counts above, and the
new household cuvée, region and appellation link tables remained empty.
The linked push then reported exactly the three migrations, and a fresh
linked dry run showed **zero pending migrations, seeds or roles**. The
preview app loaded for the signed-in owner and displayed the new cuvée and
region/appellation panels after its service-worker update. This verifies
availability, not a completed cellar mapping or a published date. No live
aggregate postflight query was run, so unchanged live counts are not claimed
as independently measured. The disposable 2 November rehearsal database was
dropped after these checks; the protected temporary export was retained for
deliberate recovery only.

## Missing profile producer identities — 2 November

The owner reported that `Chaland` was absent from the household name-link
search despite its audited JSON profile being saved. That search reads
`wine_reference_producers`; a private JSON review archive does not create a
common producer identity. A comparison with the predeployment canonical
snapshot identified nine missing producer names across the 23 archived
profiles. Migration `20261102130000_gate4_profile_producer_identities.sql`
adds only those nine producer entities. It creates no cuvées, releases,
global shorthand aliases, household links, windows, or approvals.

All PR #231 CI checks passed. The linked dry run named exactly this migration,
zero seeds and zero roles. A fresh protected schema/data export of `public`,
`private`, `auth`, `storage`, and `capture_guard` is retained outside Git at
`/private/tmp/cellarmanager-gate4-chaland-backup.aLGQga` (directory 0700,
files 0600). SHA-256: `cde844fa396f56d0f64e4ee2cd1fa194a6a8061f407eb789e8e384babc185033`
for `schema.sql` and `e5f729b3f13f54c23602478042d62d3ad2736e742d9652804e727496f56d91a4`
for `data.sql`. This is sensitive temporary recovery material, not a durable
managed backup; do not commit it or restore it over subsequent live changes.

The completed export restored into isolated local database
`cm_gate4_chaland_20261102` with `ON_ERROR_STOP=1`; trigger checks were
disabled only in that data-restore connection. Before migration it contained
810 wines, four households, six users, 24 shared producers, and no producer
whose normalized name contains `chaland`. The exact migration applied there
without error. Afterward it still contained 810 wines, four households and
six users, with 33 shared producers, one Chaland producer and zero products
for that producer. The local fixture's six SQL regression assertions and the
web checks passed. The isolated restore is disposable; the protected backup
is retained for deliberate recovery only.

The linked push reported exactly this migration. A fresh linked dry run shows
zero pending migrations, seeds or roles. No live aggregate query or signed-in
owner name-link test has yet been run, so the restored-copy counts should not
be presented as live postflight results. The owner still needs to select the
now-searchable shared producer for local `Chaland`; the migration does not
do that automatically. This is a name-link correction, not completion of the
Gate 4 drinking-window base or authorization to merge/publish.

## Alvina Pernot duplicate identity consolidation — 2 November

The owner explicitly approved merging the three shared producer identities
all displayed as `Alvina Pernot`. Migration
`20261102140000_gate4_consolidate_alvina_pernot.sql` retains the oldest
producer ID (`236bccd8-88b1-4d76-95d6-db006aff75fb`), moves the other
two cuvées and any household name preferences to it, then removes the two
now-empty duplicate producer/root rows. Product, release and package IDs do
not change. A helper checks for other FK dependencies and refuses to merge if
an alias, window, evidence or other unreviewed reference depends on a retired
identity. Same-name producers remain allowed in general; only these reviewed
IDs are consolidated.

Before the linked push, a fresh schema/data backup of `public`, `private`,
`auth`, `storage` and `capture_guard` was retained outside Git at
`/private/tmp/cellarmanager-gate4-alvina-backup.jJ462g` (directory 0700,
files 0600). SHA-256: `cde844fa396f56d0f64e4ee2cd1fa194a6a8061f407eb789e8e384babc185033`
for `schema.sql` and `a8c90a6050e00365f0f8c88d0c8a7d3457fa5ca60e855fa5e9e37db634411ecb`
for `data.sql`. This is sensitive temporary recovery material, not a durable
managed backup. It must not be committed or automatically restored over
later live changes.

The complete export restored into isolated local database
`cm_gate4_alvina_20261102` with `ON_ERROR_STOP=1`; trigger checks were
disabled only for the local data-restore connection. The baseline contained
810 wines, four households, six auth users, three Alvina producer rows,
three Alvina products and no household preference referencing those IDs.
The exact migration applied successfully on that copy. Postflight counts
remained 810 wines, four households and six users; one Alvina producer and
all three products/releases remained. Nine rollback-only regression
assertions passed, including a fail-closed check for unreviewed dependencies.

All PR #231 checks passed before deployment. The linked dry run listed only
this migration, zero seeds and zero roles; the push reported applying only
this migration using `--skip-vault`. A fresh linked dry run reported zero
pending migrations, seeds or roles. No linked aggregate postflight query has
been run, so the restored-copy counts are not claimed as independent live
measurements. The existing preview tab still showed cached duplicate choices;
its sync log reported an expired JWT (`PSYNC_S2103`), so it cannot serve as a
post-deployment UI verification until the owner signs in again and refreshes.
No drinking window was approved or published, no cellar was opted in, and the
Gate 4 PR remains a draft no-go for merge and rollout.
The disposable restored database was dropped after the checks; the protected
temporary export remains available for deliberate recovery.

## LWIN producer-path correction — deployed 3 November

Migration `20261103100000_gate4_lwin_producer_identity_resolution.sql` is
proposed in the same draft PR and has **not** been applied to the linked
project. It changes only two owner-confirmed LWIN paths: when an LWIN product
is promoted or a LWIN-backed research producer is confirmed, they reuse one
unambiguous canonical producer. Multiple exact normalized producer rows and
missing LWIN producer names stop without creating a new product or link. The
existing household label remains local; its remembered choice points to the
shared producer. The curator profile batch and these paths serialize producer
resolution with the same advisory lock.

The local Supabase instance is older than this PR (migration ledger ends at
`20261022110000`), so a whole-suite run against it fails on absent later
functions and is not valid CI evidence. We did **not** reset that instance.
Instead, this migration and the three directly affected SQL tests were run
in separate rollback-only transactions on it: 9 new path assertions, 13
research assertions, and 32 existing LWIN matching assertions passed. No
local database change persisted. Before any linked application: require green
fresh CI, protected backup, restored-copy migration rehearsal, and a linked
dry run showing only this migration. Publication and cellar opt-in remain off.

The fresh PR #231 CI run for commit `2baf859` passed all checks, including the
Supabase database suite. The linked dry run listed exactly this migration,
with zero seeds or roles. A new protected export of `public`, `private`,
`auth`, `storage`, and `capture_guard` was retained outside Git at
`/private/tmp/cellarmanager-gate4-lwin-fkNnyz` (directory mode 0700; both
files mode 0600). SHA-256: `a649ad432c16a80ff235b2d489254389368d18b9980f6104c28691ea734c4ba3`
for `schema.sql` and `22d0a9e107e1309533054eceac65382d0acb423e3fea3b43d008a0bead2ca8c4`
for `data.sql`. This is sensitive temporary recovery material, not a durable
managed backup. It must not be committed or restored over later live changes
automatically.

The complete export restored with `ON_ERROR_STOP=1` into isolated local
database `cm_gate4_lwin_20261103` using `supabase_admin`; circular FK checks
were disabled only in the data-restore session. The exact migration applied
there without error. Before and after it: 810 wines, four households, six
users, 31 shared producers, 28 products, 19 LWIN7 identifiers, and zero
normalized duplicate-producer-name groups. A rollback-only check confirmed
that the resolver returns the existing unique Alvina Pernot ID and does not
add a row. The disposable database was then dropped; the export remains.
After the owner's explicit authorization and a second all-green CI run, the
linked push applied **only** this migration using `--skip-vault`. A new linked
dry run reported zero pending migrations, seeds or roles. Aggregate linked
postflight counts match the preflight: 810 wines, 31 producers, 28 products,
19 LWIN7 identifiers, zero normalized duplicate-name groups and one Alvina
Pernot producer. The resolver function is installed. No wine, stock, date,
publication or cellar rollout was modified by the migration.

The next read-only largest-household audit found 802 active wine cards:
300 have an effective shared producer link, 17 reach a cuvée and 16 reach a
vintage; 502 lack a shared producer link. These are identity counts, **not**
profile-backed drinking-window counts. Among the highest-impact unresolved
local names, `Clos Marie` (23 cards) and `Alvina Pernot` (eight cards) each
have one exact shared producer candidate, while shorthand labels such as
`Clavelier` (25) and `Castagnier` (23) need explicit household-to-shared
review. No local preference was written by this audit. These numbers set a
bounded producer-name review batch; they do not justify automatic fuzzy
linking or declaring Gate 4 complete.

## Producer-name suggestion deployment — linked, no mappings saved

The next proposed migration, `20261103110000_gate4_household_producer_suggestions.sql`,
adds owner-only suggestions to the existing producer-name review response. It
looks only at active wines and shared canonical names or curated aliases.
An exact name, a curated alias and a substring resemblance have different
labels; none is saved automatically. A separate UI checklist requires the
owner to select each household-specific mapping explicitly. The curator
profile workflow can narrow an identity-only batch to unblocked releases and
re-preview before confirming; it does not approve dates.

The protected 3 November snapshot above was restored again into a new,
isolated local database `cm_gate4_suggestions_20261103`. An initial restore
attempt failed on a missing local `unaccent` extension; that disposable
database was dropped and recreated with the same extension prerequisites as
local Supabase. The complete schema and data then restored with
`ON_ERROR_STOP=1`; the proposed suggestion migration applied cleanly. Under
the pilot owner's read-only RPC context, the copy has 802 active wine cards
under 147 normalized producer names. Eleven names already have household
mappings. Of the 136 unmapped groups, 22 have one suggested canonical
producer (seven exact, 15 similar), affecting 248 active cards; zero have
multiple suggestions and 114 have none. These are **candidate groups, not
confirmed identities or active profile windows**. The rehearsal wrote no
household mapping; its disposable database was dropped after the audit.
After the owner authorized deployment conditional on green CI and rehearsal,
all PR #231 checks passed for commit `f699c9e`. A fresh export of `public`,
`private`, `auth`, `storage` and `capture_guard` was retained outside Git at
`/private/tmp/cellarmanager-gate4-producer-suggestions.VKNsYC` (directory
mode 0700, files 0600). SHA-256: `0e539d53fbd1bd0712b6c3a16aea48d2cacd67984e70fd8878241446c2008993`
for `schema.sql` and `ac79cdca55d4d5a2e7a7ef60abdad2163d0e19fd285c30202fd2cba9d84a8f03`
for `data.sql`. This is sensitive temporary recovery material, not a durable
managed backup; never commit it or automatically restore it over subsequent
live changes.

The fresh export restored with `ON_ERROR_STOP=1` into isolated local database
`cm_gate4_suggestions_fresh_20261103` with the standard extension
prerequisites. The exact migration applied without error. Before and after:
810 wine rows, 31 shared producers, 11 household producer-name preferences,
and 28 shared products. The owner-only read-only RPC returned 22 single
candidate groups affecting 248 active cards, without saving a preference.
The linked dry run listed exactly `20261103110000` and no seeds or roles.
The owner-authorized linked push applied only that migration; the subsequent
linked dry run reported zero pending migrations, seeds or roles. This
deployment did not write a household mapping, change any wine or stock, or
approve or publish a drinking window. The preview owner walkthrough and
source-by-source coverage audit are still required before Gate 4 can close.

The same fresh snapshot gives the remaining scale of work, not a completion
claim: 31 shared producers, 28 shared cuvées/products, 23 releases, three
reference date rows across versions, and **zero rows in an active reference
version**. The 22 suggested local-name groups are only a subset of the 136
unmapped groups; 114 have no candidate in the present canonical graph.
Matching those 22 would not create a cuvée/release or make a date row active.
The supplied 23 JSON profiles cover a different editorial task: their 670
proposed dates must be resolved against canonical releases and reviewed as
shared estimates before publication. The separate 23-profile impact analysis
found 488 potential pilot wine cards by producer spelling; therefore the
other wines also need genuine appellation/region fallback coverage, not
invented producer matches.

## Owner review follow-up and Bernardins correction — linked

After the owner reviewed the producer suggestions, a fresh protected linked
export of `public`, `private`, `auth`, `storage` and `capture_guard` was saved at
`/private/tmp/cellarmanager-gate4-after-links.7YvyLp` (directory mode 0700;
files mode 0600). SHA-256: `869f387372e0daacdc6deeb47c94e9f8d1e8ceb692cb1ab4e90050b18504e7e5`
for `schema.sql` and `13a25c2c3ca6cda8020af4f6e73674b5bbbec9f7bbcba9551edb6c6642f74da6`
for `data.sql`. This sensitive temporary recovery material must not be
committed or automatically restored over later live changes.

The complete export restored into isolated local database
`cm_gate4_afterlinks_20261104`. Its 802 active pilot cards now have 32 mapped
local producer-name groups (21 more than before): 538 effective shared
producer links, 17 cuvée links, and 16 release links. Of 147 local producer
name groups, 114 have no suggestion in the current 31-producer graph. The
only unaccepted candidate is `Bernardins` → `de Bernardins`. The source
spelling comes from LWIN; the [winery](https://www.domaine-des-bernardins.com/les-bernardins/)
uses *Domaine des Bernardins*.

Migration `20261104100000_gate4_correct_bernardins_identity.sql` was applied
successfully to that restored copy. It renamed the one canonical
producer while preserving its UUID, existing product, and linked cellar wine;
the old LWIN spelling resolves through a curated source alias. Aggregate
counts remained 31 producers, 32 household preferences, 804 active wines
across households, and three reference date rows. It writes no household
mapping or drinking window. All PR CI checks passed. The owner then explicitly
authorized applying this single migration to the linked project.

A fresh protected linked export was saved at
`/private/tmp/cellarmanager-gate4-bernardins.zzamcg` (directory mode 0700;
schema/data files mode 0600). SHA-256: `869f387372e0daacdc6deeb47c94e9f8d1e8ceb692cb1ab4e90050b18504e7e5`
for `schema.sql` and `b07e995a9774d498d1933e32293d0a1c0045d05321c9aa1603514b06bbbb5146`
for `data.sql`. It is sensitive temporary recovery material; do not commit it
or restore it automatically over later live activity. The fresh export
restored with `ON_ERROR_STOP=1` to an isolated database
`cm_gate4_bernardins_fresh_20261104`; circular FK checks were bypassed **only
for that data-restore session**. The exact migration applied there without
error. Before and after: the producer UUID stayed
`b111b472-b3fc-41dd-a3c2-b2732b4f892e`, with one linked shared product,
32 household producer-name preferences and three reference date rows. The
old LWIN spelling resolves to the same UUID and no second `de Bernardins`
producer is created. The linked dry run then listed **only** this migration,
no seed or role changes. The authorized push applied it, and the linked
postflight dry run found zero pending migrations, seeds or roles.

This correction does not fill the remaining cuvée/release and date-coverage
gaps, and Gate 4 is not complete.

### Next reviewed identity batch, measured on the fresh pilot copy

The 538 producer-linked pilot wine cards are the practical starting point
for the 23 saved profiles; their producer links do **not** imply an exact
cuvée, release or approved drinking window. Highest-impact shared producers:

| Current shared producer label | Pilot cards linked to producer | Cards reaching cuvée | Cards reaching release |
| --- | ---: | ---: | ---: |
| Mas Jullien | 49 | 0 | 0 |
| Vincent Dureuil Janthial | 45 | 1 | 1 |
| Sylvain Langoureau | 35 | 1 | 1 |
| Louis Boillot | 33 | 2 | 2 |
| Jean-Marc Burgaud | 33 | 3 | 3 |
| Frantz Chagnoleau | 31 | 2 | 2 |
| de Cazeneuve | 31 | 0 | 0 |
| Bruno Clavelier | 25 | 0 | 0 |
| Clos Marie | 24 | 0 | 0 |
| Alvina Pernot | 23 | 3 | 3 |

Start with the high-impact profiles above: map each saved JSON producer to
the existing shared identity, explicitly review distinct cuvée and vintage
release identities (including documented renamings), then offer bounded
household cuvée-name links. Re-measure *actual* card matches after each
batch. This is a priority queue, **not** permission to create or approve all
the JSON entries wholesale. The other 264 pilot cards still lack a shared
producer link, so reviewed appellation/region fallbacks and further canonical
producer intake remain necessary for near-all-wines coverage. No old-model
estimate counts as a reviewed profile window.

For a bounded first example, the 49 Mas Jullien cards span local cuvée names
including `Autour de Jonquieres` (10), `Carlan` (nine), `Mas Jullien` (eight),
`La Brune` (four), `Rosé` (four), and smaller groups. The JSON has distinct
historic and current cuvées, so `Mas Jullien` and `Rosé` must not be linked by
name alone. One local `Mas Jullien · Rosé` card carries vintage **2028** in
the 2026 snapshot; treat that as an owner-data exception to check, not a
valid release to create automatically or a value to silently correct. The
first batch should review the obvious named cuvées and their actual vintages
before the broad or ambiguous labels.

An **identity-only, read-only** rehearsal selected the exact local-name,
colour and vintage intersections for four red Mas Jullien cuvées:
`Autour de Jonquières` (2014, 2015, 2016, 2018, 2020, 2021, 2022), `Carlan`
(2009, 2010, 2013, 2014, 2015, 2016, 2018, 2019, 2022), `La Brune` (2018),
and `Lous Rougeos` (2018). The existing curator plan reported **18 ready
release identities under four new cuvées**, with the existing Mas Jullien
producer and canonical Languedoc/Terrasses du Larzac places; it did not
create anything. The supplied profile points to named-vintage retailer
records such as [Autour de Jonquières 2022](https://www.mesvendanges.com/fr/boutique/vins/autour-de-jonquieres-mas-jullien-2022-75cl/)
and [Carlan 2022](https://www.lecarredesvins.com/16722-mas-jullien-carlan-2022-6716200.html).
The [iDealwine Carlan page](https://www.idealwine.com/fr/prix-vin/113121-2019-Bouteille-Languedoc-Terrasses-du-Larzac-Carlan-Mas-Jullien-rouge)
is for 2019 but includes a selector naming older vintages; it is a less
precise pointer for those entries than a direct vintage page. Existence
pointers do **not** establish any of the three proposed drinking-window
years. No shared identity, cellar link, date, or publication was written by
this rehearsal; the batch awaits explicit curator action after source review.

### New owner research files and next producer priorities — 4 November

The owner supplied new v1.1 research files for G.D. Vajra (seven cuvées,
15 exact-release proposals) and Jean-Marc Roulot (six cuvées, 13 proposals).
On the protected pilot snapshot, local `Vajra` has 15 active wine cards / 21
bottles and `Roulot` has 13 / 14. Each local cuvée, vintage and 750 ml format
has a corresponding *candidate* release in the respective file, including
the documented short local aliases. This is 28 cards / 35 bottles of potential
exact-release review, **not** 28 approved or displayed windows. In particular,
Vajra's local `Dragon` must be checked against the file's Luigi Baudana
identity before any canonical link is accepted.

Neither attached JSON currently passes the agreed v1.1 validator unchanged:
four Vajra and five Roulot cuvées have an empty optional `site_description`.
Removing those empty optional properties in memory makes both files validate,
including their cross-references and three-year ordering. Both files also
contain a copied Carillon-specific sentence in `import_policy.identity_links`;
that sentence is unrelated to either producer and must be corrected before
curator archival. The original owner files have not been edited, archived or
published. No household link, shared identity or drinking window was changed.

The same snapshot ranks *additional producer profiles not in the 23 archived
files*, by current bottles, with local producer labels shown as such:

| Local producer label | Active wine cards | Bottles | Identity note |
| --- | ---: | ---: | --- |
| `Pernot` + `Alvina Pernot` | 23 | 32 | Both owner-linked to shared Alvina Pernot; no supplied profile yet. |
| `Thomas Morey` | 8 | 18 | Shared producer identity and cuvées require review. |
| `Boxler` | 10 | 17 | No shared producer candidate yet; confirm full domain identity. |
| `Darnaud` | 8 | 16 | No shared producer candidate yet. |
| `Conterno Fantino` | 4 | 14 | No shared producer candidate yet. |
| `Vaillé` | 7 | 13 | No shared producer candidate yet. |
| `Giovanni Almondo` | 6 | 13 | No shared producer candidate yet. |
| `Giuseppe Cortese` | 5 | 8 | No shared producer candidate yet; do not conflate with other Cortese producers. |

These counts prioritize research, not a promise that a new JSON will cover
every listed release. Exact cuvée/vintage/format rows and reviewed evidence
remain necessary. Keep this work in draft PR #231 (Gate 4, slot 5/6); do not
open another PR or count the old model as profile coverage.

### Second owner bundle: 19 profiles plus Alvina Pernot — 4 November

The owner then supplied `CellarManager_19_profils_v1.1_2026-11-04.zip`
(SHA-256 `e418fab228d494b5de245a12f9392894f62dd8529567dd43442144a68f5f0f1d`)
and a separate Alvina Pernot JSON
(SHA-256 `0a3f54b0ded10a212e4e4f775c73089600e69c8564c774599233b56d520dadc4`).
The ZIP contains 19 producer files, an index and a README. None duplicates
the 23 profiles already in the private curator archive. The 20 new files
describe 84 cuvées and 101 exact-release *proposals*.

Read-only candidate matching against the protected pilot copy found 113
active cards / 182 bottles under those local producer names, 111 / 180 with
one exact cuvée label and colour, and **101 / 165** also matching an explicit
vintage and format row. The strongest exact-row opportunities are Alvina
Pernot 11 cards / 15 bottles (from 23 / 32 producer candidates), Thomas Morey
8 / 18, Boxler 10 / 17, Darnaud 8 / 16, Conterno Fantino 4 / 14, Giovanni
Almondo 6 / 13 and Giuseppe Cortese 5 / 8. These are *name overlaps only*;
they neither establish canonical identity nor provide a published window.

All 20 files **fail** the agreed v1.1 validator. Across 101 proposed rows,
zero assert a named-vintage release confirmed by a cited source. Eleven of
the 20 profiles have no source entries at all. Many optional grape fields are
empty strings. The ZIP README explicitly describes the dates as model-based
estimates and says cuvée/vintage membership came from the owner's personal
CSV rather than necessarily from an independent release record. This is
valuable triage, but does not justify turning private inventory observations
into shared release facts or declaring model years independently sourced.
Do not fill empty source IDs with invented references or silently change the
release-existence status. These 20 files were **not imported, staged,
approved or published**; the original files remain unchanged.

The bounded route within Gate 4 is to verify canonical producer/cuvée and
named-release identities for the highest-impact rows, record genuine source
pointers and provenance, then present the three model-based years honestly
as editorial estimates for curator review. Rows without that evidence stay
quarantined. Re-measure actual profile-backed coverage after publication;
the 101 candidate matches must not be counted toward the 95% release goal.

## Exact-name cuvée reconciliation rehearsal (4 November 2026)

Draft #231 now includes a bounded cellar-only batch for unique, identical
canonical cuvée names under an owner-confirmed producer. Similar names and
profile aliases are **not** auto-linked; an owner can inspect the complete
plan before explicitly applying it. The immutable decision log records
`exact_canonical_name`, and the operation has no authority to approve dates.
The new migration is local-only; no linked deployment has been attempted.

On disposable database `cm_gate4_autoexact_test`, copied from protected
restored snapshot `cm_gate4_bernardins_fresh_20261104`, the migration applied
and 18 rollback-only database assertions passed. The 46 exchange JSONs from
the owner's 4 November ZIP were then imported into this disposable clone
only, leaving 69 archived profiles / 1,131 proposals there. The existing
curator identity-batch RPC created four Mas Jullien products and 20 release
identities for unblocked rows, with `dates_staged=0` and `published=false`.
The exact-name owner batch linked 5 local naming groups / 27 wine cards:
26 Mas Jullien and one Cal Demoura. The resulting lineage has 538 producer,
44 product and 28 release identities across 802 active pilot cards, compared
with 538/17/16 before this rehearsal. Twelve of the 27 newly product-linked
cards reach a unique release; the others have no corresponding canonical
release yet. **No shared-profile dates were published**, so the effective
source remains the old model or a local/manual choice. All live cellar and
linked-project counts remain unchanged by this experiment.

Identity previews for the 46 newer profiles show that most remaining release
keys are blocked by unresolved region/appellation names in the shared place
graph, not by failed JSON validation. Resolve those place identities
explicitly, create verified producer/cuvée/release identities in bounded
curator batches, and only then stage checked three-date proposals. Measure
actual wine-card sources after each batch; do not count JSON rows or textual
overlaps as live coverage.

## Import-scoped place suggestion rehearsal (4 November 2026)

The same draft PR now offers a curator-only, read-only suggestion step for
places named in a saved producer profile. It proposes a parent region only
when a composite name starts with one uniquely existing canonical region
(for example `Bourgogne — Mâconnais` → `Bourgogne`), when a unique existing
place alias applies (for example `Piémont` → `Piemonte`), or when changing
`1er Cru` to `Premier Cru` yields one existing appellation. It
does **not** create aliases, places, cellar links or dates. The curator must
read the displayed source→target list and explicitly use it for this one
import; the existing server previews still validate the parent/appellation
relationship. `Roussillon`, `Rhône septentrional` and uncertain or generic appellations
are deliberately not guessed by this rule.

On disposable clone `cm_gate4_autoexact_test` with the 46 final owner profiles
(dataset version 11.0.0), this generated 41 region and 12 appellation
suggestions across the files. A read-only identity-plan comparison for their
460 distinct cuvée/vintage keys found **28 unblocked with no mappings** and
**235 unblocked if every suggestion were explicitly accepted**. The latter
is only an upper-bound rehearsal, not 235 reviewed identities or published
windows; 15 keys still fail region identity and 210 fail appellation identity
after these suggestions. Eight rollback-only database assertions passed for
unique suggestions, absent/uncertain places, ordinary-user denial and no
identity/alias writes. At this rehearsal point, the linked project had not
received this migration; its later application is recorded below. The
46-profile import has not been applied. Gate 4 remains a no-go until the remaining identity,
evidence, date and actual-cellar coverage checks are completed.

## Two pending identity-tooling migrations — 5 November preflight

Fresh CI on commit `da3262a` passed its web, Supabase database, dependency,
Worker and aggregate checks. A linked dry run named **only**
`20261104110000_gate4_exact_household_cuvee_batch.sql` and
`20261104120000_gate4_profile_place_suggestions.sql`, with zero seeds or
roles. No linked push has been performed at this point.

A fresh protected export of `public`, `private`, `auth`, `storage` and
`capture_guard` is retained outside Git at
`/private/tmp/cellarmanager-gate4-place-backup.8bxUyT` (directory mode 0700,
files 0600). Its SHA-256 values are
`7699860cb8c103916bf0c39d1a545a0fdcf03859c8f157c0d63f94b8640620be`
for `schema.sql` and
`71b9f1862e66f6550ed14c7b65d3110e1cc6ce98f000ae2ca65bd15784faf7f2`
for `data.sql`. This is sensitive temporary recovery material, not a durable
managed backup; do not commit it or restore it over later live changes
automatically.

The export restored with `ON_ERROR_STOP=1` into new isolated local database
`cm_gate4_place_20261105`. Circular FK checks were disabled **only for the
data-restore session**. The complete baseline contained 810 wines, six users,
23 archived profiles and three reference rows. Both exact migrations applied
there without error. The 18 exact-cuvée and eight place-suggestion assertions
passed in rollback-only transactions. Postflight counts remained 810 / 6 /
23 / 3, with zero exact-name batch decisions. This rehearsal neither links
a cellar wine nor approves or publishes any date. Linked application was
subsequently authorized and is recorded below; the draft PR remains no-go
for merge.

## Authorized linked application — 5 November postflight

The owner explicitly authorized applying the migrations. Immediately before
the push, the working tree was clean, all PR #231 checks had passed, the
protected backup still matched the SHA-256 values above, and a fresh linked
dry run again named only `20261104110000_gate4_exact_household_cuvee_batch.sql`
and `20261104120000_gate4_profile_place_suggestions.sql`, with zero seeds and
roles. `supabase db push --linked --skip-vault` applied both without error to
`cellarmanager-v02-dev`. A fresh linked dry run returned `upToDate: true` and
zero pending migrations, seeds or roles. No live aggregate query or signed-in
app smoke test was performed as part of this postflight; the restored-copy
counts above must not be represented as live postflight counts.

These migrations add exact-name cellar reconciliation and import-scoped place
suggestions. The push did not import the 46 profiles, execute a household
mapping batch, review or publish shared dates, or enable advice. The PR and
Gate 4 remain draft/no-go pending the documented data and coverage work.

## Classified appellations and unresolved source names — 5 November rehearsal

On disposable clone `cm_gate4_autoexact_test`, all 46 final producer profiles
contain 598 cuvée descriptions and 461 proposed three-date rows. A read-only
place audit found 40 proposed rows whose profile appellation string matches
an existing `Premier Cru` classification with a unique **appellation** parent
(for example `Meursault 1er Cru` → classification `Meursault Premier Cru` →
appellation `Meursault`). The same audit found 59 proposed rows whose field
literally says `appellation à préciser`; those are **not** place mappings.

Draft migration `20261105100000` extends only the curator's import-scoped
suggestions to expose the unique classification-parent case, with its reason.
The actual clone RPC returned 21 such name suggestions across 14 profiles;
the 40-row figure counts affected proposals, not accepted mappings.
The UI now starts with every suggested correspondence unchecked, so the
curator can accept only the individually reviewed names; no all-or-nothing
bulk selection is imposed. The identity/staging preview
checks the region/appellation relationship. A classification whose parent is
only a region is never collapsed. The migration changed no live project,
profile, alias, wine or date at this stage. The restored clone accepted the
function replacement; ten rollback-only SQL assertions, 17 focused web tests
(one skipped), and the web production build passed.

One high-impact exception must remain quarantined: 38 of the 59 uncertain
rows are Mas Cal Demoura's Terres de Jonquières, Feu Sacré and Fragments.
The [producer's wine list](https://www.caldemoura.com/les-vins) calls the
current wines Terrasses du Larzac, but the [INAO history](https://www.inao.gouv.fr/produit/terrasses-du-larzac-12972)
dates the standalone AOC to October 2014. The JSON includes 2007–2013
vintages; mapping every vintage of a cuvée to today's appellation could
misstate their historical identity. Verify release-specific labels before
creating those identities. This is a data and exchange-format limitation,
not a reason to guess or publish the 38 rows.
