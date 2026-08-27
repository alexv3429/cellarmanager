# Rich household wine facts

Roadmap step 0.4.11 lets a household describe a wine beyond the conservative
identity needed for inventory. Country, region, classification, vineyard,
grapes, sweetness, label alcohol, and certifications are visible and editable
on Wine Detail.

## Ownership and provenance boundary

Three data layers remain distinct:

1. **Household fact** — a value the owner imported, restored, or explicitly
   edited for one household wine.
2. **Reviewed shared knowledge** — immutable, attributable place, vintage,
   producer, cuvee, and release profiles used by the inference engine.
3. **Personal observation** — dated tasting, producer, maturity, pairing, or
   storage feedback recorded by one household member.

The 0.4.11 editor changes only the first layer. A household fact does not
silently become shared truth and does not overwrite an active reviewed profile.
Later web research may propose a sourced value, but 0.4.14 must show that draft
for review before it can become trusted shared knowledge.

A confirmed LWIN match already preserves reviewed country, region, subregion,
classification, site, and parcel values. Wine Detail exposes those available
origin values with the LWIN7 attribution and can prefill only missing fields;
the owner must still review and save. LWIN does not supply reliable grapes,
sweetness, label alcohol, or certifications, so the UI does not pretend that it
does. Independently reviewed appellation-and-color evidence may supplement the
LWIN values. For example, the initial Puligny-Montrachet white profile suggests
Chardonnay with an unknown percentage and explains that the INAO specification
also permits Pinot Blanc. This is a typical-grape proposal, not an invented
claim that the bottle is 100% Chardonnay.

## Stored fields

The synchronized `public.wines` row now includes:

- `country`: a household-maintained display label;
- `area`: the region label, retained under its legacy database name so current
  CSV imports and synchronized devices remain compatible;
- `classification`: for example Premier Cru, Grand Cru, DOCG, or Reserva;
- `vineyard`: a vineyard, climat, site, or parcel label;
- `grape_composition`: up to 20 ordered grape names with optional percentages;
- `sweetness_category`: `bone-dry`, `dry`, `off-dry`, `medium-sweet`, or
  `sweet`;
- `alcohol_percent`: label alcohol above 0 and at most 30 percent;
- `certifications`: up to 20 explicit labels.

Known grape percentages may total less than 100 because partial knowledge is
useful; they may never exceed 100. Missing percentages stay unknown rather than
being divided or guessed. Duplicate grapes and certifications are rejected
case-insensitively.

Sweetness and alcohol are descriptive label facts. They are deliberately
separate from the reviewed 0–5 sweetness and alcohol structure traits used by
maturity and pairing projections. Adding a label fact therefore cannot silently
change an existing recommendation.

A certification label records what the owner intends to retain. CellarManager
does not infer a formal certification from terms such as natural, sustainable,
or biodynamic practice.

## Editing and synchronization

Wine facts are part of the household `wines` row and remain readable through
PowerSync offline. Editing is online and owner-only through
`update_wine_facts`; browser roles have no direct table-write privilege. The
RPC normalizes whitespace, validates the complete bounded payload, preserves
the wine ID and identity, and leaves every holding untouched.

Region remains part of conservative reference matching. Editing it follows the
existing behavior: a confirmed link whose supporting identity changed may need
review again. The other descriptive facts do not automatically confirm or
invalidate a shared reference.

## Archived v0.1 restoration

Step 0.4.12 restores only missing facts from the hash-verified private archive.
Exact preserved wine UUIDs avoid semantic matching; equal values are
idempotent, conflicts preserve the current value, and a transaction preview is
required before apply. See
[`v01-metadata-restoration.md`](v01-metadata-restoration.md).

## Follow-on roadmap

- 0.4.13 adds rich catalog search/filtering, exact profile-layer diagnostics,
  and a prioritized coverage queue; see
  [`catalog-coverage-curation.md`](catalog-coverage-curation.md).
- 0.4.14 turns allowlisted web findings for missing facts and profiles into
  attributed drafts and requires visible review before trusted shared
  publication.
- 0.4.16 includes the fields in the documented portable CSV export.

## Acceptance

- apply the additive migration without changing wine, holding, bottle, cellar,
  or location counts;
- add, edit, clear, and refresh every fact on Wine Detail;
- allow named grapes without percentages and a partial known composition;
- reject malformed arrays, duplicates, more than 20 values, totals over 100,
  invalid sweetness, and impossible alcohol;
- deny cross-household and direct browser writes;
- keep identity and stock attached to the same wine;
- preserve facts across refresh and show them offline after synchronization;
- display confirmed LWIN origin suggestions with attribution, prefill only
  missing values, and require an explicit save;
- display independently reviewed appellation facts with their official web
  source even without LWIN, preserve regulatory nuances, and never save a
  typical grape as an exact percentage;
- verify the editor without horizontal overflow on desktop and phone.
