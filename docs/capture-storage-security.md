# Capture image and storage security model

Roadmap step 0.6.5 defines the security and lifecycle constraints that must be
implemented before camera upload. It extends the candidate/review architecture
in [`capture-assisted-entry.md`](capture-assisted-entry.md) and the
service-managed enrichment boundary in
[`enrichment-publishing-and-jobs.md`](enrichment-publishing-and-jobs.md).
This is a design decision only: it creates no Storage bucket, table, migration,
provider integration, or upload endpoint.

## Data classification and threat model

A label image is user-provided, untrusted binary data tied to a household
workflow. It may contain more than the label (backgrounds, faces, location
metadata, device identifiers) and may be malformed or intentionally crafted to
attack image decoders. Treat both source bytes and all machine-extracted fields
as private, short-lived input—not cellar facts or globally reusable evidence.

The design must protect against:

- a Member, unrelated account, former member, or another household reading,
  uploading, processing, or deleting the wrong asset;
- object-key guessing, path tampering, public-link leakage, accidental browser
  caching, and a service credential reaching the client;
- oversized files, MIME spoofing, decompression bombs, malformed images,
  metadata leakage, and expensive repeated uploads;
- stale uploads, abandoned reviews, failed workers, or deleted database
  metadata leaving the underlying object behind;
- a recognizer retaining or training on the image outside CellarManager's
  approved purpose.

## Storage and authorization decision

- Use a dedicated **private** Supabase Storage bucket for capture assets. A
  public bucket is prohibited. Bucket-level restrictions and object-level RLS
  are both required; omitted or unknown policies fail closed.
- The active household is the authorization boundary, but each capture asset is
  readable only by the authenticated Owner who initiated that capture and the
  narrowly authorized processing service. A different Owner is not implicitly
  given the original image; Member access is always denied. Cross-owner review
  would require a later explicit sharing feature.
- Every create, read, process, or delete action validates current Owner
  membership from PostgreSQL. A cached role, path segment, client-selected
  household, or client-supplied owner ID is never sufficient. Membership
  demotion or revocation blocks the next operation even if the local app is
  stale.
- Create an online capture-session record through a narrow authenticated
  server operation before upload. It binds the random object key to the
  household, initiating account, lifecycle state, expiry, and allowed assets.
  Storage policies verify the exact object against that session, not merely a
  folder prefix supplied by the browser.
- Use opaque UUID object keys with no producer, wine, household name, email,
  original filename, or other descriptive content. Do not grant bucket
  enumeration. Permit only the required insert, authenticated object read, and
  delete operations; deny update/upsert and all other Storage actions.
- The browser uses its normal authenticated session and narrowly scoped RLS.
  It never receives a service/secret key. Workers may use a server-only
  privileged key because it bypasses Storage RLS, but each worker operation
  must independently validate the capture/session state and exact object key.
  Do not mint signed URLs for the browser or send them to an image provider;
  preview uses an authenticated download and a short-lived in-memory Blob URL.
- Capture sessions, object references, and OCR drafts are server-only data,
  outside PowerSync and the inventory journal. Do not cache image responses in
  the service worker, browser Cache API, localStorage, or IndexedDB.

An object key is an identifier, never a permission. RLS and current membership
checks must enforce every access. In particular, Supabase Storage's service
key bypasses RLS; it is not acceptable to rely on RLS for a privileged worker
request that skips RLS.

## Input and resource limits

Initial product limits are deliberately bounded:

- at most two images per capture (typically front and back label);
- at most 8 MiB per uploaded image, enforced by the bucket and checked before
  and after upload;
- at most ten unexpired capture sessions per initiating account, with limits
  checked server-side and safely under concurrent requests; initially, limit
  an account to ten new sessions and twenty uploaded images per rolling hour;
- reserve a per-account pending-media budget atomically before accepting an
  upload. With these limits, the worst-case overlap is 260 MiB per account
  (two 8 MiB originals plus two 5 MiB derivatives across ten sessions);
- allow only validated JPEG and PNG initially. HEIC/HEIF may be added only
  after a maintained decoder is selected and its behavior is tested on iOS;
  SVG, GIF/animated images, PDF, video, and arbitrary files are rejected;
- verify the byte signature and successfully decode the file—do not trust the
  filename or client-supplied MIME type. Reject mismatch, malformed input,
  excessive decoded dimensions (over 30 megapixels), and decompression-bomb
  behavior before recognition;
- enforce the same byte/dimension limits in the trusted service. UI checks are
  usability only and never security enforcement.

Use a fresh, non-overwritable key per asset; never use `upsert` to replace an
image in place. Files above Supabase's 6 MB standard-upload recommendation must
use a bounded resumable flow or be rejected with a helpful message. Configure a
bucket-specific maximum at or below the project's global Storage limit; never
raise a project-wide limit solely for capture images. Also enforce a
deployment-wide pending-media budget below the available plan quota; if capacity
cannot be reserved atomically, reject the upload with a retryable message.

## Sanitization and recognizer boundary

Before previewing or sending a file to any external recognizer, a trusted image
processor must:

1. decode only an allowlisted raster format and reject malformed/oversized
   input;
2. apply image orientation, remove EXIF/GPS, IPTC, XMP, and other metadata, and
   re-encode a normalized raster with a bounded long edge (2,400 px) and size
   (5 MiB);
3. assign a new opaque object key to the sanitized derivative and never
   overwrite the original; and
4. delete the original source object as soon as the normalized derivative is
   verified. If validation, decoding, or sanitization fails, close the capture
   and delete the source; the owner can upload a corrected image. A transient
   processor failure may retry the original at most three times within 24 hours
   in the trusted service only, after which the source is deleted. OCR retries
   use the sanitized derivative, never the original.

No OCR/image provider is approved by this decision. Before any external
transmission, a separate provider review must confirm allowed input use,
retention/deletion, model-training restrictions, output rights, and security
terms. The user must be told when a photo leaves CellarManager and explicitly
choose to proceed. Send only the sanitized image bytes and random request ID—
never household/account/wine IDs, email, EXIF, or unnecessary device metadata.
If the provider cannot meet the reviewed policy, do not send the image; preserve
manual entry as the fallback. Do not log source bytes, full image URLs,
credentials, or raw provider payloads.

Recognition output remains an untrusted candidate. It does not write household
wine facts, shared-reference aliases/identifiers, enrichment evidence,
recommendations, bottle quantities, storage locations, or inventory
operations. Those require the explicit review and existing owner workflows in
[`capture-assisted-entry.md`](capture-assisted-entry.md).

## Retention and deletion

- Keep the image in browser memory only until the authenticated upload finishes;
  do not persist a queued photo for automatic background upload.
- Keep a server-side capture and its sanitized preview only while review is
  pending, with a hard seven-day lifetime from capture creation. The expiry
  cannot be extended by repeated retries. Keep no more than the two images
  allowed by the per-capture limit.
- Delete the original immediately after successful sanitization. Delete the
  sanitized preview and raw extraction/OCR draft immediately when the owner
  confirms, chooses an existing wine, discards, or cancels the capture.
- On a failed parse, permit a bounded retry from the sanitized derivative until
  the seven-day deadline. Terminal errors or expiry delete both assets and
  unconfirmed extracted text.
- An explicit delete/cancel first closes access by changing the capture state,
  then deletes the bytes. If deletion fails transiently, keep access denied and
  retry through a server-side cleanup job. A daily cleanup job deletes expired
  sessions and orphaned objects; it must report failures and verify the
  Storage API result.
- Delete objects through the Supabase Storage API, not by deleting rows from
  `storage.objects` with SQL. Confirmed user-edited wine fields remain as normal
  household data; source photos, raw OCR text, and unconfirmed suggestions do
  not.
- Do not promise that API deletion synchronously erases provider backups. Before
  release, the user-facing notice must accurately describe the storage and
  approved processor retention/deletion terms.

There is no permanent image library in v0.6. Reusing or retaining label photos
after a capture review requires a new, explicit product decision and consent.

## 0.6.6 upload implementation boundary

The first upload slice is intentionally stricter than the design ceiling: the
bucket and server RPC both cap each object at 6 MB so the browser can use the
standard authenticated upload path. The database reserves 13 MiB per photo
(the design's 8 MiB original plus a future 5 MiB sanitized derivative), up to
260 MiB per initiating account and 512 MiB deployment-wide. These are reserved
capacity limits; they do not permit the client to raise the bucket limit.

The browser does not persist selected `File` objects offline, show a photo
preview, or expose original filenames. It can show the initiating Owner that a
private capture is pending and when its seven-day deadline expires. JPEG/PNG
MIME metadata and byte count are checked at upload, but actual file signatures,
decoding, dimensions, and metadata are not trusted until 0.6.7. Therefore this
step cannot preview, analyze, or transmit an image. Owner cancellation first
sets `deletion_pending`; the Storage API removes the exact reserved keys, and a
15-minute scheduled Worker retries failures and expired captures before the
database releases their storage reservation.

## Required acceptance for implementation

Later upload/provider steps must include negative tests for:

- Member, anonymous, unrelated, cross-household, former-member, demoted-owner,
  and non-initiating-owner access;
- guessed/altered object keys, listing, overwrite/upsert, stale capture state,
  expired captures, direct public URLs, and a client attempting service-key
  operations;
- file byte cap, concurrent quota cap, fake MIME/extension, malformed and
  oversized-dimension images, unsupported formats, and metadata removal;
- immediate terminal deletion, cancellation, expiry cleanup, orphan cleanup,
  failed Storage API deletion, and ensuring Storage objects are removed through
  the API rather than metadata-only SQL;
- proving no image goes to an unapproved provider, no external request includes
  household/account/wine identity, and worker logs never contain image bytes or
  secrets;
- offline/failed upload leaving no queued background upload and no change to
  wines, holdings, bottles, or inventory journals.

## Supabase implementation references

These official Supabase pages were checked on 2026-09-26. Private buckets use
RLS for downloads, while public buckets bypass retrieval access control;
Storage service keys bypass RLS entirely. Storage-object metadata must be
managed through the Storage API because deleting metadata directly does not
remove the underlying object. Supabase recommends standard upload for files
under 6 MB and resumable uploads above that size. The later implementation must
re-check these limits and behaviors against the project's active plan.

- [Storage buckets and private/public access](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Storage access control and service-key behavior](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Storage schema and object deletion](https://supabase.com/docs/guides/storage/schema/design)
- [Standard upload guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Resumable upload guidance](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
