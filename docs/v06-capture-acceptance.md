# v0.6 photo and barcode accuracy/privacy acceptance (0.6.17)

Status: **PR #154 automated checks passed; the Owner confirmed the remaining hosted-phone checks on the official v0.6.0 app on 2026-10-01.** This is a release gate, not a new recognition provider or an automatic wine-import feature. The Owner still chooses the wine and confirms each stock ADD. Production cellar data is never reset or used as a test fixture.

## What the tests prove

Deterministic tests check the app's decisions *given* an OCR transcript, model suggestion, decoded barcode, or provider response. They cannot measure Moondream's real-world reading accuracy, camera focus, lighting, or iOS browser behaviour. A mocked OCR success is not a successful live label reading. The two-label Worker test uses synthetic JPEG bytes to check request/privacy handling, not image recognition quality.

The historical Burgaud and Barraud reports are regression cases, not an accuracy score. Reproducing any of these failures in the current build blocks release:

| Case | Required behaviour | Automated evidence |
|---|---|---|
| Readable Burgaud label | Keep producer, Côte du Py, Morgon, and photographed 2011 distinct; do not create stock during reading | `workers/captureRecognition.test.mjs`; `apps/web/src/data/captureWineMatching.test.ts`; `apps/web/src/components/CapturePhotosPanel.review.test.tsx` |
| Barraud “En France” with OCR typo in Pouilly-Fuissé | Match producer + cuvée to a compatible catalogue wine; correct spelling and inherit colour/region only when matching vintages agree; keep the *photographed* year | `apps/web/src/data/captureWineMatching.test.ts`; `apps/web/src/components/CapturePhotosPanel.review.test.tsx` |
| Ambiguous or conflicting facts | Leave colour unresolved when saved vintages disagree; reject clear colour, format, appellation, or year conflicts; never infer colour from appellation alone | `apps/web/src/data/captureWineMatching.test.ts`; `workers/captureWineSuggestion.test.mjs` |
| One or two photos | Camera capture waits after the first photo so the Owner can take the back label before reading; library selection can still send one or two photos together. Both photos are labels of one bottle, not two inventory entries; save transcripts in order and send no cellar identity to the image model | `apps/web/src/components/CapturePhotosPanel.review.test.tsx`; `workers/captureRecognition.test.mjs` |
| Printed bottle volume | Use an explicit ml/cl/l amount from either label (including decimal-comma values); ignore a nutrition-only `100 ml` reference and leave conflicting volumes unresolved | `workers/captureWineSuggestion.test.mjs` |
| Unreadable label or unavailable AI | Show a recoverable error, retain the private capture for explicit retry/deletion, and allow manual entry; do not silently add a wine | `workers/captureRecognition.test.mjs`; `apps/web/src/data/capturePhotos.test.ts` |
| Printed barcode | Require valid checksum and a whole EAN-13/UPC-A camera result; reject a valid-looking EAN-8 fragment of the bottle code | `apps/web/src/data/wineBarcodes.test.ts`; `apps/web/src/components/WineBarcodeScanner.test.tsx` |
| Barcode identity and provider | Unknown stays unknown, a shared code leaves vintages explicit, external lookup is a separate action, and mismatched provider codes are rejected | `apps/web/src/components/WineBarcodePanel.test.tsx`; `workers/barcodeLookup.test.mjs`; `supabase/tests/database/wine_barcodes.test.sql` |

## Privacy and authority gates

| Gate | Required behaviour | Automated evidence |
|---|---|---|
| Consent and offline use | Photo picking requires this account's device acknowledgement and an online connection; barcode online lookup is optional | `apps/web/src/components/CapturePhotosPanel.review.test.tsx`; `apps/web/src/components/CapturePhotosPanel.test.tsx`; `apps/web/src/components/WineBarcodePanel.test.tsx` |
| Private upload and preview | Only the initiating Owner can use an exact temporary capture; an Owner in another household or a Member cannot; preview responses are no-store | `supabase/tests/database/capture_photo_storage.test.sql`; `supabase/tests/database/capture_photo_preprocessing.test.sql`; `workers/capturePreprocessing.test.mjs` |
| Image minimization | Prepare a bounded metadata-free JPEG, validate it before private promotion, and use opaque object keys rather than filenames | `apps/web/src/data/capturePhotoImage.test.ts`; `workers/captureImageValidate.test.mjs`; `apps/web/src/data/capturePhotos.test.ts` |
| External transfer | The image model receives sanitized JPEG bytes and a fixed question, not session/household/user/wine/stock IDs; the barcode provider receives only a checked GTIN after authentication and explicit lookup | `workers/captureRecognition.test.mjs`; `workers/barcodeLookup.test.mjs` |
| Retention and failure | OCR text stays private; image deletion completes or is honestly reported pending; AI failure triggers no automatic retry; expired captures become cleanup candidates | `workers/captureRecognition.test.mjs`; `workers/captureCleanup.test.mjs`; `supabase/tests/database/capture_photo_ocr.test.sql`; `supabase/tests/database/capture_wine_suggestions.test.sql` |
| No silent stock writes | Photo review, barcode scan, online hint, and barcode link are not ADD operations; ADD still requires explicit wine, quantity, location, and confirmation | `apps/web/src/components/CapturePhotosPanel.review.test.tsx`; `apps/web/src/components/WineBarcodePanel.test.tsx`; `supabase/tests/database/wine_barcodes.test.sql`; inventory acceptance suite |

## Repeatable automated gate

Run `npm run ci` and `npm run audit`. GitHub CI also runs `npm run supabase -- test db`. Require green web, Worker, database, audit, and final CI-gate jobs for this PR's commit. Review test changes before treating the gate as passed; green tests do not establish a live OCR accuracy rate. Service credentials, user photos, private OCR text, and cellar exports must not enter the test repository or CI logs.

Local run on 2026-10-01: `npm run ci` passed (759 web tests across 94 files, production build, and the Worker and other workspace suites); `npm run audit` found zero production high-severity vulnerabilities; `git diff --check` passed. PR #154 then passed the web, Worker build, isolated Supabase database, dependency audit, and final CI-gate checks. These checks establish the tested code path, not live recognition accuracy.

## Hosted phone acceptance

Use an existing test account/cellar if available; **do not create another test cellar or submit a stock ADD merely for this gate**. On the deployed build:

1. With an Owner account, take or choose one readable label photo. Check the transcript, editable fields, provenance, and any catalogue match. Stop before final ADD confirmation if no stock change is intended.
2. If the wine exists at another vintage, check stable producer, cuvée, appellation, region, and unambiguous colour suggestions while the pictured year remains the photographed year. Unknown colour stays unknown; it is not inferred from appellation.
3. If two images are available, take the front photo with the camera, then the back photo before reading; also check the library's two-photo selection if available. Confirm that both transcripts are usable, a printed volume on the back label fills the format field, and the UI still proposes one wine and one subsequent ADD, never two bottles. The current OCR question says “front wine label” for each image, so back-label reading quality in particular needs a live check before release.
4. Scan a printed EAN-13/UPC-A and compare every digit with the bottle before confirming the code. Check the unknown-code, optional online-lookup, and manual/photo fallback without linking a wine or changing stock. Do not infer vintage from a provider result.
5. Check that a failed/unreadable capture can be deleted and disappears after refresh. If deletion is pending, follow it through cleanup rather than claiming it has finished.

Record the build/PR, device/browser when known, observed result for each applicable step, and any failure. A missing second label or barcode is **not exercised**, not passed. Database role isolation and expiry use isolated automated tests and do not require a second real cellar.

The prior hosted two-label phone check exposed the immediate first-camera-photo upload and a missed printed volume despite legible OCR. The first PR #154 preview then exposed a database rule that rejected the newly extracted numeric format; the same readable text and photos could not be saved as a wine suggestion. A corrective migration and SQL regression test were added, the single migration was applied to the linked development project, and the Owner reported the two-photo suggestion working on the updated preview on 2026-10-01. No stock ADD was required.

After PR #155 was merged, the Owner tested the official v0.6.0 app and reported the three remaining checks as working on 2026-10-01: camera-sequenced front/back capture, printed-barcode lookup, and deletion of a temporary capture. This is an Owner-reported hosted-device sign-off, not an independent measurement of recognition accuracy. The device/browser version, exact barcode, and detailed observations were not recorded. The release commit's GitHub CI run `36910347823` passed all jobs, including the final CI Gate; the read-only production readiness check also passed and reported `v0.6.0`.

The optional v0.1 enrichment import from 0.6.16 has **not** been applied to a household. It is unrelated to barcode recognition and is not evidence for this acceptance gate.
