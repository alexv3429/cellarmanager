# ADR 007: opt-in Cloudflare label OCR

Status: Accepted — 2026-09-28; consent-flow amendment — 2026-09-29

## Context

The first on-device Tesseract OCR path produced unusable transcriptions on a
real wine label. A one-image trial with Cloudflare Workers AI's hosted
Moondream 3.1 model correctly read the producer, cuvée, appellation, and
vintage. Cloudflare Vision OCR also read those fields, but returned additional
noise from tiny legal print. The Cloudflare model is selected for a small,
opt-in transcription step; it does not identify or create a wine.

## Decision

- Use the existing server-side Workers AI binding and model
  `@cf/moondream/moondream3.1-9B-A2B`. No API key or new provider credential is
  added to the browser or Worker secrets.
- Before the first photo submission on a device, show the Owner a one-time
  acknowledgement explaining the external AI transfer, temporary retention,
  review boundary, and Cloudflare's stated no-training/no-service-improvement
  policy. Remember that choice locally for this account and device, not across
  other accounts or devices. After acknowledgement, choosing a photo under the
  clearly labelled photo-reading path is the explicit action that authorizes
  preparation, upload, and one recognition attempt. The privacy details remain
  available. No photo is sent merely by opening the panel.
- The Worker first verifies the live Owner's exact processed capture through
  the authenticated Supabase RPC, then reads only the sanitized JPEG derivative
  from private Storage. Cloudflare receives the image and a fixed transcription
  prompt, not a household, user, session, wine, email, storage key, filename, or
  signed URL.
- Process at most two images of the same bottle (such as front and back labels)
  sequentially per action, cap model output at 512
  tokens per image, and never retry an inference automatically. On inference or
  quota failure, preserve the private image so the Owner may retry or delete it.
- Persist the untrusted transcript only as a private, 24-hour capture draft.
  After the save succeeds, delete the exact prepared image objects through the
  Storage API and let the existing cleanup job retry incomplete deletion.
  Recognition cannot edit wine facts, add bottles, or change inventory.
- No automatic Google Vision fallback is allowed. It would be a second
  external processor with separate configuration, cost, and consent.
- Cloudflare documents that Workers AI customer content is not shared with
  other customers or used to train models or improve services, and that it may
  be stored if Cloudflare storage products are used. This integration uses no
  Cloudflare storage product for captures. The photo is still disclosed as
  leaving CellarManager, and is sent only after the Owner's acknowledged choice
  of a photo for this bottle.
- Cloudflare's free Workers AI allocation is 10,000 neurons per account per
  day, shared with other AI workloads. This code makes no automatic retries or
  background OCR calls. On the Workers Free plan, requests fail once the
  allocation is exhausted; on Workers Paid, usage above the free allocation
  may be billed. This decision does not change the Cloudflare plan or billing
  settings and does not promise zero cost on a paid plan.

## Consequences

The Tesseract browser runtime and language assets are removed. Manual cellar
entry remains available whenever Cloudflare is unavailable or the free daily
allowance is exhausted. Transcription is shown as untrusted text for the Owner
to review; model output is not confidence-scored, so the stored confidence field
uses zero as an unavailable-value sentinel and is not presented as a quality
score.

## References

- [Cloudflare Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare Moondream 3.1 model card](https://developers.cloudflare.com/ai/models/%40cf/moondream/moondream3.1-9B-A2B/)
