# Bottle barcode lookup (0.6.15)

Inventory can scan a printed EAN-13 or UPC-A code or accept barcode digits. Camera
decoding runs in the browser; the app validates the check digit and normalizes
8-, 12-, 13-, and 14-digit GTINs to a 14-digit comparison key. No photo is
uploaded. To avoid accepting a short, valid-looking fragment of a bottle's
EAN-13, the camera scanner accepts EAN-13 and UPC-A only and asks the user to
compare the decoded digits with the bottle before continuing. EAN-8 and
GTIN-14 can still be entered manually, as can any code when camera access
fails.

An Owner may explicitly associate that code with a wine already in the active
household catalogue. Members may read links, but cannot create or delete them.
Several wines may share a code: a retail package code does not prove vintage,
and the same packaging can recur across years. Results are never auto-selected.
The user can open a linked wine card or explicitly choose it for the existing
ADD form. Scanning and linking never change stock. The normal ADD confirmation
still requires quantity and location.

A first scan does not automatically identify a wine that has not been linked in
this household. Search the active catalogue to establish that link. If the wine
is not there yet, add it by label photo or manual entry first. Open Food Facts
may have no record for a valid bottle barcode; that is distinct from the
service being unreachable.

An optional **Search online** action sends only the code (not a photo,
wine, household, or account identifier) through the Worker to the [Open Food
Facts product API](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/).
It is available directly after entering the digits; the user does not have to
run a separate catalogue search first.
The result is shown with a source link and remains transient. It is *not*
silently copied into a household wine or shared reference. Unknown codes,
provider errors, and offline use leave manual entry and label photos available.

The Worker verifies the CellarManager session, uses a fixed provider hostname,
rejects redirects and mismatched returned codes, bounds the response, and
identifies itself with a User-Agent. Requests are made only after the user
chooses the optional lookup. [Open Food Facts documents](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/)
free read access, rate limits, and its ODbL data licence; the product source
is credited beside the result. Provider images are neither fetched nor reused.

Validation: GTIN check digits and canonicalization, explicit local lookup,
optional external lookup, Owner-only linking, household isolation, ambiguous
code handling, and no automatic inventory mutation.
