# Household wine identity review

In **Catalogue → Review shared wine identities**, a household Owner can work
through the wines with no shared reference link. Search the local list by
producer, cuvée, or appellation; choose a wine; then search the shared library
by producer or cuvée. The result must be the same vintage as the local wine.
For a wine with no vintage, the result is a product, not an invented release.
Inspect the full producer, cuvée, and vintage before confirming. An existing
link can be shown and removed by including already-linked wines.

Confirming or removing a link changes only that household wine's reference
pointer and appends a private audit decision. It never changes the wine's
producer/cuvée text, stock, other households, or the shared reference library.
Concurrent edits and stale source details cause a refresh error rather than an
overwrite. The older Liv-ex suggestions on the wine card remain a separate
review path; replacing one of those confirmations records its rejection.

If the search has no result, **Request a shared wine entry** stores one private,
idempotent request for the wine's current source fingerprint. It does not make
a shared wine available immediately. Curators still need a reviewed identity
and evidence before publication; this PR does not add curator processing UI.

## Acceptance check

1. In an Owner account, open Catalogue and expand the review panel. Confirm
   that unlinked wines are listed, and that a long list can be filtered.
2. Choose a wine whose exact release is already in the shared library. Search
   by producer or cuvée. Verify the year and confirm. The list should mark
   the wine linked without renaming it or changing bottles.
3. Include linked wines, select the same wine, and remove the local link. The
   wine should reappear among unlinked wines.
4. Choose a wine with no matching shared release, search, then request an
   entry. Confirm the request acknowledgement does not claim publication.
5. A Member or signed-out session must not be able to search, confirm, remove,
   or request through these RPCs. Offline review remains unavailable.

Automated checks cover role isolation, wrong-vintage rejection, stale forms,
audit records, request idempotency, and preservation of local/global data.
