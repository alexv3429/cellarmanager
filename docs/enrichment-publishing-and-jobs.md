# Enrichment publishing and asynchronous jobs

Roadmap step 0.4.7 makes the 0.4.6 schema operational without yet calculating
or displaying maturity or pairing advice. It publishes reviewed knowledge
atomically and creates durable, provider-neutral work after a wine reaches the
server. Inventory saves and offline synchronization never wait for enrichment.

## Publishing reviewed knowledge

Trusted service code calls:

```sql
select public.publish_enrichment_knowledge_version(:draft_version_id);
```

The transaction rejects publication unless:

- the version is still a draft and contains at least one place baseline;
- every profile is reviewed;
- every profile has reviewed supporting evidence;
- no published profile links pending or rejected evidence.

The database then builds a canonical JSON payload from the version metadata,
typed profile rows, and exact evidence records; calculates its SHA-256 hash;
supersedes the previous active version; and activates the draft. Reviewed
evidence and all published profile content are immutable. A correction therefore
creates a new evidence row and knowledge version instead of changing historical
advice silently.

Publishing also cancels queued or leased jobs that use the old version and
requeues every demand. Existing current projections remain readable until a
later job replaces them, so a new knowledge publication does not create an
empty UI state.

## Demand lifecycle

`enrichment_demands` contains two idempotent capabilities for every synchronized
wine:

- `maturity` covers maturity, urgency, storage purpose, and moving hints;
- `pairing-profile` prepares the wine-side structure used by later dish queries.

Existing production wines are backfilled when the migration is applied. An
after-write trigger creates demands for future wines. If producer, cuvee,
vintage, colour, appellation, area, format, or confirmed reference identity
changes, a new SHA-256 input fingerprint requeues both capabilities and cancels
in-flight work based on the old identity.

The durable states are:

```text
queued -> matching -> complete
                   -> partial
                   -> needs-review
                   -> not-found
                   -> retrying -> matching
                   -> failed
```

The trigger runs only after the wine has synchronized to PostgreSQL. Creating
or editing a wine offline remains a normal local-first operation even when the
server, a provider, or the enrichment worker is unavailable.

## Job worker contract

All worker functions are callable only by `service_role`:

1. `enqueue_enrichment_jobs(limit)` creates at most one job for a demand,
   knowledge version, and input fingerprint. With no active version it returns
   safely without creating work.
2. `claim_enrichment_jobs(worker_id, limit, lease_seconds)` uses
   `FOR UPDATE SKIP LOCKED`, returns unique lease tokens, and supports concurrent
   workers without duplicate ownership.
3. `complete_enrichment_job(job_id, lease_token, outcome, error, retry_at)`
   accepts only the owning unexpired token. It records complete, partial,
   needs-review, not-found, retry, or failed outcomes.

Attempts are bounded. Retry times must be in the future. Expired leases return
to the queue until the maximum attempt count is reached. Completion compares
the job's wine fingerprint and knowledge version with current state; stale work
is cancelled rather than published over a newer edit or model.

Step 0.4.8 adds a maturity-specific claim and processing boundary. It writes the
maturity and storage projections in the same server transaction before
reporting `complete`; unsupported wines finish explicitly as `needs-review`.
See [`maturity-projections.md`](maturity-projections.md).

Step 0.4.9 adds the parallel pairing-profile processor. It reuses the reviewed
wine structure and provenance produced by the active maturity hierarchy, then
serves dish-specific, in-stock comparisons through narrow online RPCs. See
[`pairing-projections.md`](pairing-projections.md).

## Provider boundary

No provider is production-approved yet, so current jobs use the curated model
and have no provider source. The schema supports an optional reviewed
source/policy pair for a later adapter without weakening the rights gate.

`enrichment_provider_cache_entries` stores only:

- a SHA-256 cache key;
- found, not-found, pending, or error status;
- an optional normalized evidence ID;
- request/expiry/retry metadata.

A reviewed policy must allow retention before even this metadata is cached.
There is no raw-response, API-key, credential, or secret column. Credentials
remain in the deployment secret store and never reach browsers, PowerSync, job
rows, logs, or committed configuration.

`enrichment_provider_rate_limits` records bounded provider windows and rejects
request counts above their configured quota. Adapters may therefore coordinate
across workers without guessing from an in-process counter.

## Access and synchronization

Demands, jobs, provider cache entries, and rate-limit buckets have RLS enabled,
are service-only, and are absent from PowerSync. Household users see the
permitted maturity projection subset through the narrow 0.4.8 application RPCs;
they cannot inspect the global queue or provider metadata. The 0.4.9 pairing
RPCs apply the same membership boundary and keep dish profiles, preferences,
feedback, and projections outside PowerSync.

The migration creates no job, provider call, evidence, knowledge version, or
projection by itself. It only backfills two queued demands per existing wine.
Jobs remain absent until a reviewed knowledge version is explicitly published.

## Acceptance checks

- applying all migrations from an empty database succeeds;
- publication rejects unreviewed or unsupported profiles;
- hashes are stable and published inputs cannot drift;
- enqueue is idempotent and claims have unique leases;
- invalid tokens, expired leases, stale wine inputs, and superseded knowledge
  cannot complete old advice;
- retry and rate-limit bounds are enforced;
- provider retention prohibitions block cache writes;
- existing wines, holdings, cellars, locations, and bottle counts are unchanged.

## Production acceptance

The additive migration was applied to the linked production project on
2026-08-21. Aggregate counts before and after remained identical: 765 wines,
1,207 bottles across 826 holdings, eight cellars, and 156 locations. The
migration created exactly 1,530 queued demands: one maturity and one
pairing-profile demand for each wine, with no duplicates. It created no jobs,
cache entries, rate-limit buckets, or active knowledge version. All four new
tables had RLS enabled, and authenticated users could neither read the demands
nor publish knowledge. The owner then confirmed that the deployed application
continued to work normally.
