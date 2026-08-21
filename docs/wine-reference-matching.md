# Wine-reference matching and review

Roadmap step 0.4.4 connects household wines to the shared reference hierarchy
without changing the wine descriptions that users imported or edited. Matching
uses the active, attributed LWIN7 snapshot from step 0.4.3 and remains online,
server-side work.

## Conservative candidate contract

Opening a wine detail requests up to five candidates from the active LWIN
snapshot. Candidate generation normalizes accents and punctuation and keeps
separate evidence for producer, wine/cuvee, appellation, area, colour, and known
vintage range.

- Producer and product-name evidence must both meet minimum thresholds.
- Clear appellation conflicts with weak product evidence are excluded.
- Colour conflicts, known vintage-range conflicts, a remembered-producer
  conflict, and a close runner-up remain visible blockers.
- `strong` and `possible` are sorting aids. The displayed score is not a factual
  probability and never authorizes an automatic link.
- Every link in 0.4.4 requires an explicit household-owner confirmation.

The preserved candidate snapshot, component scores, blockers, source wine
snapshot, and source fingerprint make each review explainable. Refreshing a
candidate set never changes `public.wines`. A versioned match-run record also
caches a completed zero-result search, so reopening an unmatched wine does not
rescan the complete dictionary until the source snapshot changes or the user
explicitly refreshes.

## Decisions and rejection memory

A confirmation or rejection is stored against the household wine, its current
source fingerprint, and the LWIN7 candidate. Rejected candidates move out of
the active suggestion list but remain available under **Review rejected
suggestions**. Refreshing the reference search does not propose them again as
new matches.

The confirmation UI can optionally remember a producer shorthand for the
current household—for example, that `Boillot` means `Louis Boillot`. This
preference improves later candidates for the same household. It is never added
to the global alias table and therefore cannot affect another household.

## Promotion into the shared library

Only a confirmed LWIN row is promoted from the source cache:

1. attach or reuse its LWIN7 product identity;
2. retain CellarManager UUIDs as permanent identities;
3. create a vintage release and single-bottle package when the household wine
   has a vintage, or link a generic NV wine at product level;
4. record durable LWIN11 and LWIN16 demands for the new release/package;
5. link the household wine to the most specific promoted identity.

The household producer, cuvee, vintage, colour, appellation, area, and format
remain unchanged. Editing any of those matching inputs later clears the shared
link and requires review again; the prior evidence is retained under its old
fingerprint.

## Security and offline behavior

Match-run, candidate, decision, and producer-preference tables have RLS enabled,
are not browser-readable, and are excluded from PowerSync. Authenticated members
may request their household review projection; only household owners can
confirm or reject matches. Security-definer RPCs enforce both boundaries.

Matching is unavailable offline and when the server has no active LWIN
snapshot. In both cases inventory and household wine data remain usable and
unchanged.

## Validation

    npm run supabase -- test db
    npm run web:ci

Database regression cases cover ambiguous producers, close runners-up,
appellation guards, rejection memory, remembered household producers, confirmed
promotion, generic NV identity, stale-link invalidation, role enforcement, and
cross-household isolation. Web tests cover response validation, RPC parameters,
decision safety, and human-readable blocker labels.
