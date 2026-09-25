# v0.5 shared-household acceptance

Status: **Released as v0.5.0 on 2026-09-25.** The owner reviewed the preceding
feature pull requests and accepted the 0.5.14 release gate; it contains no new
user-facing feature to demonstrate.

This record closes the v0.5 feature sequence and records the release checks.

## Safety boundary

- Existing households, memberships, invitations, wine records, holdings, and
  inventory history remain production data and are never reset or copied into
  acceptance fixtures.
- The final v0.5.13 production migration changes catalog-import functions and
  the import-receipt quantity constraint only. It does not rewrite cellar or
  bottle data. It was applied to the linked production database on 2026-09-25;
  the migration ledger and required function/permission shape were verified.
- Offline inventory remains local-first, but PostgreSQL is authoritative for
  acceptance, idempotency, and conflict resolution.
- Owners can manage inventory and household structure. Members can browse the
  cellar but cannot import, alter storage setup, or mutate stock.

## Automated gates

The following automated gates passed locally on 2026-09-25; GitHub CI must
reconfirm them on the release pull request:

- [x] repository policy and consistent `v0.5.0` release metadata;
- [x] web lint, 644 tests across 75 files, and production PWA build;
- [x] invitation, inventory, LWIN, enrichment, and historical-data test suites;
- [x] Supabase database tests (42 files, 2,039 assertions), including cross-role security and concurrent
  inventory/invitation acceptance;
- [x] production-dependency audit at the high-severity threshold (0 findings);
- [x] `git diff --check`.

The v0.5.13 import migration is already present in the linked production
migration ledger. This release does not require a data repair or cellar
re-import.

## Production acceptance before tagging

After the merged release was deployed on 2026-09-25:

- [x] `npm run release:check -- --production https://cellarmanager.cellarcloud.workers.dev/`
  confirmed the deployed Worker reports `v0.5.0` and required services are ready
  (Supabase, Workers AI, and Tavily).
- [x] Owner and Member permissions, account/member/device management, household
  selection, and primary navigation were accepted during the preceding feature
  pull-request reviews. The owner confirmed those reviews before this release;
  v0.5.14 adds no new UI or behavior.
- [x] The release deployment did not run a data migration, import, or cellar
  write. Existing cellar records remain authoritative and untouched.

The owner has reviewed the preceding feature PRs; this release gate introduces
no additional screen or interaction requiring another feature-validation pass.

## Concurrency boundary

The isolated database acceptance suite exercises simultaneous inventory
operations, replay, device revocation, membership authorization, and invitation
mutation races. Web tests cover interrupted uploads, rejected-operation
handling, and convergence of local projections. These automated suites passed
for the current release baseline.

The optional physical-device offline conflict scenario in
[`multi-device-inventory-acceptance.md`](multi-device-inventory-acceptance.md)
was **not manually repeated** for this release. Do not describe it as a hosted
PowerSync/browser test or claim that checklist passed. It is not a new 0.5.14
feature check; the server concurrency and web-boundary evidence above remain
the automated release evidence.

## Release conclusion

The annotated `v0.5.0` tag points to the protected `main` release commit, and
the non-draft GitHub Release is published. If a future production gate fails,
fix or explain that failure before publishing another release; do not repeat
migrations or modify real cellar data as a troubleshooting shortcut.
