# Architecture decision records

ADRs document decisions that constrain future implementation. A released
decision is **Accepted** even when its filename retains the milestone in which
it was introduced.

| ADR | Status | Decision |
|---|---|---|
| [001](001-v02-target-architecture.md) | Accepted | React/Supabase/PowerSync/Cloudflare local-first architecture |
| [002](002-inventory-operation-model.md) | Accepted | Immutable inventory operations with PostgreSQL-authoritative holdings |
| [003](003-v01-data-migration.md) | Accepted (historical) | One-off, reconciliation-backed v0.1 migration |
| [004](004-wine-reference-and-enrichment-evidence.md) | Accepted | Shared wine identity, plural evidence, reviewed matching, and explicit enrichment fallbacks |
| [005](005-capture-assisted-wine-entry.md) | Accepted | Multimodal wine capture produces reviewable candidates; only explicit owner action reaches the existing cellar and inventory workflows |
| [006](006-capture-image-storage-security.md) | Accepted | Capture images are private, owner-authorized, purpose-limited temporary assets with bounded processing and deletion |
| [007](007-opt-in-cloudflare-label-ocr.md) | Accepted | Explicitly opt-in, bounded Cloudflare Workers AI transcription; only private text is kept and photos are deleted after saving |
| [008](008-capture-label-field-review.md) | Accepted | Text-only field-role suggestions cite OCR evidence; owner review and existing inventory flow remain authoritative |

Create a new numbered ADR before changing a stable contract from
[`../product-roadmap.md`](../product-roadmap.md). Do not rewrite an accepted ADR
to make a later decision appear retroactive; supersede it explicitly and link
both records.
