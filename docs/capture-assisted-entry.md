# Capture-assisted wine entry architecture

Roadmap step 0.6.4 defines how label photos, OCR, and package identifiers may
help an owner add or identify wine without creating a parallel wine catalogue
or weakening the shared enrichment and inventory boundaries. It is an
architecture decision only: it adds no capture UI, image storage, provider,
database schema, or inventory behavior. See
[`adr/005-capture-assisted-wine-entry.md`](adr/005-capture-assisted-wine-entry.md).

## End-to-end boundary

```text
manual entry ─┐
label photo ──┼─> normalized field candidates + evidence
barcode ──────┘                 │
                                v
                household/reference candidate matching
                                │
                                v
                   owner reviews and corrects
                       ┌────────┴─────────┐
                       v                  v
              select existing wine   confirm new wine
                       └────────┬─────────┘
                                v
                   existing owner-only ADD flow
```

The photo, OCR, and barcode paths are alternative or complementary ways to
prepare the same candidate. They do not create a second source of truth.
Manual entry remains available when the device is offline, a label cannot be
read, or an external service is unavailable.

## Candidate and evidence model

Recognition creates a draft candidate, not a `public.wines` row. The candidate
may contain proposed producer, cuvée, vintage, colour, appellation/region,
format, and external identifier values. A value is allowed to be unknown or
ambiguous; the system must not fill a field merely to make the form look
complete.

Each proposed value keeps its own provenance where available:

- input kind (manual, label image/OCR, or decoded barcode);
- the observed text or decoded value and the field it supports;
- a reference to the relevant source asset or label region while the review is
  active;
- recognition method/version and confidence, when machine-generated.

Confidence helps order or explain suggestions; it is not authority. Source
observations and the user's correction remain distinguishable. A photo or OCR
response is not copied into shared wine-reference data, a wine's permanent
facts, or enrichment evidence just because it was used during recognition.

## Matching and confirmation

1. Normalize spelling and units without discarding the original observation.
2. Compare against wines already in the active household first, to prevent
   creating a duplicate household wine.
3. Where appropriate, use the existing shared wine-reference matching flow to
   suggest producer, product, release, package, and external-identifier
   candidates. Ambiguous matches remain unresolved until the owner decides.
4. Let the owner review and edit proposed fields, choose an existing wine, or
   explicitly confirm a new household wine. Do not silently replace household
   values with a shared-reference value.
5. If the owner wants bottles, continue through the normal ADD operation and
   ask for quantity and destination storage explicitly. Recognition never
   infers bottle count, cellar, location, or stock movement from a label.

Creating or selecting a wine and adding bottles are separate decisions. The
existing inventory operation model remains authoritative for stock. A
recognized candidate must not directly write a holding, journal row, shared
reference identity, or drinking-window recommendation.

## Barcode-specific rules

A barcode yields an identifier candidate, not a guaranteed wine identity. The
decoded symbology, normalized value, and checksum result should be retained for
review. A GTIN identifies a trade item/package and can distinguish bottle
formats; it is not a CellarManager primary key or proof that a lookup result is
the exact vintage in hand. An approved reference lookup may return multiple
candidates. The owner resolves ambiguity, while an unknown code falls back to
label recognition or manual entry. Barcode lookup and scanning remain scheduled
for 0.6.15; this step defines their place in the architecture only.

## Service, authorization, and privacy boundaries

- Only Owners can create or edit shared household wine data or add stock. The
  initial capture flow follows the existing Owner permissions; member-submitted
  suggestions are out of scope.
- Image analysis is optional and asynchronous. It cannot block normal cellar
  use, manual entry, or offline inventory work.
- Provider adapters, credentials, and provider policy stay server-side.
  Cloudflare Workers AI is approved for the explicitly opt-in image
  transcription and separately triggered text-only field suggestions described
  in [ADR 007](adr/007-opt-in-cloudflare-label-ocr.md) and
  [ADR 008](adr/008-capture-label-field-review.md). Any additional provider or
  modality requires a separate source, licence, retention, rights, and cost
  review before use.
- Image and extraction data are private to the active household and purpose-
  limited. Access to the original asset is limited to its initiating Owner and
  the authorized processing service; other household members do not get image
  access by implication. They are not public, copied into PowerSync wine facts,
  or used to train a model. Storage, access, retention, deletion, upload limits,
  and EXIF handling are defined in
  [`capture-storage-security.md`](capture-storage-security.md) before upload is
  implemented.
- The browser never receives provider credentials. External requests omit
  household, account, wine, and inventory identifiers unless a later reviewed
  contract demonstrates a strict need; no such need is established here.
- The process may reuse the existing shared identity matching and enrichment
  services, but recognition itself cannot publish global aliases, LWIN/GTIN
  links, or enrichment evidence.

## Planned implementation order

| Step | Work enabled by this architecture |
|---|---|
| 0.6.5 | Decide image/storage threat model, access controls, retention/deletion, upload limits, metadata handling, and provider-data boundaries — complete; see [capture storage security](capture-storage-security.md) and [ADR 006](adr/006-capture-image-storage-security.md) |
| 0.6.6 | Owner-only mobile camera and photo upload to private temporary storage — complete; no recognition dependency |
| 0.6.7 | Safe orientation, resize, metadata removal, trusted re-encoding, and private preview — complete |
| 0.6.8 | Explicitly opt-in Cloudflare Workers AI transcription, private short-lived text draft, and photo deletion after the text is saved — complete |
| 0.6.9–0.6.11 | Structured field suggestions with OCR evidence, Owner correction, and conservative active-household matching — complete; see [ADR 008](adr/008-capture-label-field-review.md) |
| 0.6.11 UX follow-up | Plain-language label review with catalogue matches and editable details first; OCR transcript, evidence, and confidence remain available on demand — complete |
| 0.6.12 | Explicit wine selection/creation and normal ADD; capture review currently prefills the existing Add bottles form, which still requires its normal submit action |
| 0.6.15 | Barcode scan and approved identifier lookup, converging on the same candidate review |

This order deliberately establishes storage/privacy controls before upload and
provider review before sending images to the selected recognizer. The specific
Cloudflare Workers AI decision is recorded in [ADR 007](adr/007-opt-in-cloudflare-label-ocr.md).

Step 0.6.6 established the temporary, Owner-only photo panel in Add bottles.
Step 0.6.7 prepares JPEG/PNG images on-device before any upload: it checks the
signature and pixel dimensions, applies EXIF orientation, composites
transparency on white, resizes to a maximum 2,400 px long edge, and re-encodes
to JPEG without carrying metadata. A Worker independently checks the prepared
JPEG's structure, dimensions, size, and absence of metadata markers, copies the
validated bytes to a new opaque key, and deletes the uploaded object through the
Storage API before publishing a preview key. It avoids a second full pixel
decode/re-encode to stay within Workers Free CPU limits. Interrupted processing
can be retried after its five-minute lease expires. Owners may preview or delete
the sanitized photo; other household members cannot read it. Step 0.6.8 sends
only the sanitized JPEG derivative to Cloudflare Workers AI after the Owner
has acknowledged the transfer once on this device and explicitly selected
photos of one bottle for reading. The Worker retrieves the image through the existing
owner-authorized capture boundary, sends no household or wine identifiers, and
uses no automatic retries. Cloudflare's documented data-use policy says it
does not use Workers AI customer content to train models or improve services.
Once the recognized text is saved to the private, short-lived capture draft,
the sanitized photo is deleted through the Storage API. If recognition fails,
the photo remains private and can be retried or deleted; unread photos and
recognized text expire within 24 hours. OCR produces text only: it does not map
wine fields, create a wine, add stock, or change inventory.

Steps 0.6.9–0.6.11 add text-only inference after a successful reading when
the exact OCR text does not identify a conservative active-household catalogue
match. The Owner may request it manually when a proposed match is wrong.
Cloudflare Workers AI classifies saved lines into tentative
producer, cuvée, appellation, area, color, format, and vintage fields. Each
suggestion includes quoted OCR evidence and qualitative confidence; unsupported
values are discarded or left unknown. This is not deterministic string
parsing: the model proposes the roles, and the Owner can edit them. At most one
private suggestion is kept per capture for the same 24-hour lifetime. The
interface first compares recognized text against the active household's local
catalogue, then compares reviewed producer/cuvée if inference was needed.
It excludes explicit identity conflicts and presents up
to three possibilities without choosing one. An explicit action copies either
the reviewed fields or a chosen catalogue wine into the existing Add bottles
form. It does not create a wine or bottle; the Owner still reviews and submits
through the normal inventory flow. See
[ADR 008](adr/008-capture-label-field-review.md).

The 0.6.11 UX follow-up separates photo and manual entry, uses a one-time
device/account photo acknowledgement, and leads with a plain-language review of possible
catalogue matches and editable wine details. The exact OCR transcript, field
evidence, confidence, and photo-handling explanation remain accessible in
expandable sections instead of dominating the main path. Selecting a photo
starts one reading sequence without extra confirmation steps; the Owner still
chooses whether to prefill the normal
Add bottles form; nothing is written to inventory before its normal submit.

## Acceptance for 0.6.4

- The architecture keeps recognition, shared identity, household wine facts,
  enrichment recommendations, and physical stock as separate authorities.
- OCR and barcode candidates converge on the same normalized review model.
- Ambiguous and unsupported inputs retain an honest manual fallback.
- No user image, provider result, database migration, UI behavior, or stock
  mutation is introduced by this step.
- The next implementation step can define and test storage controls without
  changing the candidate, review, or inventory boundary.
