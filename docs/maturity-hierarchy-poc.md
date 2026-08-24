# Hierarchical maturity proof of concept

This proof of concept established the progressively more specific maturity
model promoted as immutable knowledge v3. Its first reviewed vertical is Louis
Boillot, Gevrey-Chambertin Les Evocelles, 2017–2022. Knowledge v1 and v2 and
their historical projections remain unchanged.

## Model order

The calculator applies knowledge in this order:

1. a stable regional baseline;
2. appellation and climat adjustments;
3. local vintage conditions inherited from the nearest reviewed place;
4. a producer style valid for an explicit range of vintages;
5. interactions between producer style and vintage tags;
6. the exact cuvee;
7. an exact-release observation when available.

Every layer records normalized structural traits, a broad window adjustment,
confidence, rationale, and evidence identifiers. Window bounds remain
monotonic after all adjustments.

`climat` means a named wine-growing place. Weather and growing-season data use
`vintage conditions` so the two meanings are never conflated.

## Time and identity safety

Place and climat profiles are treated as stable knowledge. Producer profiles
are versioned by first and final vintage because vineyard work, winemaking, or
generation can change. A release observation affects only that release unless
later reviewed evidence justifies a broader update.

An ambiguous imported producer label never activates a shared producer profile.
For example, the text `Boillot` uses the Louis Boillot profile only after the
wine has a confirmed canonical producer key. Without that link, inference stops
at the most specific safe place.

## Reliability and specificity

Evidence reliability and inference specificity are independent:

- reliability is capped by the least-supported material layer actually used;
- specificity reports `region`, `place`, `producer-era`, `cuvee`, or `release`.

A well-supported appellation-and-vintage result can therefore have high
reliability without pretending that a producer or cuvee was identified. This
removes the candidate v2 defect that made `high` confidence impossible when the
producer and cuvee layers were absent. Adding a more specific but less certain
layer can lower reliability; stacking several broad high-confidence profiles
can never hide a weak exact-release assumption.

## Reviewed vertical

The committed proof-of-concept knowledge reproduces the owner-reviewed ordering
for Les Evocelles:

| Vintage | First assessment | Central period | Preferably drink by |
| --- | ---: | ---: | ---: |
| 2017 | 2021 | 2023–2029 | 2034 |
| 2018 | 2023 | 2025–2033 | 2038 |
| 2019 | 2022 | 2024–2034 | 2039 |
| 2020 | 2026 | 2028–2038 | 2043 |
| 2021 | 2024 | 2026–2030 | 2034 |
| 2022 | 2026 | 2028–2035 | 2040 |

The 2021 exact-release layer shortens the general vintage result because the
parcel suffered frost, coulure, and hail. The hot/dry interaction extends only
the later bounds when the producer's response supports retained freshness; it
does not blindly delay the first assessment.

## External cross-check

Published windows are retained as observations, not silently copied into the
model. They can corroborate a result, expose a disagreement, or justify an
exact-release adjustment after review.

For Louis Boillot Les Evocelles, independently published windows support the
vintage ordering but also expose where the model remains generous:

| Vintage | Model | Published comparison |
| --- | --- | --- |
| 2017 | assess 2021; central 2023–2029; preferably by 2034 | Berry Bros. & Rudd says 2020–2030; Vinous says 2022–2035 |
| 2018 | assess 2023; central 2025–2033; preferably by 2038 | Vinous says 2023–2038 |
| 2019 | assess 2022; central 2024–2034; preferably by 2039 | Berry Bros. & Rudd says 2022–2034 |
| 2020 | assess 2026; central 2028–2038; preferably by 2043 | Berry Bros. & Rudd says 2023–2035; Vinous says 2024–2036 |
| 2021 | assess 2024; central 2026–2030; preferably by 2034 | Berry Bros. & Rudd says 2024–2034; other reviews cluster around 2024/2025–2030 |
| 2022 | assess 2026; central 2028–2035; preferably by 2040 | Vinous says 2026–2035 |

The 2020 and 2022 final years are therefore explicit model-versus-source
disagreements, not web-confirmed facts. They need owner review or a later
exact-release rule before publication.

For Cal Demoura 2023, the external comparison is uneven. Terres de Jonquières
has a published 2026–2033 window, consistent with the model. Les Combariolles
has mutually inconsistent published recommendations ranging from roughly
2025–2031 to an apogee of 2029–2039 and a 2043+ final year. Feu Sacré has an
independent `2033++` apogee indication, while Belle Fiolle and Fragments lack a
dependable consensus. The producer's own profiles strongly support the relative
ordering and structural differences; they do not publish precise final years.

Relevant comparisons:

- [Berry Bros. & Rudd — Les Evocelles 2019](https://www.bbr.com/products-20191021284-2019-gevrey-chambertin-les-evocelles-domaine-louis-boillot-and-fils-burgundy)
- [Berry Bros. & Rudd — Les Evocelles 2020](https://www.bbr.com/products-20201021284-2020-gevrey-chambertin-les-evocelles-domaine-louis-boillot-and-fils-burgundy)
- [Berry Bros. & Rudd — Les Evocelles 2021](https://www.bbr.com/products-20211021284-2021-gevrey-chambertin-les-evocelles-domaine-louis-boillot-and-fils-burgundy)
- [Vinous — Louis Boillot vertical](https://v1.vinous.com/producers/domaine-louis-boillot-et-fils-b2597368-66cc-40b7-b2e7-07b8fe8352a5?article_id=1836)
- [Cal Demoura — official cuvee profiles](https://www.caldemoura.com/les-vins)
- [Terres de Jonquières 2023 comparison](https://le-meilleur-du-vin.com/mas-cal-demoura/2946-mas-cal-demoura-terrasses-du-larzac-terres-de-joncquieres-2023.html)
- [Les Combariolles 2023 comparison](https://www.lecarredesvins.com/18549-mas-cal-demoura-les-combariolles-2023-7188200.html)
- [Feu Sacré 2023 comparison](https://www.oenovinia.com/languedoc/9546-mas-cal-demoura-feu-sacre-2023.html)

## Promotion boundary

The JavaScript model remains the reviewable source fixture. Its generated SQL
installer clones v2's broad place/vintage coverage into a draft v3, replaces
only the validated layers above, and publishes v3 only after an explicit
service call. Every v3 profile keeps pointer-only evidence and rationale.

The production resolver uses a household wine's confirmed shared identity. A
provider-specific product can bridge to a reviewed cuvee only when its producer
is already confirmed and exactly one curated cuvee alias matches. A household's
remembered producer choice provides the same explicit producer evidence. Raw
text such as `Boillot` alone never activates producer, interaction, cuvee, or
release layers.

The web explanation presents the ordered contributions used by one projection.
Database tests reproduce the reviewed Evocelles and Cal Demoura windows, exact
2021 release adjustment, conservative confidence, identity bridge, ambiguous
producer fallback, and colour-conflict rejection. Production publication still
requires explicit owner acceptance of the deployed candidate.
