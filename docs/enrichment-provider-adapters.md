# Adding licensed enrichment providers

The bundled providers use OpenAI web search directly or Brave Search followed by OpenAI structured extraction. Commercial datasets such as professional exchange prices, auction results or proprietary critic feeds normally require a contract, credentials and vendor-specific usage terms. They should be added as explicit adapters rather than scraped.

## Contract

An adapter must return the same normalized research document used by `OpenAIResearchProvider.research`:

```python
class LicensedProvider:
    name = "vendor_name"

    def research(self, wine, topics, locale):
        return parsed_document, provider_sources, usage, raw_response
```

The normalized document is validated conceptually against `_research_schema()` and must distinguish exact producer, cuvée, vintage and format matches. Market offers must retain listed currency, bottle count, tax/stock state, observation date and market type.

## Rules

- Keep vendor credentials in environment variables or a secret manager.
- Do not log or return credentials.
- Retain vendor source IDs and URLs where the contract permits it.
- Do not store full copyrighted tasting notes; store normalized facts and short excerpts.
- Never mix vintages, formats or currencies silently.
- Document whether a value is retail, secondary market, auction or derived quick-sale value.
- Add deterministic unit tests with recorded/synthetic responses. Ordinary CI must never call the vendor.
- Add a provider-health status without exposing secrets.

## Registration

Extend `provider_status()` and `get_provider()` in `backend/app/services/internet_enrichment.py`, add configuration variables in `backend/app/config.py`, and document the required environment settings. Keep the existing candidate review and persistence pipeline so all providers receive the same audit trail and confidence calculation.

## LWIN and other identifiers

External identifiers belong in `wine_external_identifiers`. An identifier is a matching aid, not proof that every attached price belongs to the exact vintage and format; those dimensions must still be checked for each observation.
