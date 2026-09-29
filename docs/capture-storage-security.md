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

Before previewing or sending a file to any external recognizer, the browser
must decode an allowlisted raster, apply image orientation, remove EXIF/GPS,
IPTC, XMP, and other metadata, and re-encode a bounded JPEG (2,400 px long edge,
5 MiB). The trusted Worker then independently checks JPEG structure, dimensions,
size, and metadata markers without decoding pixels a second time. It copies only
those exact validated bytes to a new opaque object key, verifies Storage's
accepted content type and size through the database completion check, and
deletes the upload. If validation or storage promotion fails, close the capture
and delete both objects. A capture whose Worker request is interrupted retains
a five-minute processing lease; after that, the owner can explicitly retry, and
the Worker first removes any partial derivative through the Storage API. OCR
retries use only the promoted JPEG, never an unvalidated original.

The 0.6.5 design approved no OCR/image provider. The later, scoped Cloudflare
Workers AI approval in [ADR 007](adr/007-opt-in-cloudflare-label-ocr.md) is the
only current exception. The Owner acknowledges the external transfer once per
account and device, then explicitly chooses each bottle's photo under the
photo-reading path. Send only sanitized image bytes and a fixed
transcription prompt—never household/account/wine IDs, email, object keys,
signed URLs, EXIF, or unnecessary device metadata. If the selected provider is
unavailable, preserve manual entry as the fallback. Do not log source bytes,
full image URLs, credentials, or raw provider payloads.

Recognition output remains an untrusted candidate. It does not write household
wine facts, shared-reference aliases/identifiers, enrichment evidence,
recommendations, bottle quantities, storage locations, or inventory
operations. Those require the explicit review and existing owner workflows in
[`capture-assisted-entry.md`](capture-assisted-entry.md).

## Retention and deletion

- Keep the image in browser memory only until the authenticated upload finishes;
  do not persist a queued photo for automatic background upload.
- Until extracted wine information is durably ingested into the capture draft,
  close access to images no later than 24 hours from capture creation. Repeated
  retries cannot extend that deadline. Keep no more than the two images allowed
  by the per-capture limit. Scheduled deletion runs every 15 minutes, but a
  failed deletion can leave inaccessible bytes until a later retry; do not
  promise a hard physical-deletion deadline.
- As soon as extracted wine information is durably ingested into the capture
  draft, request deletion of the source and normalized images immediately; do
  not make them available during the later owner-review period.
- On a failed parse, permit a bounded retry from the normalized derivative
  until the 24-hour deadline. Terminal errors or expiry close access to images
  and unconfirmed extracted text, then trigger cleanup.
- An explicit delete/cancel first closes access by changing the capture state,
  then deletes the bytes. If deletion fails transiently, keep access denied and
  retry through a server-side cleanup job. A 15-minute cleanup job deletes expired
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

The browser does not persist selected `File` objects offline, expose original
filenames, or queue a photo for background upload. In 0.6.6, it could show the
initiating Owner a private capture's status and expiry; the database and Worker
enforced the 24-hour access limit, owner scope, quotas, cancellation, and
Storage-API cleanup. Image signature checks, decoding, dimension limits,
metadata removal, and safe preview were added in 0.6.7.

## 0.6.7–0.6.9 image preprocessing implementation boundary

Before a capture session is reserved, the browser reads the selected JPEG/PNG,
checks its signature and dimensions (at most 24 megapixels), applies embedded
orientation, composites transparency against white, resizes to a maximum
2,400-pixel long edge, and re-encodes to a metadata-free JPEG no larger than
5 MiB. Only that generic-named prepared JPEG is uploaded; the original selected
file never leaves browser memory. This client step improves privacy and mobile
upload size. The server remains the trust boundary for object authorization,
structural and dimension limits, and metadata-marker rejection; it deliberately
does not repeat the expensive pixel decode/re-encode.

The Worker accepts only the exact claimed object keys for the initiating Owner,
checks JPEG structure and dimensions (at most 8 megapixels and 2,400 px on the
long edge), rejects EXIF/XMP/IPTC/ICC/comment markers and non-JFIF APP0 data,
and caps the already re-encoded image at 5 MiB. It copies those validated bytes
to a new opaque key and deletes the source through the Storage API. The database
only changes the session to `processed` when it sees the derivative's JPEG
content type and bounded size and confirms the source object is gone. This
avoids the second WASM pixel decode/re-encode, which exceeded the 10 ms CPU
budget on Workers Free. Processing claims carry a five-minute lease; a retry
after an interrupted Worker removes any partial derivative before reusing its
reserved key.
An authenticated download policy grants the initiating Owner access to the
processed derivative only; a narrowly scoped RPC provides its opaque key for
preview. The same-origin Worker rechecks that exact key against the Owner's
processed session and streams the JPEG with `Cache-Control: no-store`. The UI
uses an in-memory Blob URL and revokes it when the preview is hidden, the
account/household changes, or the panel unmounts. Member access, public URLs,
caches, PowerSync, OCR, and third-party image services remain out of scope. A
malformed or unprocessable image closes the capture and attempts
Storage-API deletion; any cleanup failure stays closed and is retried by the
15-minute cleanup Worker, including after the immutable 24-hour access expiry.

No hosted image service or new provider credential is introduced.

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
