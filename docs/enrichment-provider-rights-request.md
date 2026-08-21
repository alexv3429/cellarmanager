# Enrichment provider rights request

Status on 2026-08-21: **drafts only; not sent**.

Step 0.4.5 cannot select a production enrichment provider from API behaviour or
marketing pages alone. The provider must answer the relevant draft below in
writing. Store the dated reply or contract reference in the provider policy;
do not commit private correspondence or credentials.

CellarManager is an open-source cellar application. Its hosted deployment can
serve multiple independent households. The intended wine-reference library
retrieves a claim once, records its provider and retrieval time, and may reuse
that normalized claim for the same reviewed wine across authorized households.
The application must also remain useful while a device is temporarily offline.

## Grapeminds

Send through the official [Grapeminds contact form](https://www.grapeminds.eu/contact).

Subject: Written API usage rights and drinking-period methodology for CellarManager

> Hello,
>
> I am evaluating the Grapeminds Public API for CellarManager, an open-source
> wine-cellar application with a hosted deployment for independent households.
> A private 20-wine technical trial found strong drinking-period coverage after
> asynchronous generation. Before selecting a production provider, could you
> please confirm the following in writing?
>
> 1. Is this open-source/hosted project eligible under your “business customer”
> and “internal purposes” terms, and which plan or agreement is required?
> 2. May the server display normalized drinking-window claims to end users and
> retain the provider wine ID, normalized claim, attribution, and retrieval time?
> 3. What cache duration and raw-response retention are allowed? May normalized
> claims be available on household devices during temporary offline use?
> 4. May one licensed claim for a reviewed wine be reused across independent
> households, or must it be fetched/licensed separately per household?
> 5. What attribution text, link, or logo is mandatory, and what happens to
> retained claims after subscription termination?
> 6. The published wine and drinking-period schemas contain no vintage field.
> Are these periods intentionally product-level? Is a vintage-specific endpoint
> available? Are `from` and `to` bottle-age offsets, calendar years, or another
> unit, and what event anchors the period for non-vintage wines?
> 7. Are the drinking-period numbers and statements expert-authored,
> source-derived, algorithmic, or AI-generated? Can the API provide claim-level
> methodology/source provenance and a confidence or review status?
> 8. The trial returned no pairing object for 20 wines. Is pairing generation a
> separate endpoint, plan, or process?
>
> Thank you. A written answer will be used only to decide whether CellarManager
> can integrate the API within the permitted scope.

## WineAPI.io

Send to `hello@wineapi.io` or through the official
[enterprise contact form](https://wineapi.io/contact-enterprise).

Subject: Pairing-data rights, provenance, and identity workflow for CellarManager

> Hello,
>
> I am evaluating WineAPI.io for CellarManager, an open-source wine-cellar
> application with a hosted deployment for independent households. A private
> technical trial used the documented pending/retry flow and returned structured
> pairings for 9 of 20 deliberately difficult wines. Before selecting a paid
> production plan, could you please confirm the following in writing?
>
> 1. Which plan permits this open-source/hosted customer-facing use?
> 2. May the server retain and display normalized pairing claims together with
> the WineAPI wine ID, attribution, confidence, and retrieval time?
> 3. What positive/negative cache duration and raw-response retention are
> allowed? May normalized claims be synced for temporary offline use?
> 4. May one licensed normalized pairing claim be reused across independent
> households linked to the same reviewed wine, or is use account/request scoped?
> 5. What attribution is required, and what deletion or continued-display rules
> apply after subscription termination?
> 6. What sources and methodology produce the pairing items, notes, and
> confidence? Are they expert-authored, source-derived, algorithmic, or
> AI-generated, and can claim-level provenance be returned?
> 7. Search performed poorly on ambiguous producer/cuvée inputs in the trial.
> Is `/identify/text` the recommended non-mutating production matcher, can it be
> constrained by vintage/appellation/LWIN, and can automatic catalogue creation
> be disabled?
> 8. Are pairings generated at product or vintage-release level? If vintage is
> considered, what returned field proves which vintage informed the claim?
>
> Thank you. A written answer will be used only to decide whether CellarManager
> can integrate WineAPI.io within the permitted scope.

## EtOH

Use the official [EtOH API contact route](https://etoh.digital/en/api-etoh-cloud/).

Subject: Evaluation access and food-pairing licence for CellarManager

> Hello,
>
> I am evaluating food-and-wine pairing providers for CellarManager, an
> open-source cellar application with a hosted deployment for independent
> households. Your published material states that EtOH pairing data is checked
> by an oenology R&D function. Could you provide evaluation access and written
> terms covering customer display, normalized-claim retention, cache duration,
> temporary offline use, attribution, cross-household reuse, raw-response
> retention, and post-termination obligations?
>
> Please also describe the pairing request keys (exact wine, appellation, style,
> grapes, or other), response granularity, language coverage, editorial
> methodology, claim-level provenance, update cadence, not-found behaviour,
> production quotas, and pricing for this use case.

## Recording a reply

A provider reply is usable evidence only when it clearly identifies the sender,
date, applicable service/plan, and permitted scope. Convert each answer into the
explicit rights fields in `scripts/enrichment/provider_policy.mjs`. Keep a right
as `unknown` or `contract-required` when the answer is silent or conditional.
