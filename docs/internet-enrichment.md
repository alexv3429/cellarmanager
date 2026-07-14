# Evidence-backed Internet and AI enrichment

CellarManager can research a bottle online for drinking windows, current market observations, food pairings, serving advice, composition, short critic metadata and external identifiers. The design deliberately separates **AI assistance** from **evidence**:

- the model searches, matches, extracts and explains;
- every factual candidate keeps clickable source URLs returned by the configured search provider; model-invented URLs are discarded;
- identity, vintage and bottle-format matching affect a deterministic confidence score;
- observed prices are stored individually before any median is calculated;
- inferred pairing or serving advice is labelled as inference;
- nothing is written to the accepted wine record until a user accepts a candidate;
- automatic application never replaces an existing user value; the review screen can explicitly replace it when the user chooses **Accept**.


## Escalation order and credential-aware availability

CellarManager exposes only options that are currently usable:

| Level | Mode | Availability |
|---|---|---|
| 4 | Manual ChatGPT escalation | Enabled by default; no API credential required |
| 5 | Automatic OpenAI-backed research | Shown only when all credentials for that provider are present |

A missing credential does not make the whole enrichment feature fail. The
backend skips that provider and checks the next configured automatic provider.
For example, `brave_openai` is ignored when `BRAVE_SEARCH_API_KEY` is absent;
`openai_web` can still be used when an OpenAI key is present. When no OpenAI key
is available, all level-5 providers are omitted and the level-4 manual workflow
remains available.

```dotenv
WINECELLAR_MANUAL_CHATGPT_ENABLED=true
WINECELLAR_ENRICHMENT_PROVIDER=brave_openai
WINECELLAR_ENRICHMENT_AUTOMATIC_PROVIDER_ORDER=brave_openai,openai_web
```

`GET /enrichment/status` returns `available_providers` in escalation order,
`requested_provider` for the configured preference, and `automatic_provider`
for the provider that automatic jobs will actually use. The legacy `provider`
field now reports the effective automatic provider when a fallback is selected.
The existing `configured` field continues to mean that an automatic provider
is available.

### Manual ChatGPT workflow

1. Call `POST /wines/{wine_id}/research/manual-chatgpt` with the requested
   topics and locale.
2. CellarManager returns a self-contained prompt and strict response schema.
3. Run that prompt in ChatGPT manually and copy the returned JSON.
4. Submit it to `POST /wines/{wine_id}/research/manual-chatgpt/import`.
5. CellarManager validates the shape, rejects unsafe evidence URLs, recalculates
   confidence deterministically and creates the normal review candidates.

The imported response is never accepted directly as trusted cellar data. It
passes through the same candidate review and explicit acceptance process as an
automatic result. Manual jobs record provider `manual_chatgpt`, consume zero
automatic API tokens, and do not consume the automatic daily job allowance.
Manual imports can never auto-apply: every candidate must be accepted explicitly.

In the wine research dialog, **Prepare for ChatGPT** remains visible when no
automatic provider is configured. The automatic **Start research** action is
omitted whenever its required credentials are incomplete.

## Provider modes

### OpenAI web search

```dotenv
OPENAI_API_KEY=...
WINECELLAR_ENRICHMENT_PROVIDER=openai_web
WINECELLAR_OPENAI_MODEL=gpt-5.5
```

The backend calls the OpenAI Responses API with the hosted `web_search` tool and strict JSON Schema output. Source URLs returned by the web-search call are persisted and shown as clickable citations.

### Brave Search plus OpenAI extraction

```dotenv
OPENAI_API_KEY=...
BRAVE_SEARCH_API_KEY=...
WINECELLAR_ENRICHMENT_PROVIDER=brave_openai
```

Brave discovers pages and supplies snippets; OpenAI performs strict structured extraction over those results. CellarManager does not scrape merchant or critic HTML directly.

## Optional controls

```dotenv
# Corporate TLS interception / Zscaler: path to the organisation-approved CA.
WINECELLAR_ENRICHMENT_CA_BUNDLE=/path/to/company-ca.pem

# Restrict OpenAI web search to specific domains. Leave empty for broad search.
WINECELLAR_ENRICHMENT_ALLOWED_DOMAINS=producer.example,liv-ex.com

WINECELLAR_ENRICHMENT_TIMEOUT_SECONDS=90
WINECELLAR_ENRICHMENT_MAX_JOBS_PER_DAY=20
WINECELLAR_ENRICHMENT_MAX_TOKENS_PER_MONTH=500000
WINECELLAR_ENRICHMENT_MAX_SOURCES=12
WINECELLAR_ENRICHMENT_MAX_PAIRINGS=8
WINECELLAR_ENRICHMENT_MAX_SEARCH_QUERIES=4
WINECELLAR_ENRICHMENT_SEARCH_CONTEXT_SIZE=medium
WINECELLAR_ENRICHMENT_AUTO_APPLY_THRESHOLD=0.90

# Disabled by default because raw model responses may contain more provider data
# than the application needs. Evidence and normalized candidates are always kept.
WINECELLAR_ENRICHMENT_STORE_RAW_RESPONSE=false
```

Never disable TLS verification. When a corporate proxy intercepts HTTPS, use the CA bundle supplied by the organisation.

Only the wine identity and requested topics are sent to the configured provider; cellar names, locations, users and authentication data are not included. Search content and model output are treated as untrusted: strict schemas are validated, model-invented evidence URLs are discarded, factual candidates require a URL returned by the search provider, and no candidate is automatically allowed to replace a manual value.

## User workflow

For automatic research, the workflow remains:

1. Open **Bottles** and select **Research online**.
2. Choose topics.
3. CellarManager creates a durable job record and performs the work in a FastAPI background task.
4. The browser polls the job and shows candidates when complete.
5. Open the source list for each candidate.
6. Compare each proposal with the currently stored value, then accept or reject it individually. Replacing a current value requires an explicit confirmation.
7. Accepted drinking windows, replacement value, pairing and serving advice update the normal wine fields. Richer data stays in the enrichment profile. Automatic application preserves existing manual fields.

Background tasks survive page navigation but not a server process crash. A failed or interrupted job remains visible and can be run again. For a larger deployment, replace the in-process task runner with a dedicated worker while keeping the same tables and endpoints.

## Value semantics

The engine distinguishes:

- **Retail replacement value**: median current exact-format retail offer.
- **Secondary-market value**: median secondary or auction observation.
- **Quick-sale estimate**: a clearly labelled conservative derivative, not a quote.

Offers are normalized per bottle, but different currencies are never silently converted. A pack is divided by its bottle count. A known mismatched bottle format is excluded rather than scaled linearly. Tax, stock status, observation date and market type remain visible.

## Confidence

Confidence is calculated by the backend from:

- canonical wine identity match;
- source type and reliability;
- exact producer, cuvée, vintage and format match;
- independent-source count;
- agreement between observations;
- freshness;
- a penalty for inference.

The model cannot directly choose the final confidence score. Sources pasted through
the manual ChatGPT route are recorded as unverified manual evidence, and manual
candidate confidence is capped below the high-confidence range until a user reviews it.

## Data model

The startup schema creates:

- `enrichment_jobs`
- `enrichment_sources`
- `enrichment_candidates`
- `market_observations`
- `wine_enrichment_profiles`
- `wine_external_identifiers`

API keys are environment variables only. They are not stored in these tables.

## API

- `GET /enrichment/status`
- `POST /wines/{wine_id}/research`
- `POST /wines/{wine_id}/research/manual-chatgpt`
- `POST /wines/{wine_id}/research/manual-chatgpt/import`
- `GET /enrichment/jobs/{job_id}`
- `GET /wines/{wine_id}/research/history`
- `GET /wines/{wine_id}/enrichment-profile`
- `POST /enrichment/candidates/{candidate_id}/decision`
- `POST /recommendations?explain=true` — recommendations plus hard-filter diagnostics

Example request:

```json
{
  "topics": ["drinking_window", "market_value", "pairing", "serving"],
  "locale": "fr",
  "background": true,
  "auto_apply": false
}
```

## Provider terms and copyright

Use providers under their terms. CellarManager stores normalized facts, URLs and short evidence excerpts; it does not store full proprietary tasting notes. A licensed professional data provider can be added later behind the same provider interface.

## Testing without Internet

Unit tests inject a fake transport and a deterministic structured response. CI never calls OpenAI, Brave, merchants or critics. Live provider tests must be opt-in and must not run on ordinary pull requests.

## Recommendation integration

Accepted pairing, maturity, composition, review and replacement-value data feed the daily-picks ranking. Cellar, color, vintage, appellation and date remain hard filters. Dish and occasion are ranking signals by default, so selecting **Casual** no longer discards every wine whose notes do not literally contain that word. Users can explicitly enable strict dish matching. When no bottle is returned, the UI reports how many holdings were examined and which hard filters excluded them.

The predefined occasions are Casual, Everyday, Important, Celebration and Discovery. Their scoring is deterministic and explained in each recommendation. For example, Casual favors ready bottles, sensible replacement value and stock with several bottles available; Celebration can favor accepted high scores, special-bottle value and celebration pairings.

## What is intentionally not bundled

A Liv-ex, auction-house or critic adapter that requires a commercial contract is not hard-coded without the vendor's licensed API schema and credentials. The provider interface and external-identifier tables are ready for such adapters. Do not scrape protected sites or bypass access controls.

The built-in valuation is an evidence-backed estimate, not an appraisal or guaranteed sale price. It does not convert currencies, infer provenance, inspect bottle condition or calculate auction fees unless a source explicitly supplies those facts.
