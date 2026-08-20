# Wine-reference validation

This record validates the proposed shared wine-reference architecture before
the first `v0.4` database migration is accepted. It deliberately separates
identity coverage from drinking-window and food-pairing coverage: finding the
right wine does not grant access to reliable enrichment content.

## Scope and safeguards

- Validation date: 2026-08-20
- Reference source: the official LWIN database downloaded from Liv-ex
- LWIN snapshot size: 212,221 reference rows
- Cellar source: the 762 distinct in-stock wine references in the personal
  production household
- Production access: read-only; no household row was inserted, updated, or
  deleted
- Private inputs: the exported cellar rows, LWIN workbook, and row-level
  benchmark outputs remain local and uncommitted; only aggregate results and
  the four producer confirmations below are documented

LWIN is distributed under a Creative Commons attribution licence that permits
sharing and adaptation, including commercial use:

<https://www.liv-ex.com/lwin-creative-commons-licence/>

Liv-ex also recommends adding LWIN as a property of an application's own
product code instead of replacing that code:

<https://www.liv-ex.com/contact-faqs/>

## Conservative matching method

The benchmark normalized accents, punctuation, common producer prefixes, and
known abbreviations. Candidate ranking considered separate evidence for:

- producer identity
- cuvee, vineyard, site, or parcel identity
- appellation and classification
- colour or sparkling type
- region

Automatic matching required all applicable hard guards to pass. A high total
score could not override a producer collision, a colour/type contradiction, an
appellation conflict, an insufficiently specific source name, or a close
runner-up. The output labels were:

- `automatic candidate`: sufficiently specific and unopposed for automatic
  linking under the tested rules
- `review candidate`: plausible, but requiring a person or previously
  confirmed household evidence
- `no candidate`: no result strong enough to present as a likely identity

These labels measure the conservative matcher, not LWIN's factual correctness.
Production thresholds still require regression fixtures and must preserve zero
known false automatic matches in the manually verified set.

## Deliberately difficult 50-wine sample

The sample combined ten identity-stress cases, every in-stock NV case, eight
unusual bottle formats, eight rare colour/type cases, and a systematic fill
across the sorted cellar. It was intentionally harder than a random sample.

| Stage | Automatic candidate | Review candidate | No candidate | Any candidate |
|---|---:|---:|---:|---:|
| Cold start | 9 | 33 | 8 | 42 (84%) |
| After four producer confirmations | 17 | 25 | 8 | 42 (84%) |

The household confirmed these intended producer identities:

- `Barthod` means Ghislaine Barthod
- `Boillot` means Louis Boillot
- `Pernot` means Alvina Pernot for the tested rows
- `Bouzereau` means Michel Bouzereau

Those four confirmations promoted eight sample rows without relaxing any
global rule. Two deliberately difficult rows remained correctly blocked:

- Bret Bros `Julienas` was less specific than the available LWIN product
- Mas Cal Demoura `Paroles de Pierre` matched by name but conflicted with the
  stored appellation

The test demonstrates why a remembered decision is household-scoped evidence,
not a universal alias rewrite. A household alias may require cuvee,
appellation, vintage, or source-import context when the same shorthand can
legitimately identify more than one producer.

## Complete-cellar run

The same rules were then applied locally to all 762 in-stock references.

| Stage | Automatic candidate | Review candidate | No candidate | Any candidate |
|---|---:|---:|---:|---:|
| Cold start | 203 (26.6%) | 511 (67.1%) | 48 (6.3%) | 714 (93.7%) |
| After four producer confirmations | 269 (35.3%) | 445 (58.4%) | 48 (6.3%) | 714 (93.7%) |

The full-cellar run was not manually labelled row by row. Its automatic count
is therefore a coverage and workload estimate, not a claim of measured
precision. The manually checked sample and explicit collision cases are the
precision guard.

Missing-reference handling remains necessary. Examples in the difficult
sample included Abelanet `Fitou`, Waris-Hubert `Armorial` and `Succulente`, and
Cal Demoura `Qu'es aquo`. A missing LWIN must not prevent CellarManager from
creating its own reference identity or later requesting a new external ID.

## Drinking-window fallback check

Publicly visible exact and comparable recommendations were used only to test
fallback semantics, not as authorization to scrape, cache, or redistribute
provider content.

- Ghislaine Barthod `Aux Beaux Bruns` 2020 exact-source ranges clustered around
  2027-2042, while another Chambolle-Musigny Premier Cru 2020 recommended
  roughly 2030-2045.
- Castagnier `Clos de Vougeot` 2022 had a relatively narrow exact recommendation,
  while comparable Clos de Vougeot 2022 wines extended from the late 2020s into
  the 2040s or 2050s.
- Dureuil-Janthial Rully Rouge 2018 exact recommendations overlapped closely
  with a comparable Rully Rouge 2018 recommendation.

Comparable-wine fallbacks are therefore directionally useful but cannot be
stored or displayed as exact provider claims. The projection must expose its
basis and widen uncertainty as specificity decreases:

1. exact release and package
2. exact product with a nearby vintage
3. same site/appellation, vintage, colour, classification, and style
4. regional or style guidance
5. unknown or user-maintained advice

Useful comparison sources from the validation were:

- <https://www.drouhin.com/fr_FR/vin/chambolle-musigny-premier-cru/2020>
- <https://www.bbr.com/products-20228119054-2022-clos-de-vougeot-grand-cru-domaine-henri-rebourseau-burgundy>
- <https://bordeauxindex.com/fine-wine/france/burgundy/jadcv-2022>
- <https://www.drouhin.com/en_US/wine/rully-rouge/2018>

## Validation conclusion

The evidence supports using LWIN as the preferred external identity reference,
while retaining CellarManager UUIDs as permanent identities. It also supports
demand-driven enrichment, conservative candidate review, remembered household
decisions, and explicit fallback estimates.

The evidence does not support a flat provider-derived schema on household wine
rows, a mandatory LWIN primary key, one current provenance value per field, or
unlabelled comparable-wine advice. It does not yet select the production
providers for drinking windows or food pairings; those require trials and
written caching, attribution, display, offline, and retention terms.
