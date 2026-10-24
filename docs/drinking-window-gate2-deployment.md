# Gate 2: authorized inert database deployment (24 October 2026)

This records the **live** database operation separately from the earlier
[private-clone rehearsal](drinking-window-gate0-audit.md). It does not approve
the draft reference, link a household wine, opt in a household, or release
shared drinking-window advice.

## Authorization and target

- After merging PR #207, the cellar owner explicitly said, “And you can apply
  the migrations.” This authorizes the **19 named pending migrations** in the
  [living release plan](drinking-window-release-plan.md) on the linked
  `cellarmanager-v02-dev` project (`sxdqcvnjtayfxinyospb`), not a reference
  publication or broader data repair.
- The active Cloudflare Worker version was
  `6b89c961-66c2-43c5-a806-98fb7d589e13` at 100%. Its successful GitHub
  build check maps it to merged commit
  `c2900d0ca845a60ebcb47c8937d206b6b702d517` (PR #207). The merged
  commit's database, web, dependency, and CI checks also completed
  successfully.
- Supabase's
  [incident record](https://status.supabase.com/incidents/01M5J8ZQ04EZXAYF10Q75MGC1T)
  reported an ongoing **Management API** incident. Linked ledger reads, both
  backup operations, the SQL Editor preflight, dry-run, and subsequent
  migration command all responded successfully. The incident did not show a
  Postgres failure in these checks; it remains a reason to watch for transient
  CLI errors.

## Just-in-time protection and preflight

- A new protected local schema/data export of `public`, `private`, `auth`,
  `storage`, and `capture_guard` was created immediately before deployment.
  The directory was mode `0700` and both dump files mode `0600`. The data dump
  warned about circular foreign keys; restoring it into a disposable local
  database succeeded with triggers disabled **only for that clone's restore
  session**. The clone was deleted after validation. The export is retained
  temporarily outside Git for recovery until the owner walkthrough; it is
  sensitive and is not a durable managed backup.
- The fresh restore and **live, aggregate-only SQL Editor preflight** both
  showed 788 wines, 4 households, 6 auth users, and 0 reference versions.
  The expected Beaujolais region, Morgon appellation, Burgaud producer, and
  Barraud producer each had exactly one row. Six other expected producer
  names had zero exact normalized matches. These match the Gate 0 rehearsal;
  no conflicting seed identity appeared.
- `supabase db push --dry-run --skip-vault` listed **exactly** the 19 files
  from `20261016120000_shared_producer_catalogue_seed.sql` through
  `20261023200000_choice_aware_shadow_review.sql`, with no seed or role file.
  `--skip-vault` deliberately excluded unrelated Vault updates.

## Execution and smoke results

- The authorized `supabase db push --skip-vault --yes` completed with exit
  code 0 and listed all 19 migrations as applied. A fresh linked ledger read
  showed **0 pending migrations**, latest remote and local migration both
  `20261023200000`.
- The post-migration live read showed **788 wines, 4 households, 6 users,
  1 draft reference, 0 active references, 0 publications, 0 enabled runtime
  switches, and 0 enabled household rollouts**. The app homepage returned
  HTTP 200 and its public health endpoint returned `ready` with Supabase
  configured.
- Database privilege checks showed the owner identity and ageing-choice
  write functions unavailable to `anon` and reachable by `authenticated`
  (their internal owner checks still apply). The maturity read functions
  remained reachable by `authenticated`, not `anon`. Shadow comparison and
  publication functions were not executable by either ordinary role.

No owner-confirmed **live** canonical pilot link was made. The draft remains
unpublished and no household opted in, so the new shared window is not yet
visible. These checks show an inert deployment, **not** a verified unchanged
advice sample or completed owner UI walkthrough. Gate 2 remains **In
progress** until that acceptance evidence is recorded.

## Recovery and remaining work

Keep the emergency switch off and do not approve/publish the draft if a live
wine card or access check is unexpected. The protected export can support a
deliberate operator recovery, but restoring it over a subsequently active
database could erase later user changes; it is **not** an automatic rollback.
Diagnose a failed future migration against the ledger before retrying, and
never repair a conflict by silently relinking a household wine.

Next: have the cellar owner inspect the signed-in wine card and three-date
editor, explicitly link the confirmed pilot through identity review, compare
one manual, one matched, and one unmatched wine, and check mobile/ageing-choice
behavior. Record an unchanged existing-advice sample and the actual comparison
before accepting Gates 1–2 or considering any Gate 3 publication.
