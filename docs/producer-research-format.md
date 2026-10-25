# Producer research exchange — JSON contract 1.1.0 (draft)

CellarManager accepts **one independent, versioned JSON file per producer** for **research review only**. It is neither a cellar import nor a source of automatic shared drinking-window publication.

The normative machine-readable specification is [producer_exchange_v1.schema.json](schemas/producer_exchange_v1.schema.json) (JSON Schema Draft 2020-12). The previous Burgaud ZIP format (`cellarmanager.research.domaine.v1`) and its inlined relative cuvée ages are **retired**. Any earlier Burgaud file using `schema_version: 1.0.0` needs explicit migration to `1.1.0`; renaming the envelope alone is insufficient.

## Data layers

- `producer` and `cuvees`: names, aliases, canonicalization *hints*, appellation, region, colour, and sourced name history with optional vintage bounds. Names and vintage effects **never imply production**.
- `vintage_effects`: source-linked producer-specific, colour-scoped context without mass-generated release years.
- `exact_release_calibrations`: named cuvée, vintage, mandatory **`format_ml`**, named-vintage release-existence evidence, and three independently **proposed** calendar years under `proposal`. Each proposal includes rationale, confidence, supporting sources, milestone support and `candidate_not_approved`. The year order is first trial <= optimum start <= optimum end. Existence evidence and precise dates are distinct claims.
- `external_drinking_observations`: original published advice and **mandatory `format_ml`**, without relabeling a critic's general window as three optimum milestones. Magnum 1500 ml cannot automatically substantiate a 750 ml calibration.
- `structure_profiles`: source-linked structural estimates, separate from dates.
- `pairing_profiles`: source IDs on **both the whole profile and each dish hypothesis**; required `hypothesis_basis`/`evidence_basis` distinguish inferred structural matches from documented (still unreviewed) source pairings. A producer style description is not an actual tasted food pairing.
- `sources`: HTTPS pointers with source-rights status; rights unknown until independently reviewed.
- `source_discrepancies` and `research_gaps`: unresolved conflicts, without invented dates.

Unknown data remain absent. Local IDs are not CellarManager UUIDs. The JSON is the source of truth; CSV files are optional generated human review views.

## Validation and review are separate

The Node validator is part of the repository's existing `npm run drinking-window:test` suite; no Python `jsonschema` package is required:

```sh
node scripts/drinking_window/producer_research_package.mjs /private/research/producer.json
node scripts/drinking_window/producer_research_package.mjs /private/research/producer.json morgon_james 2022 2025,2028,2035 750
npm run drinking-window:test
```

The companion JSON Schema is the normative document contract; the Node validator checks critical semantic conditions and cross-references (including volumes, source IDs and URLs, draft status and ordered dates). Passing these checks is **not** evidence that an individual source supports its stated claim. Curators must still verify actual source content, identity, package size, source rights and competing calendar advice. Do not import any `candidate_not_approved` proposal into effective advice.

### James 2022

The Burgaud research prototype has an unapproved 750 ml James 2022 proposal of **2026 / 2030–2038**. Earlier research proposed **2026 / 2032–2042**, and a regional pilot **2025 / 2028–2035**. These are conflicting estimates, **not** three source-attested milestones. A Vinatis 750 ml page reports its own horizon, while a separate 1500 ml merchant listing reports another range. Distinguish these by package size and preserve source scope. No date becomes active from this exchange.

## Safe integration boundary

This PR adds documentation, a schema, a read-only validator and tests. It must not add Supabase migrations, alter household inventory, stage draft candidates automatically, or publish any shared maturity advice. Review workflow, canonical identity matching, source-policy approval, shadow comparison, curator approval and publication remain separate existing CellarManager processes.

Schema version `1.1.0` is intentionally incompatible with `1.0.0` because it requires bottle size and food-pairing provenance. Dataset versions evolve independently (the current local Burgaud revision is `1.0.2`).
