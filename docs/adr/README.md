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

Create a new numbered ADR before changing a stable contract from
[`../product-roadmap.md`](../product-roadmap.md). Do not rewrite an accepted ADR
to make a later decision appear retroactive; supersede it explicitly and link
both records.
