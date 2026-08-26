# Shared wine-reference schema

Roadmap step 0.4.2 implements the identity boundary accepted in
[`adr/004-wine-reference-and-enrichment-evidence.md`](adr/004-wine-reference-and-enrichment-evidence.md).
It establishes durable shared identities without importing LWIN, matching a
household wine, or storing provider enrichment claims yet.

## Identity hierarchy

Every shared identity starts with a stable CellarManager UUID in
`wine_reference_entities` and has exactly one typed row:

```text
producer -> product -> release -> package
```

- A producer represents a producer, estate, or brand. Names are deliberately
  not globally unique because real producers can have colliding names.
- A product is a named wine or cuvee belonging to one producer.
- A release is a vintage or an identifiable NV release. Generic NV wines stay
  linked at product level until a base vintage, disgorgement, lot, or other
  release discriminator is known.
- A package identifies container type, volume per unit, and unit count. This
  distinguishes one 750 ml bottle from a six-bottle case without changing the
  release.

The root identity lets aliases, external identifiers, and supersession edges
refer safely to any level while typed foreign keys prevent one level from being
mistaken for another.

## Household boundary

`public.wines` remains household-owned and keeps its producer, cuvee, vintage,
colour, appellation, region, format, and later descriptive facts exactly as
imported or edited. Its nullable
`wine_reference_id` and `wine_reference_type` can point to the most specific
confirmed product, release, or package. A producer-only link is not sufficiently
specific for a wine.

Roadmap step 0.4.11 adds country, classification, vineyard, grape composition,
sweetness, label alcohol, and certification labels to that household row. They
remain household facts rather than shared reference claims; see
[`rich-wine-facts.md`](rich-wine-facts.md).

The schema migration does not guess or backfill links for existing production
wines. Roadmap step 0.4.4 adds review-only LWIN candidates and explicit
household decisions; see
[`wine-reference-matching.md`](wine-reference-matching.md).

## Shared identity evidence

- `wine_reference_aliases` stores curated global aliases and their normalized
  lookup values. It has no household column; household shorthand is not
  promoted here automatically.
- `wine_reference_external_identifiers` attaches an authority, scheme, and
  value to one identity. LWIN7 belongs to products, LWIN11 to releases, and
  LWIN16 and pack-aware LWIN18 belong to packages. GTIN schemes belong to
  packages.
- `wine_reference_supersessions` distinguishes a duplicate merge from a real
  successor relationship. Edges must stay within one identity type and cannot
  form cycles. Existing household links are not rewritten.

External identifiers are alternate keys, never CellarManager primary keys.
Liv-ex encodes non-vintage products as `1000` inside longer LWINs; that provider
encoding stays in the external identifier. CellarManager keeps the internal
vintage null and uses an actual NV release discriminator when one is known.

## LWIN source cache

Roadmap step 0.4.3 imports the official LWIN7 workbook into a separate,
versioned source cache. The cache retains live, combined, and deleted rows and
their successor references; it does not eagerly create a permanent
CellarManager product for every provider row. Only a later reviewed match
promotes the relevant source row into this UUID-backed hierarchy.

The active cache changes atomically after complete validation. Source rows,
snapshot metadata, attribution, and durable missing-identifier demands remain
service-only and outside PowerSync. See
[`lwin-reference-snapshots.md`](lwin-reference-snapshots.md) for the operational
contract.

## Access and synchronization

The shared tables have RLS enabled and grant no direct access to anonymous,
authenticated-browser, or PowerSync roles. Trusted service code maintains them
through the `service_role`. They are deliberately absent from the PowerSync
publication. Step 0.4.4 exposes only security-definer review and decision RPCs;
it does not expose the source library or matching evidence tables.

Only the nullable household link is part of the synchronized `wines` row. The
online review RPC returns the current household projection, but the full global
library and licensed provider evidence are not copied to every device.

## Deferred work

- 0.4.5 trialled drinking-window and pairing sources, selected no production
  provider, and validated an inference-first maturity model.
- 0.4.6 adds the versioned place/vintage/producer-era/cuvee knowledge,
  attributable evidence, household observation, and recommendation projection
  boundary described in
  [`enrichment-knowledge-schema.md`](enrichment-knowledge-schema.md).

No provider payload or credential is added by either schema step. Production
calculation, publishing, and display remain later roadmap work.
