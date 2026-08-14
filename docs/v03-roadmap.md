# v0.3 personal production roadmap

v0.3 is the personal production baseline: a user can make CellarManager the
authoritative day-to-day record of a cellar, either by entering it manually or
by safely bootstrapping it from a reasonably messy CSV.

## Stable product contracts

The milestone improves how users enter and work with the cellar without
redefining the v0.2 inventory architecture:

- a wine keeps a stable ID and physical/reference identity
- a cellar and location keep a stable physical-storage meaning
- a holding remains a wine, location and bottle quantity
- PostgreSQL holdings remain authoritative
- ADD, MOVE and REMOVE remain local-first inventory operations
- a household remains the ownership and security boundary
- manual entry, legacy migration, CSV import and future capture workflows all
  produce the same CellarManager wine, holding and location records

## Delivery sequence

| Step | Scope | Status |
|---|---|---|
| 0.3.1 | Application shell and URL-backed navigation | Complete (#58, #60, #61, #62) |
| 0.3.2 | Mobile-first inventory browsing | Complete |
| 0.3.3 | Everyday ADD, MOVE and REMOVE workflows | Complete |
| 0.3.4 | Wine detail page | Complete |
| 0.3.5 | Cellar and location UX | Complete |
| 0.3.6 | CSV ingestion format and parser | Complete |
| 0.3.7 | CSV column mapping | Complete |
| 0.3.8 | CSV cleaning and normalization | Complete |
| 0.3.9 | Existing-wine matching and ambiguity detection | Complete |
| 0.3.10 | Location and quantity reconciliation | Complete |
| 0.3.11 | Import preview | Complete |
| 0.3.12 | Import issue resolution | Complete |
| 0.3.13 | Transactional import commit | Complete |
| 0.3.14 | Import regression fixtures | Complete |
| 0.3.15 | Activity and synchronization UX | Complete |
| 0.3.16 | PWA, mobile polish and accessibility | Complete |
| 0.3.17 | Personal-production acceptance | Complete |
| 0.3.18 | v0.3.0 release | Complete |

The multiple PRs listed for 0.3.1 are a historical exception. Remaining steps
are delivered as one logical step per PR. Each step is implemented and checked
automatically, validated by a user against an explicit acceptance checklist,
then opened as a ready-for-review PR. The next step starts only after that PR is
merged.

After 0.3.4, the already-accepted v0.1 FastAPI/SQLite runtime and its one-off
migration tooling were retired from the active tree and CI. The `v0.1.0` and
`v0.2.0` tags preserve that history; the acceptance evidence below remains in
the repository. This maintenance cleanup does not change the product delivery
sequence.

## CSV import safety contract

The permanent product importer is separate from the one-off v0.1 migration.
Its required flow is:

`upload -> map -> clean -> preview -> resolve -> preview -> commit`

Before any authoritative write it must preserve source row numbers, normalize
known values, validate quantities and locations, distinguish new, existing,
ambiguous and invalid wines, and show the user exactly what will be matched or
created. It must use normal domain rules rather than unrestricted table writes.

Bulk CSV import may require an online connection in v0.3. Everyday ADD, MOVE
and REMOVE retain their v0.2 offline behavior.

## Milestone conclusion

All eighteen steps are complete. The accepted application, release metadata,
and release notes define the `v0.3.0` personal-production baseline. After the
release PR is merged, the annotated `v0.3.0` tag is created from the resulting
protected `main` commit; no additional Milestone 3 feature work follows that
tag.
