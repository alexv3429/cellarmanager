# v0.4 rich-library acceptance

Status: **Accepted on 2026-08-31**.

This document consolidates the feature acceptance already completed for roadmap
steps 0.4.1 through 0.4.19 and defines the final, deliberately short production
pass for `v0.4.0`. The pass verifies the released contracts and the current
cellar without re-running research, changing inventory, or manufacturing review
cases solely for release.

## Safety boundary

- The existing PostgreSQL households and holdings remain authoritative and are
  never reset, copied into fixtures, or treated as disposable test data.
- Release checks read public readiness and authenticated aggregate/user-facing
  projections only. They do not export household wine identities.
- Shared knowledge remains inactive until attributable owner review and trusted
  publication; the acceptance pass does not bypass that lifecycle.
- Private observations, overrides, and maturity calibration cannot update the
  canonical shared library or another member's preferences.
- The release candidate applies only committed additive migrations. It does not
  repeat the retired v0.1 migration or metadata restoration.

## Automated release gates

The release commit must pass:

- [x] repository policy and cross-file `v0.4.0` metadata checks;
- [x] web lint, 290 unit tests across 46 files, and production PWA build;
- [x] 57 enrichment/worker, 7 LWIN, and 4 historical restoration tests;
- [x] a clean local Supabase rebuild and 786 pgTAP assertions across 31
  database files;
- [x] production-dependency audit at the high-severity threshold (0
  vulnerabilities);
- [x] `git diff --check`; and
- [x] the read-only production readiness check:
  `npm run release:check -- --production https://cellarmanager.cellarcloud.workers.dev/`.

The production gate requires the deployed `0.4.0` worker, Workers AI,
Supabase, and at least one configured web-discovery provider. It returns only
version and readiness booleans.

## Final production smoke pass

Use the real production account and household. Previously accepted feature
details do not need to be repeated.

- [x] Cold-open and refresh Catalog and Food pairing without a persistent
  loading/readiness error; normal navigation and browser Back still work.
- [x] Catalog's coverage summary and prioritized curation queue load, show
  plausible totals, and distinguish unavailable wine data from missing shared
  profile layers.
- [x] The research inbox excludes completed requests from its active count and
  contains no unexplained case stuck in publication. A completed real producer
  cycle remains visible as published history.
- [x] Open one representative red and one representative white. Their maturity
  windows, provenance, profile limits, and storage/moving guidance are
  plausible; unsupported wines remain explicitly unevaluated rather than
  guessed.
- [x] Apply a private younger/later preference, confirm the canonical and
  personal dates remain distinguishable, then reset it. A per-wine manual
  window remains the highest-priority instruction.
- [x] Pair a familiar savory dish and a dessert. Suggestions rank only bottles
  in stock, explain the result, and reject structurally unsuitable sweetness or
  color combinations.
- [x] A published profile exposes **Report an issue** and its governed history;
  existing report/revision status is understandable without creating an
  artificial production case.
- [x] Data transfer downloads an Excel workbook by default, offers CSV as an
  alternative, and retains online drinking-window columns.
- [x] On a phone-width viewport, primary navigation, Catalog, Wine detail,
  pairing controls/results, and the research/coverage summaries do not require
  horizontal page scrolling.

## Acceptance conclusion

All automated gates and the final production smoke pass succeeded. v0.4 is
accepted as the reviewed rich-library baseline and roadmap step 0.4.20 is
complete. After the ready-for-review release pull request is merged, the
annotated `v0.4.0` tag and non-draft GitHub Release must be created only from
the resulting protected `main` commit.
