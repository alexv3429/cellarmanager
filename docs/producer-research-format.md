# Producer research package: exchange format v1

The owner-supplied Burgaud package is the first test of a reusable **research
exchange format**, not a published CellarManager reference or an inventory
import. Its `burgaud_research.json` envelope uses
`cellarmanager.research.domaine.v1` and version `1.0.0`. The accompanying CSVs
are review views; the JSON is authoritative within the package. The included
JSON Schema only checks the envelope and is not a publication validator.

Run the repository's read-only validation and inspect one calibrated release:

```bash
node scripts/drinking_window/producer_research_package.mjs /path/to/burgaud_research.json
node scripts/drinking_window/producer_research_package.mjs /path/to/burgaud_research.json morgon_james 2022 2025,2028,2035
```

The output is a **review dossier**, not SQL. It cannot change `public.wines`,
`enrichment_profiles`, drinking-window rows, or the advice shown in the app.
The validator requires unique source and cuvée IDs, valid source pointers,
three ordered years for exact calibrations, 0–5 structure estimates where
modeled, and an explicit warning that a modeled vintage range does not prove
production. Special products may have no ages or structure; they cannot borrow
nearby cuvée dates. A research source can provide an HTTPS pointer but never
grant itself publication rights.

## What each layer means

| Research-package layer | CellarManager destination after review | Never infer from it |
| --- | --- | --- |
| Producer, cuvée, appellation, colour, historical name | Confirmed `wine_reference_*` identities and reviewed aliases/supersessions | A household wine link or release merely from a similar name |
| Base relative ages, producer era, vintage effect | Evidence/context for a proposed three-year row or existing additive maturity profile | A published date for every vintage in the modeled range |
| Exact cuvée × vintage calibration | Candidate for one `release`-scope drinking-window row with **all three years together** | That its sources published those exact years |
| Structure 0–5 and pairing hypotheses | Separate enrichment/pairing review, after canonical dish mapping | A tasting observation or a producer-endorsed food match |
| External drinking observations | Pointer-only contextual evidence with its original “drink” semantics | Equality between a critic's drinking span and our probable optimum |
| Rename event | Curated, vintage-bounded identity relationship | Automatic pre/post-2024 product merger |

The canonical producer, product, release, appellation, region and colour IDs
remain to be confirmed in CellarManager. A proposed `ageing_group_key` is only
a hint. The shared drinking-window policy still decides applicability and
precedence. For a release-level candidate, neither a regional group nor a
vintage modifier replaces the cuvée-specific three-year decision. A private
manual window continues to outrank shared advice.

## Burgaud pilot conflict to resolve

The package proposes **James 2022: 2026 / 2032–2042** and **Côte du Py 2022:
2025 / 2029–2040**. The existing unpublished pilot puts **both** in one
long-ageing regional group at **2025 / 2028–2035**. These are materially
different candidates, not interchangeable descriptions of one reference.
Do not approve or publish the regional row unchanged merely because the
producer calls both wines suitable for ageing. The producer's own [wine
descriptions](https://jean-marc-burgaud.com/nos-vins) support relative ageing
potential but do not supply any of those exact calendar years. The Burgaud
package identifies its years as research estimates, and its James 2022
calibration cites a producer-level importer page and a page about a different
cuvée/vintage. Those links are context, not proof of James 2022's three years.

For the next review, resolve the two conflicting date sets with the owner;
verify each release and its source fit separately; then stage separate
release-scoped proposals if accepted. Do not allow the James candidate to
cover Les Charmes, a different vintage, a magnum, or an unlinked cellar wine.
All package rights and curator checks remain open. No source text is copied
into the shared database by this format.

The owner considers the package's cuvée-specific research more polished than
the earlier regional estimate. That is a **preference for the candidate to
review**, not a curator decision or adoption of the exact years. The older
2025 / 2028–2035 pilot dates came from the owner's earlier Beaujolais Cru 2022
category estimate; they were never a Burgaud or James-specific source claim.

This validation step does not settle the estimates or activate a reference.
Publication still requires the existing curator decisions, whole-cellar owner
comparison, publication preflight and household opt-in described in the
[release plan](drinking-window-release-plan.md).
