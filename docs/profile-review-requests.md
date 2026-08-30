# Published profile review requests

Step 0.4.17 lets a household member challenge one exact reviewed profile used
by current guidance. The report is visible from the relevant contribution in
the wine's **Why this estimate?** explanation, and its progress remains visible
in the Catalog profile-review inbox.

Older current projections may explain themselves with prose rather than a
hierarchical contribution list. For those projections, the same panel lists
the exact immutable profile links recorded with the calculation. Reports are
therefore attached to canonical profiles, never inferred from explanation text.

This workflow does not edit or withdraw published knowledge. Trusted profile
validation, before/after comparison, supersession, and immutable publication
belong to step 0.4.18.

## User flow

1. Open a wine with maturity guidance and expand **Why this estimate?**.
2. Choose **Report an issue** beside the place, vintage, producer, cuvee, or
   release profile that needs review.
3. Select a reason, explain the problem, and optionally provide an HTTPS source.
4. Follow the shared-case status and the reporter's private messages in the
   Catalog profile-review inbox.
5. Add later observations or evidence while the case is open.
6. Read the trusted review outcome when the case is resolved or dismissed.

The active recommendation remains unchanged throughout this flow. A later
correction requires a new reviewed knowledge version.

## Stable shared case, private reporter thread

Published knowledge versions clone their profile rows, so a version-specific
profile UUID cannot deduplicate reports safely. The database derives a stable
subject key from the typed canonical identity instead:

- place or place adjustment: canonical place and wine color;
- vintage: canonical place, year, and wine color;
- producer era: canonical producer, era bounds, and wine color;
- producer-vintage interaction: producer era, wine color, and sorted condition
  tags;
- cuvee: canonical product, optional place, and wine color;
- release: canonical release and wine color.

Only one `open` or `reviewing` case may exist for a stable subject. Reports
from another account or household join that case. Each reporter nevertheless
has a separate subscription and private message thread. The browser RPC returns
only the current user's comments and source links; it never exposes another
reporter's cellar, wine, account, or messages.

## Security and lifecycle

The three review tables have RLS enabled and no direct browser table
privileges. Authenticated members use security-definer RPCs that verify:

- membership of the requested household;
- that the wine belongs to that household;
- that the reported profile contributes to a current projection for that wine;
- an allowed review category and a bounded non-empty comment;
- an optional valid HTTPS evidence link.

The browser may open a report, add to its own thread, read its own inbox, and
mark notifications as seen. Only the trusted service role may move a case to
`reviewing`, `resolved`, or `dismissed`. Status transitions notify every private
subscriber, and closed cases are immutable. A later observation starts a new
case, preserving the earlier outcome as history.

## Validation

Database acceptance covers two separate seeded accounts relying on the same
active profile. It proves one shared case, two private subscriptions, strict
message isolation, visible notifications and outcome, rejection of arbitrary
profile IDs, unchanged published content, legacy prose-projection coverage, and
a separate later review cycle.
