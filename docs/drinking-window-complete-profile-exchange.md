# Gate 3 — complete profile exchange (PR slot 4/6)

This implements the [six-gate product contract](drinking-window-product-contract.md),
not a new release plan. It does not import the owner's 23 files into a live
database, publish a reference, or change a cellar's advice.

## Exchange formats

- Producer: [v1.1 schema](schemas/producer_exchange_v1.schema.json) and
  [example](examples/producer-research-template.json). The whole file is
  retained, including cuvée history, grape/style/structure facts, pairing
  observations, source pointers, release-existence evidence and three-date
  proposals. A proposal is not treated as producer-published dates.
- Appellation and region: [place schema](schemas/place_exchange_v1.schema.json),
  [appellation example](examples/appellation-profile-template.json) and
  [region example](examples/region-profile-template.json). A named ageing
  group must state its scope, colour, explicit members, vintage-specific
  three-date windows and source context. A region never borrows another
  region's dates.

The optional non-date facts are preserved in a curator-private immutable
archive and can be exported without losing fields. They are **not yet**
published or shown as official facts on wine cards. That presentation and
independent fact review must be designed before making them user-facing.

## Curator path

1. In the review workspace, choose a JSON file. Client validation checks the
   full schema, source references, duplicate release keys and ordered dates.
2. Save it to the private exchange archive. Re-importing identical content
   returns the same exchange; no advice changes. A curator can export the
   exact saved document.
3. Choose an unpublished working reference version. For producers, exact
   canonical names resolve automatically; the curator can explicitly select
   a producer and cuvée when spellings differ. Vintage, colour, place and
   bottle size are independently checked. For appellations and regions,
   place/member names must resolve uniquely to existing canonical identities;
   otherwise the affected group is quarantined and its source file can be
   corrected or the canonical identity created through the existing curation
   tools. No fuzzy match is silently accepted.
4. Preview each proposed change. A valid new row is *ready*, an already
   staged identical row is *unchanged*, and an unresolved or conflicting row
   is *quarantined* with a reason. A whole place group is quarantined if any
   member or window is invalid. The curator explicitly reviews linked source
   pages, records a reason and authorizes sharing the ready entries as
   editorial estimates. A fingerprint makes stale previews fail. The staging
   transaction is all-or-nothing for the ready entries; quarantined entries
   remain visible in the complete archive for correction and re-import.
5. Staging creates reviewed rows/groups in the draft but publishes nothing.
   The curator must run the existing zero-issue draft preflight, inspect its
   whole-cellar impact preview and publish in a separate action. Private
   cellar choices still take precedence.

## Limits and next gate

Gate 4, slot 5/6, will process all 23 supplied producer files and reviewed
appellation/region fallbacks against a staged/restored catalogue. It must
produce a file-and-row manifest of ready, unchanged and excluded entries,
with each exclusion reason, before any real shared base is published. Gate 5
handles authorized migration, deployment, initial publication and postflight.
The [living release record](drinking-window-release-plan.md) tracks those
remaining actions; no new PR slot is implied here.
