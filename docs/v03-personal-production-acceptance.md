# v0.3 personal-production acceptance

This document records the final end-to-end acceptance of CellarManager v0.3
before the release step. It consolidates the user validation already performed
for roadmap steps 0.3.1 through 0.3.16 and adds one final smoke pass against the
real personal-production household.

Acceptance was **completed on 2026-08-14**.

## Safety boundary

- The existing PostgreSQL household remains the authoritative cellar.
- The final account uses the intended email and password; changing credentials
  did not replace, copy, reset, or re-import the household.
- This acceptance pass does not run the retired v0.1 migration or import the
  archived source a second time.
- Automated checks do not mutate production data.
- The final smoke pass does not commit a CSV import or require artificial
  inventory operations. ADD, MOVE, REMOVE, CSV commit, and offline replay were
  already validated in their delivery steps.

## Automated release gates

The acceptance commit must pass:

- [x] repository policy checks
- [x] web lint, 193 unit tests across 33 files, and production PWA build
- [x] local Supabase database acceptance tests (12 files, 211 tests)
- [x] production-dependency audit at the high-severity threshold (0
  vulnerabilities)
- [x] clean Git diff validation

## Final personal-production smoke pass

Use the production build with the final account and the real household. This is
intentionally a short confidence pass rather than a repetition of every
feature-level acceptance session.

- [x] A cold open and refresh reach the cellar without remaining on “Loading
  household data”.
- [x] The header reaches **Up to date**, the device reaches **Ready**, and no
  unexplained synchronization error or queued operation remains.
- [x] Inventory shows a plausible bottle total and the expected cellar/location
  structure; its search, cellar, and location filters work.
- [x] A wine opens from Inventory, its detail is plausible, and Back returns to
  the prior view.
- [x] Inventory, Activity, Catalog, Import, and Cellar setup all open; refreshing
  a route and browser Back/Forward preserve the expected destination.
- [x] Activity shows the latest accepted inventory changes and its search/type/
  synchronization filters respond.
- [x] Catalog search and wine details work without horizontal page overflow on
  the available desktop viewport.
- [x] Cellar setup shows active storage in the intended display order, sensible
  occupancy/capacity summaries, and no unexpected archived records.
- [x] Import accepts the
  [`v03-acceptance-preview-do-not-commit.csv`](fixtures/v03-acceptance-preview-do-not-commit.csv)
  fixture through mapping, an explicit `750 ml` Bottle format value applied to
  every row, storage resolution, and final preview while remaining read-only
  because **Commit import** is not selected.

Additional real-world CSV acceptance covered a missing Bottle format column,
blank Cuvée fallback rules, `NM` to `NV` normalization, explicit readiness
feedback, and creating a new cellar plus initial location for an otherwise
storage-unresolved import.

## Phone acceptance note

Authenticated phone navigation and the CSV flow were exercised during the
feature steps. The final 0.3.16 phone recheck was explicitly deferred because
the test phone was overheating while traveling. Desktop acceptance plus
automated narrow-viewport checks were accepted for that PR; this is recorded as
a follow-up validation opportunity rather than a known production blocker.

## Acceptance conclusion

All automated gates and the user smoke pass succeeded. v0.3 is accepted as the
personal-production baseline and roadmap step 0.3.17 is complete. Creating the
`v0.3.0` release and tag remains the separate 0.3.18 PR.
