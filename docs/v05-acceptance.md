# v0.5 shared-household acceptance

Status: **Release candidate; owner reviewed the preceding feature pull
requests and accepted the 0.5.14 release gate on 2026-09-25.** Step 0.5.14
contains no new user-facing feature to demonstrate.

This record closes the v0.5 feature sequence and identifies the checks that
must still run against the deployed release candidate before its annotated tag
is created.

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

## Production gates before tagging

After the merged release candidate is deployed:

- [ ] `npm run release:check -- --production https://cellarmanager.cellarcloud.workers.dev/`
  confirms the deployed Worker reports `v0.5.0` and required services are ready.
- [ ] Sign in as the Owner and a Member in separate sessions. Confirm the Owner
  can manage stock, imports, and cellar setup; the Member can browse but cannot
  perform those owner-only actions.
- [ ] Confirm account, member/device management, household selection, and
  primary navigation open without a persistent loading or authorization error.
- [ ] Confirm the production cellar remains present and unchanged.

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

Create the annotated `v0.5.0` tag and non-draft GitHub Release only from the
protected `main` commit after the production gates pass. If a production gate
fails, fix or explain that failure before tagging; do not repeat migrations or
modify real cellar data as a troubleshooting shortcut.
