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
- Provider adapters, credentials, and provider policy stay server-side. No
  production OCR or image-recognition provider is approved by this decision.
  A provider must pass the existing source, licence, retention, and rights
  review before receiving a user's image or supplying persisted claims.
- Image and extraction data are private to the active household and purpose-
  limited. They are not public, copied into PowerSync wine facts, or used to
  train a model. Exact storage, access, retention, deletion, upload limits, and
  EXIF handling are decided in 0.6.5 before upload is implemented.
- The browser never receives provider credentials. External requests omit
  household, account, wine, and inventory identifiers unless a later reviewed
  contract demonstrates a strict need; no such need is established here.
- The process may reuse the existing shared identity matching and enrichment
  services, but recognition itself cannot publish global aliases, LWIN/GTIN
  links, or enrichment evidence.

## Planned implementation order

| Step | Work enabled by this architecture |
|---|---|
| 0.6.5 | Decide image/storage threat model, access controls, retention/deletion, upload limits, metadata handling, and provider-data boundaries |
| 0.6.6 | Owner-facing mobile camera and photo selection; no recognition dependency |
| 0.6.7 | Safe orientation, crop/resize, and image preprocessing |
| 0.6.8–0.6.9 | OCR and structured field extraction through a reviewed adapter |
| 0.6.10–0.6.12 | Human correction, conservative existing-wine matching, explicit wine selection/creation, and normal ADD |
| 0.6.15 | Barcode scan and approved identifier lookup, converging on the same candidate review |

This order deliberately establishes storage/privacy controls before upload and
provider rights before sending images to any external recognizer.

## Acceptance for 0.6.4

- The architecture keeps recognition, shared identity, household wine facts,
  enrichment recommendations, and physical stock as separate authorities.
- OCR and barcode candidates converge on the same normalized review model.
- Ambiguous and unsupported inputs retain an honest manual fallback.
- No user image, provider result, database migration, UI behavior, or stock
  mutation is introduced by this step.
- The next implementation step can define and test storage controls without
  changing the candidate, review, or inventory boundary.
