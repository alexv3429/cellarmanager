# Catalog coverage and curation demand

Roadmap step 0.4.13 turns enrichment gaps into visible, prioritized work. Step
0.4.14 now consumes eligible items through a separate reviewed research
lifecycle; neither step silently fills household facts.

## Coverage is reason-aware

The catalog keeps three kinds of work separate:

1. **Household facts** are values owned by one household wine. The compact core
   coverage measure uses country, grapes, and sweetness because those three are
   broadly useful for discovery and pairing. Label alcohol is still searchable
   and queued as a lower-priority suggestion; classification, vineyard, and
   certifications are not treated as universally required.
2. **Shared profiles** are reviewed library layers used by maturity and pairing.
   Coverage reads the exact contribution trace stored with the current
   projection: place, vintage, producer era, and cuvée. It never guesses layer
   coverage from the confidence percentage. An exact release remains an
   optional refinement rather than a completeness requirement.
3. **Cellar-data issues** require the owner to correct or confirm the stored
   wine first—for example, add a vintage or resolve an appellation/color
   conflict. They are not mislabeled as missing shared knowledge.

An unsupported appellation-and-color profile is shared-library work. A wine
already assessed through a safe broader profile stays usable while missing
vintage, producer, or cuvée layers are queued for refinement.

## Catalog experience

Free-text search includes producer, cuvée, vintage, color, appellation, region,
country, classification, vineyard, grape names and percentages, sweetness,
label alcohol, certifications, and bottle format. The compact filter row keeps
stock, vintage, and drinking state visible. An expandable group adds color,
area, country, sweetness, core-fact coverage, and profile-depth filters.

The coverage section summarizes the current household and keeps the detailed
queue collapsed by default. This matters on phones and for large imported
cellars. Queue actions filter the existing catalog instead of opening a second
wine list. Offline use retains synchronized fact search and fact coverage;
profile traces and the queue refresh after reconnect.

## Priority and privacy

The household UI derives its queue from synchronized wines and the member-only
maturity overview. Items are grouped by normalized subject and ranked primarily
by affected in-stock bottles, then affected wines and the kind of gap. This
makes one missing producer profile that affects many bottles more useful than a
rare optional label-alcohol value.

The service-only `get_shared_knowledge_curation_queue(integer)` RPC performs the
same kind of aggregation across households for the future research worker. It
returns only normalized subjects, gap kinds, aggregate household/wine/bottle
counts, and an impact score. It does not return household IDs, wine IDs, member
IDs, holdings, locations, notes, or credentials. Browser roles cannot execute
it.

The global queue is computed from current facts, demands, and projection traces
instead of being copied into a mutable second source of truth. A resolved gap
therefore disappears after facts are explicitly accepted or a reviewed
knowledge version rebuilds the affected projections.

## Reviewed-research hand-off

Step 0.4.14 consumes an owner-selected queue item to:

- research only allowlisted sources with suitable access and reuse terms;
- retain URLs, retrieval time, scope, and the exact subject researched;
- generate an attributable draft rather than active knowledge;
- notify the affected owner and show the proposal for review and editing;
- publish shared profiles only through the trusted immutable knowledge-version
  workflow.

The queue now provides separate **Show wines** and **Request research** actions.
The research inbox shows each request, source, proposal, owner verdict, and
publication status. An identity-blocked producer request offers reviewed LWIN
producer identities independently of exact cuvee coverage; other identity
gaps link to their representative wine's reference review. Either route
resumes automatically after confirmation. Cellar-data issues never offer research. See
[`reviewed-enrichment-research.md`](reviewed-enrichment-research.md) for source
rights, canonical identity, worker, and publication boundaries.

Nothing in either step authorizes hidden background knowledge publication or
direct overwriting of household facts.

## Acceptance

- search every rich fact without horizontal catalog overflow;
- combine stock, vintage, maturity, rich-fact, and profile-depth filters;
- show exact missing profile layers even when confidence is high or low;
- keep missing vintage and identity conflicts separate from library gaps;
- group and prioritize queue items by affected wines and bottles;
- filter the catalog from a queue item and clear that filter normally;
- retain fact search offline and explain why profile coverage needs connectivity;
- deny the global queue to browser roles and omit household/wine identifiers;
- preserve all wine, holding, bottle, cellar, and location rows during migration;
- keep the coverage and queue usable on desktop and phone.
