# Enrichment provider trial

Roadmap step 0.4.5 selects production sources for drinking windows and food
pairings. It is a quality, access, and rights gate; it does not add provider
credentials, claims, or customer-facing enrichment to the application.

Status on 2026-08-21: **complete; no provider is production-approved and the
inference-first architecture is selected**. Published marketing claims or a
successful API response are not sufficient to select a provider.

## Acceptance gate

A production source must pass four independent checks:

1. **Identity:** a stable provider ID or URL can be attached to the reviewed
   CellarManager product/release without silently accepting an ambiguous name.
2. **Quality and coverage:** an adversarial 20-wine cohort measures safety on
   ambiguous and unusual inputs, while a separate mainstream cohort measures
   ordinary coverage and vintage sensitivity. The household owner reviews the
   usefulness of every returned recommendation. There may be no known false
   automatic identity match.
3. **Operational access:** an official API, server-side credentials, documented
   quotas, sustainable pricing, and an outage/not-found contract exist.
4. **Written rights:** production display, caching, retention, offline use,
   attribution, raw-payload storage, and cross-household reuse are each
   explicitly allowed or explicitly constrained by provider terms, contract,
   or provider correspondence.

An online-only or account-scoped provider can pass when that restriction is
explicit. An `unknown` right cannot. The executable policy in
`scripts/enrichment/provider_policy.mjs` prevents a provider from becoming
production-eligible until all rights are resolved and dated written evidence is
recorded.

## Private coverage trial

The trial input contains 20 wines from the deliberately difficult cellar sample
used by the reference-identity validation: four identity-stress, NV, unusual
format, colour/type, or systematic cases from each bucket. Expected LWIN7 is
included only for rows that the earlier conservative run classified as an
automatic candidate. The private input, API output, and row-level assessment
remain uncommitted.

The harness:

- reads credentials only from `GRAPEMINDS_API_KEY` and `WINEAPI_API_KEY`;
- sends at most 50 sequential sample rows;
- never places a credential in a URL, report, or error;
- writes mode-`0600` reports outside the repository or under the gitignored
  `.provider-trials/` directory;
- records candidate identity, LWIN agreement, coverage, returned advice,
  response provenance signals, pending enrichment, and errors;
- retains no hidden raw response archive.

Run a provider independently so one provider's access does not block the other:

    GRAPEMINDS_API_KEY=... npm run enrichment:trial -- \
      --sample /private/path/enrichment-sample.json \
      --provider grapeminds

    WINEAPI_API_KEY=... npm run enrichment:trial -- \
      --sample /private/path/enrichment-sample.json \
      --provider wineapi

The output is trial evidence, not licensed production content. Do not commit or
redistribute it.

When a provider documents asynchronous enrichment, retry only rows that were
reported as pending instead of repeating searches:

    WINEAPI_API_KEY=... npm run enrichment:trial -- \
      --sample /private/path/enrichment-sample.json \
      --provider wineapi \
      --retry-from /private/path/first-report.json

Generate a local, mode-`0600` owner-review page from the two reports:

    npm run enrichment:review -- \
      --sample /private/path/enrichment-sample.json \
      --grapeminds /private/path/grapeminds-report.json \
      --wineapi /private/path/wineapi-report.json \
      --output /private/path/provider-review.html

The page escapes provider content, remains outside the repository, and exports
the owner's verdicts as a local JSON file.

## Trial run on 2026-08-21

The private run completed without request errors. Aggregate results are safe to
record; row-level cellar data and provider content remain private.

| Signal | Grapeminds | WineAPI.io |
|---|---:|---:|
| Search returned a candidate | 20/20 | 20/20 |
| Drinking window returned | 20/20 after a later rerun | Not supported |
| Food pairing returned | 0/20 | 9/20 after pending-only retry |
| Expected LWIN7 exact | 5/6 | 0/6 |
| Expected LWIN7 conflict | 1/6 | 2/6 |
| Expected LWIN7 omitted | 0/6 | 4/6 |
| Source/attribution/methodology fields detected | 0/20 | 0/20 |

Important observations:

- Grapeminds initially returned `404` with `generating: true` for every drinking
  period. All 20 became available on a later run. The API period's
  numeric unit and anchor are not specified in the OpenAPI schema, so the
  application must not convert it into calendar years without written
  confirmation.
- Grapeminds returned no pairing object for any sample row. Its drinking-window
  statements have full coverage, but the provider markets AI-powered data and
  does not expose per-claim provenance or methodology in these responses.
- WineAPI followed its documented `X-Update-Status` and `Retry-After` contract.
  Once pending updates completed, pairing coverage remained 9/20.
- WineAPI's first search result is not a safe identity match. In six deliberately
  difficult spot checks, the known wine was absent from all five returned
  suggestions. Confidence values therefore cannot replace CellarManager's
  canonical LWIN match and owner review.
- Provider search is candidate discovery only. No advice may be attached as an
  exact claim until the candidate is linked to a reviewed wine-reference entity.
  Appellation/style fallback advice must be separately labelled and carry lower
  confidence.

### Owner review

The owner completed all 80 review fields on 2026-08-21:

| Owner verdict | Grapeminds identity | Drinking window | WineAPI identity | Pairing |
|---|---:|---:|---:|---:|
| Exact / useful | 12 | 12 | 4 | 5 |
| Fallback / questionable | 3 | 5 | 3 | 2 |
| Wrong / unusable | 5 | 3 | 13 | 13 |

Eleven of the 12 exact Grapeminds identities had a useful drinking window. Of
the five wrong Grapeminds identities, none had a useful window. Eleven of the
13 wrong WineAPI identities had unusable pairings. Identity quality therefore
controls advice quality and cannot be hidden inside a single confidence score.

The owner also identified three design requirements:

- the adversarial cohort intentionally over-represents difficult wines, so a
  mainstream control cohort is required before estimating normal coverage;
- red, white, and rose contradictions materially change the advice and must be
  hard blockers;
- vintage is crucial to drinking evolution. A provider response that omits the
  vintage is product-level guidance even when the query contained a vintage.

The second cohort will use mainstream, already reviewed products with paired
vintages. It must report both identity coverage and whether the provider returns
meaningfully release-specific evidence instead of repeating one product-level
window across vintages.

### Mainstream paired-vintage control

The Grapeminds control run used six already reviewed products, each represented
by two vintages (12 rows total):

- all 12 searches returned the expected LWIN7 product;
- no red/white/rose conflict was returned;
- all 12 responses were limited to `product-only` because the provider returned
  no vintage evidence;
- eight windows were immediately available and four were still generating;
- for every one of the four product pairs with complete windows, both vintages
  used the same provider wine ID and received an identical window payload.

This supports the owner's observation that mainstream identity is substantially
more reliable. It also confirms that Grapeminds does not distinguish vintages in
the tested API. Its windows may be evaluated as clearly labelled product/style
fallback guidance, but not as exact-release drinking windows. Completing the
pending four responses would not change that scope result, so no quota is spent
merely to repeat product-level content.

The WineAPI mainstream control remains pending until its daily free quota
renews. Its purpose is pairing coverage and colour/vintage safety, not drinking
windows, which the API does not publish.

These reviewed results do not select either provider for production.

## Revised inference-first path

The provider trial is conclusive enough to reject a provider-first architecture
for v0.4:

- Grapeminds is useful as a mainstream product-identity and product-level
  drinking-window benchmark, but the tested endpoint does not distinguish
  vintages and its content cannot be stored or reused under the published
  terms;
- WineAPI is useful as a pairing benchmark only, but its exact-wine identity
  and adversarial coverage are insufficient for automatic use;
- higher-authority exact-release sources are commercially inaccessible for the
  current personal deployment.

CellarManager will therefore first test a curated internal knowledge model that
combines place, vintage, producer, cuvée, and owner observations. Web and
provider records become attributed evidence inputs rather than mandatory
runtime answers. Pairing uses the same wine profile through a separate,
explainable dish-compatibility projection.

The private 20-wine run, model boundaries, validation page, and decision
thresholds are documented in
[`enrichment-inference-poc.md`](enrichment-inference-poc.md). This POC creates
no production table or household mutation. The completed owner review passed
the maturity threshold (17/20 useful, none wrong) and found the result more
accurate than the complete provider trial. Pairing was safer than the provider
trial but remains below its production threshold (6/10 useful, none wrong), so
the architecture proceeds while pairing corrections and revalidation remain an
explicit 0.4.9 acceptance gate.

## Candidate assessment

| Source | Relevant capability | Technical/access evidence | Rights evidence | Current decision |
|---|---|---|---|---|
| [Grapeminds Public API](https://www.grapeminds.eu/wine-api) | LWIN-aware identity and drinking periods; pairing schema exists | Free trial tier; official OpenAPI; 20/20 trial windows after asynchronous generation, but 0/20 pairings; numeric period semantics and per-claim provenance are unspecified | [Public API terms](https://www.grapeminds.eu/terms-publicapi) restrict the API to business customers/internal use and prohibit storage and reuse without prior written consent; persistent dataset licences have additional dashboard-only terms | Drinking-window benchmark only; written eligibility, methodology, semantics, and rights required |
| [WineAPI.io](https://wineapi.io/) | LWIN field and structured pairing items with confidence | Free personal tier and paid business tier; official OpenAPI; 9/20 trial pairing coverage; exact identity search was unreliable; no drinking-window endpoint | [Public terms](https://wineapi.io/terms) prohibit raw-response redistribution but do not explicitly resolve cache, offline, retention, attribution, or shared reuse | Pairing benchmark only; not safe for automatic identity |
| [Jancis Robinson API](https://www.jancisrobinson.com/jancis-api) via Liv-ex | Expert exact-release drinking windows, scores, notes, LWIN identity | Over 195,000 reviews and direct LWIN indexing | Access requires a company, Liv-ex membership, pricing enquiry, and negotiated rights; private individuals are explicitly ineligible | Preferred authority benchmark; access blocked |
| [EtOH API](https://etoh.digital/en/api-etoh-cloud/) | Oenologist-reviewed appellation/style pairing guidance | Paid API from EUR 30/month; provider states R&D verification and application/e-commerce use | Published page does not resolve cache, offline, retention, attribution, or shared reuse; provider-issued access required | Preferred pairing contact; trial blocked |
| [Wine-Searcher](https://www.wine-searcher.com/) | Broad exact wine pages with drinking windows and pairings | Strong visible coverage, but no published self-service knowledge API suitable for this workflow | Scraping is not acceptable; API/customer-facing reuse requires a commercial agreement | Contact-only fallback |
| [Wine Labs API](https://winelabs.ai/api/docs) | LWIN matching and average critic windows | Published API exposes critic windows and canonical profiles | [General terms](https://winelabs.ai/terms) do not grant customer-facing retention/reuse; API access and source entitlements require agreement | Contact-only fallback |
| [CellarTracker](https://support.cellartracker.com/article/80-cellartracker-subscription) | Community/professional windows and style-based pairing | Excellent consumer product coverage; subscription feature | No public enrichment API or redistribution licence | Rejected for integration |
| [Spoonacular wine pairing](https://spoonacular.com/food-api/docs#Dish-Pairing-for-Wine) | Generic grape/style-to-dish pairing | Official endpoint accepts types such as Merlot or Riesling, not an exact wine identity | Not sufficient as the required exact/attributed source | Possible style fallback only |

## Preliminary complementary path

- **Drinking windows:** Jancis/Liv-ex is the authority benchmark because it is
  expert-authored and LWIN-native. It cannot be selected for this personal
  deployment unless the provider offers an eligible contract. Grapeminds is
  the trialable product-level alternative, but its published schema exposes no
  vintage. It cannot supply an exact-release window unless a different licensed
  endpoint returns release evidence. Explicit persistent display/storage rights
  and methodology are also required.
- **Food pairings:** EtOH is the preferred editorial contact because it states
  that its pairing data is checked by an oenology R&D function. WineAPI was the
  immediately trialable structured alternative, but its adversarial identity
  accuracy and 9/20 pairing coverage are insufficient for automatic use.

No source is selected for production. A provider that fails the rights gate may
still be a quality benchmark, but its content will not enter CellarManager.

## Written questions that must be answered

The provider's written response or contract must address:

1. customer-facing use in CellarManager and, if relevant, its open-source or
   self-hosted distribution model;
2. storage of provider IDs, normalized claims, attribution, and retrieval time;
3. positive/negative caching duration and raw-response retention;
4. offline synchronization to a household's devices;
5. reuse of one licensed claim across households versus per-account licensing;
6. mandatory attribution text, link, logo, or placement;
7. creation and display of clearly labelled nearby-vintage or style estimates;
8. deletion or continued-display obligations after subscription termination;
9. rate limits, retry rules, service expectations, and production price;
10. whether each drinking window or pairing is expert-authored, source-derived,
    algorithmic, or AI-generated, and what provenance the API returns.

## Completion evidence

The 0.4.5 decision is complete when:

- the two trialable adapters have been run over the private 20-wine sample;
- the owner has reviewed candidate identities and advice quality;
- a mainstream cohort with paired vintages has measured ordinary coverage,
  colour safety, and release-specific behaviour;
- coverage and failure counts are documented only in aggregate;
- provider rights are either complete or explicitly recorded as an access
  blocker, with no provider accidentally marked production-eligible;
- the inference POC has a complete private owner review and records each
  capability's pass/fail outcome without weakening its threshold;
- the roadmap and architecture decision identify the accepted production path
  and preserve unresolved pairing work as a later acceptance gate.
