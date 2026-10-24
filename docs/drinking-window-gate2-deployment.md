# Gate 2: authorized inert database deployment (24 October 2026)

This records the **live** database operation and 24 October signed-in checks
separately from the earlier
[private-clone rehearsal](drinking-window-gate0-audit.md). The later check
linked one owner-confirmed pilot identity; it did not approve the draft
reference, opt in a household, or release shared drinking-window advice.

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

## Signed-in pilot check and private comparison (24 October)

- The owner account for the `v0.1 import validation` household was signed in;
  sync showed up to date. The catalogue then held **802 wines** and 1,277
  bottles (the protected pre-migration export held 788 wines). No stock action
  was performed by this check.
- Three existing advice responses were compared, including their full core
  payloads, between the protected pre-migration restore and the live database.
  Mas de la Seranne *Antonin et Louis* 2018 (manual), Burgaud *James* 2008
  (manual), and Alvina Pernot *Les Caillerets* 2021 (model) were identical
  after excluding only additive source/reference metadata. This verifies the
  unchanged-advice sample for those wines, not every cellar wine.
- The signed-in owner UI confirmed **only** the previously owner-approved
  Burgaud *Morgon Côte du Py* 2022 canonical identity, release
  `d1738cd6-f055-2a55-ba83-3f770c3f39cb`. *Les Charmes* and *James* were
  deliberately left unlinked. No wine description, shared membership, stock,
  manual window, approval, publication, switch, or household rollout was edited.
- Linking triggered a fresh **existing-model** calculation for Côte du Py.
  The superseded projection on the card had been `2026 / 2029 / 2036`; after
  reloading the card, the current model is `2026 / 2031 / 2039`. The proposed
  **draft** reference is separately `2025 / 2028 / 2035`; it is **not** live
  advice. The app briefly displayed the old model dates immediately after the
  link; a client refresh-order fix is pending review. This is an identifiable
  recalculation on the deliberately linked wine, not evidence that the draft
  was activated. Because advice changed, Gate 2 is not accepted without owner
  review of this explanation and the live card.
- An owner-bound, private whole-cellar report was recorded against draft
  version `42ea0688-9f14-540b-d346-37decd458d1f`: report
  `cf06fe82-2530-422c-a252-ce52d2f37aed`, hash
  `99f6b975ea565f82ec8410c50c91781f4f8c20b1728f95196ee0e764254d9890`.
  Of 802 wines, **one** has changed proposed dates (Côte du Py 2022), two
  retain manual dates, five have identity conflicts, 84 lack a matching key,
  and 710 have no draft match. The report flags **four unresolved publication
  issues**: one row, one ageing group, and two memberships lack current
  approval. Neither the owner nor this check approved them.
- The signed-in owner screen rendered the private report and its counts, but
  the one changed wine was buried among unmatched rows. A review-screen
  sorting fix is pending so actionable proposals appear first. Mobile layout,
  edit/clear, local ageing choice, and emergency-off walkthroughs remain open.

The draft remains unpublished; no household has opted in. Gate 2 remains **In
progress**, and Gate 1 remains **In progress**. The private report is evidence
for review, not permission to publish. The exact disposable local restore
database used for the before/after comparison was deleted after verification;
the separate protected recovery export remains available outside Git.

## Recovery and remaining work

Keep the emergency switch off and do not approve/publish the draft if a live
wine card or access check is unexpected. The protected export can support a
deliberate operator recovery, but restoring it over a subsequently active
database could erase later user changes; it is **not** an automatic rollback.
Diagnose a failed future migration against the ledger before retrying, and
never repair a conflict by silently relinking a household wine.

Next: deploy and verify the small card-refresh and report-ordering fix; have
the owner inspect the Côte du Py before/after explanation and the now-visible
private comparison, plus the three-date editor, mobile layout, local ageing
choice, manual edit/clear, and emergency-off behavior. Review the four draft
issues on their merits before any Gate 3 approval or publication. Keep the
global switch and household opt-in off while Gates 1–2 are open.
