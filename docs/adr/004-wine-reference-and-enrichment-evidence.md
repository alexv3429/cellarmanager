# ADR 004: Shared wine reference and enrichment evidence

- Status: Accepted
- Date: 2026-08-20

## Context

CellarManager must provide reliable drinking-window and food-pairing advice
without making a household's editable cellar row the canonical copy of
third-party data. Wine names are incomplete and ambiguous, provider coverage is
partial, exact-source opinions conflict, and provider licences can constrain
caching, onward display, offline synchronization, and retention.

The production validation in
[`../wine-reference-validation.md`](../wine-reference-validation.md) found an
LWIN candidate for 93.7% of the complete in-stock cellar. It also demonstrated
that producer confirmation materially improves later automation, that some
names must remain unresolved, and that comparable-wine drinking windows are
useful only when visibly presented as estimates.

## Decision

### CellarManager owns the permanent identity

CellarManager assigns its own stable UUIDs to four reference concepts:

1. producer, estate, or brand, including aliases and succession
2. product or cuvee belonging to that producer
3. vintage or identified NV release, including base vintage, disgorgement, or
   lot when known
4. package, including bottle format and GTIN when known

LWIN7, LWIN11/LWIN16/LWIN18, GTIN, Wine-Searcher IDs, provider IDs, and producer SKUs
are external identifiers attached to those concepts. No provider identifier is
the database primary key. References can be merged or superseded without
rewriting household inventory history.

### Household wine data remains household-owned

`public.wines` retains the user's imported or edited description and may link
to a shared reference. Linking does not silently replace the user's values.
Personal notes, manual drinking windows, pairings, and rejected or confirmed
matches remain household/user scoped.

A household decision is stored as matching evidence. It may be scoped by
source text, cuvee, appellation, vintage, or import context; it is not promoted
into a global alias automatically.

### Provider evidence is private and plural

Provider records and raw responses live behind a service-owned boundary.
Typed drinking-window and food-pairing claims retain:

- source and source record/URL
- retrieval and applicable publication dates
- product, release, package, or style scope
- source-specific attribution
- licence, cache, display, offline, and retention policy
- the original claim when storage is permitted

Conflicting claims coexist. A new claim does not overwrite earlier evidence,
and a single generic field-provenance row cannot collapse multiple opinions.
Raw payloads are retained only when the provider terms allow it.
Claims are reused across households only when the provider licence and account
entitlement allow that reuse. Shared identity does not imply shared rights to
licensed content.

Claim scope is earned from evidence returned by the provider. Including a
vintage in a search query does not make a product-level response release-level.
An exact-release claim requires an explicit matching vintage or identified NV
release in the response; an omitted vintage remains product-scoped. A returned
red/white/rose contradiction is a hard rejection, never a scoring penalty.

### Recommendations are projections, not source facts

CellarManager derives a display recommendation from eligible claims. The
projection records its method, specificity, contributing claims, calculation
time, and quality indicators. Identity certainty, content authority,
specificity, freshness, and legal usability remain separate dimensions.

Fallback levels are explicit:

1. exact release/package claim
2. exact product guidance that is explicitly vintage-agnostic
3. nearby-vintage estimate supported by comparable vintage/weather evidence
4. comparable site/appellation/vintage/style estimate
5. regional/style guidance
6. unknown or user-maintained value

Calendar adjacency alone does not make two vintages comparable. Solar, rainy,
cool, hot, or otherwise atypical years can materially change structure and
drinking evolution, so a nearby-vintage projection must retain its comparison
rationale and contributing vintage evidence.

Pairings use normalized category codes with localized labels and optional
source rationale. Free text alone is not the shared pairing model.

### Matching is conservative and reviewable

Candidate generation preserves the evidence and alternatives that produced a
match. Automatic linking requires hard guards as well as a score. Producer
collisions, close runners-up, type contradictions, metadata conflicts, and
insufficient specificity require review regardless of total score.

Confirmed decisions improve later matching for the same household. Rejected
matches are also retained so the service does not repeatedly propose them.

### Enrichment is asynchronous and server-side

Saving a local-first wine never depends on provider connectivity. After the
household write synchronizes, a server-side transaction ensures an enrichment
demand exists. Jobs can move through waiting-for-sync, queued, matching,
needs-review, partial, complete, not-found, and retrying states.

Provider credentials and web retrieval never run in the browser. Negative and
not-found results are cached with a source-appropriate expiry to avoid repeated
cost and rate-limit pressure.

### Synchronization follows the content licence

The shared identity library and private provider evidence are not automatically
published through PowerSync. Only a household-linked display projection and
the attribution permitted by the provider may be synchronized. Content that
cannot be stored offline remains an online-only detail.

### Sources are selected per capability

LWIN is the preferred open external identity reference, subject to attribution.
Regulatory, producer, critic, pairing, and valuation sources are evaluated for
the fields they are authoritative for; no source receives a global reliability
rank. General web search and language models may help discover candidates but
are not canonical sources.

The 0.4.5 provider trial selected no production provider: the trialable sources
did not jointly meet exact-release identity, vintage sensitivity, pairing
coverage, provenance, and written-rights requirements. A private proof of
concept then evaluated a curated place/vintage/producer/cuvée knowledge model.
The owner classified 17/20 maturity results as useful and none as wrong, which
passes the maturity gate and outperformed the complete online-provider trial.
Pairing produced no wrong verdicts but only 6/10 useful scenarios, below its
separate 70% gate.

CellarManager will therefore make the reviewed, versioned knowledge model the
production enrichment foundation. Web/provider records remain eligible
attributable evidence inputs and benchmarks; they are not automatically the
runtime authority. Production pairing must incorporate the recorded
ingredient, colour/style, spice, and personal-preference gaps and pass a new
owner review before release.

## Consequences

- The schema is more layered than adding rich columns directly to
  `public.wines`, but it avoids duplicating shared data per household and keeps
  provider changes survivable.
- First encounters with abbreviated producers may require review; remembered
  evidence reduces that workload substantially.
- “Advice for every wine” means transparent fallback guidance where possible,
  not fabricated exact claims.
- Global reference data must be service-managed so household edits cannot
  poison other users' matches.
- The existing flat household-rich schema proposal and single-current-source
  provenance model must be replaced rather than accepted as the v0.4
  foundation.
- The 0.4.6 schema implements this boundary with immutable knowledge versions,
  typed place/vintage/producer-era/cuvee profiles, versioned source-rights
  policies, plural evidence, private observations, and explainable household
  projections. See
  [`../enrichment-knowledge-schema.md`](../enrichment-knowledge-schema.md).

## Deferred decisions

- optional production evidence providers and their permitted uses
- final scoring weights and automatic thresholds
- LWIN snapshot refresh versus API integration
- whether licensed recommendations are synchronized or online-only
