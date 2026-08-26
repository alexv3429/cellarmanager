# Enrichment knowledge and projection schema

Roadmap step 0.4.6 turns the validated inference proof of concept into a
production-safe data boundary. It adds no advice to the application yet and
does not import the private validation cohort. It defines where reviewed shared
knowledge, attributable evidence, household observations, and derived advice
belong before publishing or calculation jobs are implemented.

## Boundary overview

```text
source -> versioned policy -> evidence
                              |
place -> reviewed profile ----+-> immutable knowledge version
vintage -> reviewed profile --+             |
producer era -> profile -------+             v
producer x vintage -> profile -+             |
cuvee -> reviewed profile -----+     household projection
exact release -> profile ------+             ^
                                            ^
household observation ----------------------+
```

Shared knowledge is service-managed and never becomes household wine data.
`public.wines` remains the owner's editable catalogue and continues to link to
the shared producer/product/release/package hierarchy introduced in 0.4.2.

## Sources, rights, and evidence

`enrichment_sources` identifies regulatory bodies, producers, vintage reports,
critics, providers, owner sources, and CellarManager methodology. A source does
not become authoritative for every capability merely because it is present.

`enrichment_source_policies` snapshots the rights that applied at a particular
time. Display, normalized storage, raw-payload storage, offline sync, retention,
and cross-household reuse are separate decisions. A reviewed policy cannot
leave any of these rights unknown or contract-dependent. Only one open-ended
reviewed policy may be current for a source.

`enrichment_evidence` is deliberately narrower than a provider response:

- `pointer-only` stores a source record ID or HTTPS citation without copying
  protected content;
- `normalized-claim` stores one JSON object only when a reviewed policy permits
  normalized storage;
- scope is typed as place, place-and-vintage, producer, product, release,
  package, or methodology;
- colour and vintage remain explicit when applicable;
- there is no raw provider-payload column.

Evidence may support, contradict, or contextualize a profile. Conflicts remain
visible instead of overwriting an earlier claim.

## Versioned knowledge model

`enrichment_places` supplies stable hierarchical geography from country down to
appellation, climat, site, or parcel. The database prevents hierarchy cycles and keeps a normalized
lookup name alongside canonical display text.

Each `enrichment_knowledge_versions` row records a model key/version and, after
publication, an exact SHA-256 content hash. At most one version is active.
Published versions and their profile content are immutable; a changed profile
requires a new version. Active versions may later become superseded or retired
without deleting the historical input used by an existing projection.

Every `enrichment_profiles` root has exactly one typed row:

- `enrichment_place_profiles` contains the baseline structure and monotonic
  first-trial, likely-best, and suggested drink-by ages for a place and colour;
- `enrichment_place_adjustment_profiles` refines an inherited regional baseline
  at appellation, climat, site, or parcel level;
- `enrichment_vintage_profiles` adjusts the baseline for local vintage
  conditions;
- `enrichment_producer_era_profiles` adjusts it for one producer across an
  explicit vintage interval, so ownership or winemaking changes do not rewrite
  history;
- `enrichment_producer_vintage_interaction_profiles` applies only when all
  reviewed vintage-condition tags match one producer era;
- `enrichment_cuvee_profiles` adjusts one canonical product and may identify
  its site;
- `enrichment_release_profiles` confines an observation to one exact release.

Body, acidity, tannin, sweetness, alcohol, freshness, savoury, and concentration use
a bounded 0–5 baseline. Later layers store bounded adjustments instead of
repeating an entire synthetic wine profile. Confidence and rationale live on
the reviewed root; supporting evidence is normalized through
`enrichment_profile_evidence`.

## Household observations

`household_wine_observations` records private tasting, producer guidance,
maturity, pairing, storage, or other feedback against the household wine—not
against the global profile. It supports structured maturity and pairing
verdicts, bounded structure ratings, notes, and household or personal
visibility.

An observation must belong to the same household as both the wine and its
author. This prevents one household's experience from becoming global truth or
leaking to another household. Step 0.4.10 will add the reviewed mutation and
editing workflows; 0.4.6 grants browser users no direct write access.

## Recommendation projections

`wine_enrichment_projections` stores the current or historical result displayed
for one household wine. A projection is explicitly not evidence. It records:

- maturity, storage, or pairing capability and pairing context where needed;
- curated-inference, source-claim, or manual method;
- exact-release through regional-style specificity;
- confidence, an input SHA-256 fingerprint, calculation time, and optional
  validity end;
- the active knowledge version and optional confirmed wine-reference identity;
- a JSON result object whose capability-specific shape is added with the
  production maturity and pairing steps.

Only one current result can exist for a wine/capability/context. A current
projection cannot use a draft knowledge version. Join tables retain the exact
profiles, evidence, and household observations that contributed to it, and
cross-version or cross-household links are rejected by foreign keys.

## Security and synchronization

All enrichment tables have RLS enabled. Shared sources, policies, places,
profiles, and evidence are available only to trusted `service_role` code.
Authenticated members may read their own household observations and projections
online, respecting personal visibility, but cannot mutate them directly.

No enrichment table is added to the PowerSync publication in this step. This is
intentional: source licences may prohibit offline content, and 0.4.7 must decide
what reviewed projection subset and attribution may be synchronized. Existing
wines, holdings, cellars, locations, and bottle counts are untouched.

## Production acceptance

The additive migration was applied to the linked production project on
2026-08-21. Aggregate counts before and after remained identical: 765 wines,
1,207 bottles, eight cellars, and 156 locations. All 16 new tables had RLS
enabled, and the migration created no knowledge version, observation, or
projection data. The owner then confirmed that the deployed Inventory, Catalog,
and Cellar Setup continued to work normally.

## Implemented extensions and next step

- 0.4.7 publishes reviewed knowledge versions and runs the asynchronous demand
  and job infrastructure documented in
  [`enrichment-publishing-and-jobs.md`](enrichment-publishing-and-jobs.md).
- 0.4.8 calculates and displays production maturity, urgency, storage-purpose,
  and moving-hint projection payloads as documented in
  [`maturity-projections.md`](maturity-projections.md).
- 0.4.9 adds reviewed dish profiles and pairing payloads, corrects the POC gaps,
  and requires repeated owner acceptance as documented in
  [`pairing-projections.md`](pairing-projections.md).
- 0.4.10 adds secured personal observation editing and derived serving guidance
  on top of the narrow maturity-window adjustment introduced in 0.4.8; see
  [`personal-observations-serving.md`](personal-observations-serving.md).
