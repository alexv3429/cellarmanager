# ADR 006: Capture image storage and security

- Status: Accepted
- Date: 2026-09-26
- Implemented: Storage and upload boundary in v0.6.6; safe image processing follows in v0.6.7

## Context

ADR 005 makes label images optional evidence for a reviewable candidate, but
defers the exact storage model. Images are untrusted binary input, can carry
device/location metadata, and may be sent to a third-party recognizer only
under an explicitly reviewed policy. Supabase Storage is governed by RLS, but
service credentials bypass those policies. Its object metadata must be
deleted through Storage APIs so the underlying stored object is removed too.

See [`../capture-storage-security.md`](../capture-storage-security.md) for the
threat model, thresholds, deletion workflow, and implementation acceptance.

## Decision

- Store image assets only in a dedicated private Storage bucket with fail-closed
  RLS tied to a live Owner and an exact unexpired capture record.
- Restrict access to the initiating Owner and the authorized processing
  service; Members and other accounts cannot access a pending capture image.
- Use opaque non-overwritable object keys. Deny listing, update/upsert, public
  access, and browser/client use of privileged credentials.
- Allow no more than two validated raster images per capture, 8 MiB per image,
  and ten unexpired captures per initiating account. Initially cap creation at
  ten captures and twenty uploaded images per rolling hour, and reserve an
  account media budget up to the 260 MiB worst-case overlap. Enforce a separate
  deployment-wide budget below the active Storage plan quota. Begin with JPEG
  and PNG; require maintained decoder support before adding HEIC/HEIF.
- Validate byte signatures and decoded dimensions server-side, strip metadata,
  re-encode a bounded sanitized image, and delete the original after successful
  normalization.
- Delete source and normalized images as soon as extracted wine information is
  durably ingested into the capture draft; expire unprocessed captures after
  24 hours with a server-side cleanup job. Delete raw extraction immediately
  on terminal review. A
  cancellation denies access first, then deletes through the Storage API.
- Do not retain a permanent cellar photo library or send an image to an
  external recognizer until the provider's security, rights, training, and
  retention terms are approved and the user consents.
- Keep assets and capture drafts outside PowerSync and inventory journals.

## Alternatives considered

- A public bucket or a long-lived signed URL would turn possession of a link
  into access to a label photo and weaken immediate authorization revocation.
- Storing images or base64 in wine rows/PowerSync would replicate private,
  large binary data to devices and mix temporary evidence with cellar facts.
- Relying only on browser MIME/size checks or a random object path would not
  protect the Storage API from a modified client.
- Keeping label photos permanently by default is unnecessary for candidate
  review and would expand retention, storage cost, and privacy exposure.
- Deleting Storage metadata with SQL can leave the underlying file inaccessible
  but still stored; lifecycle cleanup must use the Storage API.

## Consequences

- Upload requires a short-lived server capture record and narrow Storage RLS
  policies. Bucket-level constraints alone are insufficient.
- Processing adapters must be server-side and treat privileged Storage access
  as a separate security boundary because service credentials bypass RLS.
- The upload UI needs clear consent, progress/error states, manual fallback,
  and explicit cancellation; offline photos are not silently queued.
- The security model can be implemented independently of OCR provider choice.
  Any provider still needs its own rights/security review before use.

## Validation

Step 0.6.5 recorded the architecture. Step 0.6.6 adds the private bucket,
server-created upload slots, live Owner policies, bounded direct uploads,
temporary session listing/cancellation, and retryable scheduled cleanup. The
browser cannot list or download the image objects, no image is previewed or
sent to a recognizer, and no wine or stock data changes. The remaining
sanitization and image-byte validation gates still apply before preview or
recognition. See [`../capture-storage-security.md`](../capture-storage-security.md)
for the full negative-test matrix.
