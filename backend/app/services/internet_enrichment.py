"""Evidence-backed Internet and AI enrichment for wine records.

The language model is used to search, match, extract and explain. It is never
used as an untraceable source of truth: factual candidates retain source URLs,
identity-match components, deterministic confidence scores and a review state.

Three enrichment modes are supported:

* ``manual_chatgpt``: prepare a self-contained prompt, then validate and import
  the JSON response without an API credential.
* ``openai_web``: OpenAI Responses API with the hosted ``web_search`` tool.
* ``brave_openai``: Brave Search API for discovery, followed by OpenAI
  Structured Outputs over the returned snippets.

No site HTML is scraped by CellarManager. This avoids brittle parsers and makes
provider terms, costs and credentials explicit configuration choices.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import ssl
import statistics
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app import config
from app.core.domain import Movement, MovementAction, Wine, new_id, utcnow
from app.storage import enrichment_repository as er
from app.storage import repositories as repo
from app.storage.database import Database

TOPICS = {
    "drinking_window",
    "market_value",
    "pairing",
    "serving",
    "composition",
    "reviews",
    "identifiers",
}

SOURCE_RELIABILITY = {
    "producer": 0.92,
    "official_appellation": 0.86,
    "critic": 0.86,
    "market_data": 0.90,
    "auction": 0.78,
    "merchant": 0.68,
    "community": 0.52,
    "editorial": 0.62,
    "unknown": 0.42,
    "unverified_manual": 0.25,
    "ai_inference": 0.34,
}

MANUAL_CONFIDENCE_CAP = 0.69
MAX_MANUAL_RESPONSE_ITEMS = 100
MAX_MANUAL_TEXT_LENGTH = 4_000
MAX_CANDIDATE_EDIT_BYTES = 64_000


class EnrichmentError(RuntimeError):
    """Base exception with a stable API-facing error code."""

    code = "enrichment_error"


class EnrichmentNotConfigured(EnrichmentError):
    code = "enrichment_not_configured"


class EnrichmentBudgetExceeded(EnrichmentError):
    code = "enrichment_budget_exceeded"


class ProviderRequestError(EnrichmentError):
    code = "enrichment_provider_error"


class ProviderResponseError(EnrichmentError):
    code = "enrichment_invalid_response"


@dataclass(frozen=True)
class ProviderOption:
    level: int
    provider: str
    mode: str
    label: str
    model: str | None = None
    search_provider: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "level": self.level,
            "provider": self.provider,
            "mode": self.mode,
            "label": self.label,
            "model": self.model,
            "search_provider": self.search_provider,
        }


@dataclass(frozen=True)
class ProviderStatus:
    configured: bool
    provider: str
    requested_provider: str
    automatic_provider: str | None
    model: str | None
    search_provider: str | None
    allowed_domains: list[str]
    available_topics: list[str]
    max_jobs_per_day: int
    max_tokens_per_month: int
    auto_apply_threshold: float
    manual_available: bool
    available_providers: list[dict[str, Any]]
    message: str


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: dict[str, Any]


Transport = Callable[[str, dict[str, str], dict[str, Any], float], HttpResponse]


def _ssl_context() -> ssl.SSLContext:
    cafile = config.ENRICHMENT_CA_BUNDLE or os.environ.get("SSL_CERT_FILE")
    if cafile:
        return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


def _post_json(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float,
) -> HttpResponse:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=_ssl_context()) as response:
            raw = response.read().decode("utf-8")
            return HttpResponse(response.status, json.loads(raw))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ProviderRequestError(f"Provider returned HTTP {exc.code}: {detail[:800]}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderRequestError(f"Provider connection failed: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ProviderResponseError("Provider returned invalid JSON") from exc


def _get_json(
    url: str,
    headers: dict[str, str],
    timeout: float,
) -> HttpResponse:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=_ssl_context()) as response:
            raw = response.read().decode("utf-8")
            return HttpResponse(response.status, json.loads(raw))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ProviderRequestError(
            f"Search provider returned HTTP {exc.code}: {detail[:800]}"
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderRequestError(f"Search provider connection failed: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ProviderResponseError("Search provider returned invalid JSON") from exc


def _validated_topics(topics: list[str]) -> list[str]:
    invalid = set(topics) - TOPICS
    if invalid:
        raise ValueError(f"Unknown enrichment topics: {', '.join(sorted(invalid))}")
    return sorted(set(topics)) or sorted(TOPICS)


def _automatic_provider_is_configured(provider_name: str) -> bool:
    if provider_name == "brave_openai":
        return bool(config.OPENAI_API_KEY and config.BRAVE_SEARCH_API_KEY)
    if provider_name == "openai_web":
        return bool(config.OPENAI_API_KEY)
    return False


def _automatic_provider_priority() -> list[str]:
    priority = [config.ENRICHMENT_PROVIDER, *config.ENRICHMENT_AUTOMATIC_PROVIDER_ORDER]
    return list(dict.fromkeys(priority))


def select_automatic_provider_name() -> str | None:
    """Return the first credential-complete automatic provider.

    Missing credentials remove a provider from consideration instead of making
    the entire enrichment feature fail. This lets a preferred Brave+OpenAI
    configuration fall back to OpenAI web search when only the OpenAI key is
    present, and it returns ``None`` when no automatic provider is usable.
    """
    return next(
        (
            provider_name
            for provider_name in _automatic_provider_priority()
            if _automatic_provider_is_configured(provider_name)
        ),
        None,
    )


def provider_options() -> list[ProviderOption]:
    """Return only currently usable enrichment options, in escalation order."""
    options: list[ProviderOption] = []
    if config.MANUAL_CHATGPT_ENABLED:
        options.append(
            ProviderOption(
                level=4,
                provider="manual_chatgpt",
                mode="manual",
                label="Manual ChatGPT escalation",
            )
        )
    for provider_name in _automatic_provider_priority():
        if not _automatic_provider_is_configured(provider_name):
            continue
        if provider_name == "brave_openai":
            options.append(
                ProviderOption(
                    level=5,
                    provider=provider_name,
                    mode="automatic",
                    label="Brave Search plus OpenAI extraction",
                    model=config.OPENAI_ENRICHMENT_MODEL,
                    search_provider="brave",
                )
            )
        else:
            options.append(
                ProviderOption(
                    level=5,
                    provider=provider_name,
                    mode="automatic",
                    label="OpenAI web research",
                    model=config.OPENAI_ENRICHMENT_MODEL,
                    search_provider="openai_web_search",
                )
            )
    return options


def provider_status() -> ProviderStatus:
    requested = config.ENRICHMENT_PROVIDER
    automatic_provider = select_automatic_provider_name()
    if automatic_provider == "brave_openai":
        message = "Brave Search and OpenAI are configured."
        search_provider = "brave"
    elif automatic_provider == "openai_web":
        message = "OpenAI web research is configured."
        search_provider = "openai_web_search"
    elif config.MANUAL_CHATGPT_ENABLED:
        message = (
            "No automatic provider has complete credentials. "
            "Manual ChatGPT escalation is available."
        )
        search_provider = None
    else:
        message = "No enrichment provider is available."
        search_provider = None
    options = provider_options()
    return ProviderStatus(
        configured=automatic_provider is not None,
        provider=automatic_provider or requested,
        requested_provider=requested,
        automatic_provider=automatic_provider,
        model=config.OPENAI_ENRICHMENT_MODEL if automatic_provider else None,
        search_provider=search_provider,
        allowed_domains=config.ENRICHMENT_ALLOWED_DOMAINS,
        available_topics=sorted(TOPICS),
        max_jobs_per_day=config.ENRICHMENT_MAX_JOBS_PER_DAY,
        max_tokens_per_month=config.ENRICHMENT_MAX_TOKENS_PER_MONTH,
        auto_apply_threshold=config.ENRICHMENT_AUTO_APPLY_THRESHOLD,
        manual_available=config.MANUAL_CHATGPT_ENABLED,
        available_providers=[option.as_dict() for option in options],
        message=message,
    )


def _wine_identity(wine: Wine) -> str:
    parts = [
        wine.producer,
        wine.cuvee or "",
        wine.appellation or "",
        str(wine.vintage) if wine.vintage else "non-vintage",
        wine.area or "",
        wine.color or "",
        wine.format or "",
        f"{wine.format_ml} ml" if wine.format_ml else "",
    ]
    return " | ".join(part for part in parts if part)


class StrictResearchModel(BaseModel):
    """Shared strict validation for automatic and manual research output."""

    model_config = ConfigDict(extra="forbid", strict=True)


DATE_FIELD_DESCRIPTION = (
    "Complete ISO-8601 date (YYYY-MM-DD) or datetime. Use null when the exact "
    "day is unknown; month-only YYYY-MM values are not accepted."
)


def _validate_iso_date_or_datetime(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(
            "must be a complete ISO-8601 date (YYYY-MM-DD) or datetime; "
            "use null when the exact day is unknown"
        ) from exc
    return value


class ResearchSourceFields(StrictResearchModel):
    source_url: str = Field(max_length=2_048)
    source_type: Literal[
        "producer",
        "official_appellation",
        "critic",
        "market_data",
        "auction",
        "merchant",
        "community",
        "editorial",
        "unknown",
        "ai_inference",
    ]
    published_at: str | None = Field(max_length=64, description=DATE_FIELD_DESCRIPTION)
    exact_producer: bool
    exact_cuvee: bool
    exact_vintage: bool
    exact_format: bool

    @field_validator("published_at")
    @classmethod
    def validate_published_at(cls, value: str | None) -> str | None:
        return _validate_iso_date_or_datetime(value)


class ResearchIdentity(StrictResearchModel):
    matched_name: str = Field(max_length=500)
    confidence: float = Field(ge=0, le=1)
    explanation: str = Field(max_length=MAX_MANUAL_TEXT_LENGTH)
    ambiguities: list[str] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)


class DrinkingWindowObservation(ResearchSourceFields):
    drink_after_year: int | None
    drink_before_year: int | None
    explicitly_stated: bool
    notes: str = Field(max_length=MAX_MANUAL_TEXT_LENGTH)


class MarketObservation(ResearchSourceFields):
    amount: float = Field(gt=0)
    currency: str = Field(min_length=1, max_length=16)
    offer_type: Literal["retail", "secondary", "auction", "unknown"]
    bottle_count: int = Field(ge=1)
    format_ml: int | None
    tax_included: bool | None
    in_stock: bool | None
    observed_at: str | None = Field(max_length=64, description=DATE_FIELD_DESCRIPTION)
    notes: str = Field(max_length=MAX_MANUAL_TEXT_LENGTH)

    @field_validator("observed_at")
    @classmethod
    def validate_observed_at(cls, value: str | None) -> str | None:
        return _validate_iso_date_or_datetime(value)


class PairingObservation(ResearchSourceFields):
    dish: str = Field(max_length=500)
    category: Literal[
        "meat",
        "fish",
        "vegetarian",
        "cheese",
        "dessert",
        "regional",
        "casual",
        "celebration",
        "other",
    ]
    explicitly_stated: bool
    rationale: str = Field(max_length=MAX_MANUAL_TEXT_LENGTH)
    avoid: list[str] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)


class ServingResearch(StrictResearchModel):
    available: bool
    temperature_min_c: float | None
    temperature_max_c: float | None
    decant_minutes: int | None
    stand_upright_hours: int | None
    glass: str | None = Field(max_length=500)
    rationale: str = Field(max_length=MAX_MANUAL_TEXT_LENGTH)
    source_urls: list[str] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)
    method: Literal["source_backed", "style_inference", "unavailable"]


class GrapeComposition(StrictResearchModel):
    name: str = Field(max_length=200)
    percentage: float | None = Field(ge=0, le=100)


class CompositionResearch(StrictResearchModel):
    available: bool
    grapes: list[GrapeComposition] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)
    alcohol_percent: float | None = Field(ge=0, le=100)
    sweetness: str | None = Field(max_length=200)
    oak: str | None = Field(max_length=1_000)
    certifications: list[str] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)
    source_urls: list[str] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)


class ReviewObservation(StrictResearchModel):
    score: float | None
    scale: float | None = Field(gt=0)
    reviewer: str = Field(max_length=300)
    review_date: str | None = Field(max_length=64, description=DATE_FIELD_DESCRIPTION)
    note_excerpt: str = Field(max_length=240)
    source_url: str = Field(max_length=2_048)
    exact_vintage: bool

    @field_validator("review_date")
    @classmethod
    def validate_review_date(cls, value: str | None) -> str | None:
        return _validate_iso_date_or_datetime(value)


class ExternalIdentifierObservation(StrictResearchModel):
    scheme: str = Field(max_length=200)
    value: str = Field(max_length=500)
    source_url: str = Field(max_length=2_048)
    confidence: float = Field(ge=0, le=1)


class ResearchResponse(StrictResearchModel):
    identity: ResearchIdentity
    drinking_windows: list[DrinkingWindowObservation] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)
    market_observations: list[MarketObservation] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)
    pairings: list[PairingObservation] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)
    serving: ServingResearch
    composition: CompositionResearch
    reviews: list[ReviewObservation] = Field(max_length=MAX_MANUAL_RESPONSE_ITEMS)
    external_identifiers: list[ExternalIdentifierObservation] = Field(
        max_length=MAX_MANUAL_RESPONSE_ITEMS
    )
    summary: str = Field(max_length=MAX_MANUAL_TEXT_LENGTH)


def _research_schema() -> dict[str, Any]:
    """Generate the provider schema from the same model used for import."""
    return ResearchResponse.model_json_schema()


def _system_prompt() -> str:
    return """You are a conservative wine research and data-extraction engine.
Search for the exact bottle identity and return only evidence that can be traced
to source URLs. Never invent a price, drinking window, critic score, identifier,
or producer fact. Reject similarly named producers, cuvees, vintages and bottle
formats. A search result snippet alone is weaker evidence than an explicit
source page. For market observations, distinguish a case from one bottle,
record the listed currency, tax/stock status when visible, and do not convert
currencies. For pairing and serving, mark source-backed claims separately from
style inference. AI inference is allowed only for pairing/serving and must use
source_type ai_inference with an empty source_url. Keep tasting-note excerpts
under 240 characters. Return empty arrays or available=false when evidence is
insufficient. Do not present generated prose as a factual source."""


def _user_prompt(wine: Wine, topics: list[str], locale: str) -> str:
    return f"""Research this exact wine:
{_wine_identity(wine)}

Requested topics: {", ".join(topics)}
Preferred explanation language: {locale}
Current date: {date.today().isoformat()}

Prioritize the producer, official appellation bodies, reputable critics,
professional market data, auctions and established merchants. Use several
independent sources when possible. For drinking windows, keep exact-vintage
observations separate from adjacent-vintage or style inference. For value,
return individual observed listings, not a made-up consensus. For pairings and
serving, explain whether each item is explicit evidence or an inference."""


def prepare_manual_chatgpt_request(
    wine: Wine,
    topics: list[str],
    locale: str,
) -> dict[str, Any]:
    """Build a self-contained request for a user to run in ChatGPT manually."""
    if not config.MANUAL_CHATGPT_ENABLED:
        raise EnrichmentNotConfigured("Manual ChatGPT escalation is disabled")
    topics = _validated_topics(topics)
    schema = _research_schema()
    prompt = f"""{_system_prompt()}

{_user_prompt(wine, topics, locale)}

This is a manual CellarManager escalation. Use web search/browsing where
available. Every factual source URL must be a real page you consulted. Use
empty arrays or available=false for unrequested topics or insufficient evidence.

Mandatory JSON formatting rules:
- Return exactly one fenced ```json code block and no text before or after it.
- Use standard ASCII double quotes (U+0022: ") for every JSON key and string
  delimiter. Never use typographic/smart quotes such as “ or ” as delimiters.
- The result must be directly parseable by JSON.parse: no comments, trailing
  commas, ellipses, or unquoted keys.
- published_at, observed_at and review_date must be complete YYYY-MM-DD dates,
  complete ISO-8601 datetimes, or null. Never return a month-only YYYY-MM value.
- When a source gives only a month or year, use null rather than inventing a day.
- Preserve null as JSON null; do not return the strings "null", "unknown" or
  "N/A" for nullable date or numeric fields.

Required JSON Schema:
{json.dumps(schema, ensure_ascii=False, indent=2)}
"""
    return {
        "provider": "manual_chatgpt",
        "level": 4,
        "mode": "manual",
        "wine_id": wine.id,
        "wine_identity": _wine_identity(wine),
        "topics": topics,
        "locale": locale,
        "prompt": prompt,
        "response_schema": schema,
        "format_rules": {
            "json_quotes": "Use standard ASCII double quotes (U+0022), not smart quotes.",
            "dates": "Use YYYY-MM-DD, a complete ISO-8601 datetime, or null; never YYYY-MM.",
            "wrapper": "Return one fenced json code block with no surrounding prose.",
        },
        "next_step": "Paste ChatGPT's complete JSON code block into the manual import endpoint.",
    }


def _extract_output_text(response: dict[str, Any]) -> str:
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    output_text = response.get("output_text")
    if isinstance(output_text, str):
        return output_text
    raise ProviderResponseError("Provider response contained no structured output text")


def _extract_openai_sources(response: dict[str, Any]) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for item in response.get("output", []):
        if item.get("type") == "web_search_call":
            action = item.get("action") or {}
            for source in action.get("sources") or []:
                url = source.get("url")
                if url:
                    found[url] = {
                        "url": url,
                        "title": source.get("title"),
                        "publisher": source.get("publisher"),
                    }
        if item.get("type") == "message":
            for content in item.get("content", []):
                for annotation in content.get("annotations") or []:
                    if annotation.get("type") != "url_citation":
                        continue
                    url = annotation.get("url")
                    if url:
                        found.setdefault(
                            url,
                            {
                                "url": url,
                                "title": annotation.get("title"),
                                "publisher": None,
                            },
                        )
    return list(found.values())


class OpenAIResearchProvider:
    name = "openai_web"

    def __init__(self, transport: Transport | None = None):
        self.transport = transport or _post_json

    def research(
        self,
        wine: Wine,
        topics: list[str],
        locale: str,
        *,
        supplied_sources: list[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
        if not config.OPENAI_API_KEY:
            raise EnrichmentNotConfigured("OPENAI_API_KEY is not configured")

        tools: list[dict[str, Any]] = []
        include: list[str] = []
        prompt = _user_prompt(wine, topics, locale)
        if supplied_sources is None:
            web_tool: dict[str, Any] = {
                "type": "web_search",
                "search_context_size": config.ENRICHMENT_SEARCH_CONTEXT_SIZE,
            }
            if config.ENRICHMENT_ALLOWED_DOMAINS:
                web_tool["filters"] = {"allowed_domains": config.ENRICHMENT_ALLOWED_DOMAINS}
            tools.append(web_tool)
            include.append("web_search_call.action.sources")
        else:
            source_text = "\n\n".join(
                f"URL: {s.get('url')}\nTitle: {s.get('title', '')}\n"
                f"Snippet: {s.get('description', '')}\n"
                f"Extra snippets: {' | '.join(s.get('extra_snippets') or [])}"
                for s in supplied_sources
            )
            prompt += "\n\nSearch results supplied by Brave Search:\n" + source_text

        payload: dict[str, Any] = {
            "model": config.OPENAI_ENRICHMENT_MODEL,
            "store": False,
            "input": [
                {"role": "system", "content": _system_prompt()},
                {"role": "user", "content": prompt},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "wine_research",
                    "strict": True,
                    "schema": _research_schema(),
                }
            },
        }
        if tools:
            payload["tools"] = tools
            # Research must actually use the Internet; do not let the model
            # answer from memory when no supplied search results exist.
            payload["tool_choice"] = "required"
        if include:
            payload["include"] = include

        response = self.transport(
            f"{config.OPENAI_BASE_URL.rstrip('/')}/responses",
            {"Authorization": f"Bearer {config.OPENAI_API_KEY}"},
            payload,
            config.ENRICHMENT_TIMEOUT_SECONDS,
        ).body
        try:
            raw_parsed = json.loads(_extract_output_text(response))
        except json.JSONDecodeError as exc:
            raise ProviderResponseError("Structured output was not valid JSON") from exc
        parsed = _validate_research_response(
            raw_parsed,
            context="Automatic provider response",
        )
        sources = supplied_sources or _extract_openai_sources(response)
        return parsed, sources, response.get("usage") or {}, response


class BraveSearchClient:
    def search(self, wine: Wine, topics: list[str]) -> list[dict[str, Any]]:
        if not config.BRAVE_SEARCH_API_KEY:
            raise EnrichmentNotConfigured("BRAVE_SEARCH_API_KEY is not configured")
        queries = [
            f'"{wine.producer}" "{wine.cuvee or ""}" "{wine.vintage or "NV"}" wine',
        ]
        if "drinking_window" in topics:
            queries.append(
                f'"{wine.producer}" "{wine.cuvee or ""}" "{wine.vintage or "NV"}" '
                "drinking window drink from drink to"
            )
        if "market_value" in topics:
            queries.append(
                f'"{wine.producer}" "{wine.cuvee or ""}" "{wine.vintage or "NV"}" '
                f'"{wine.format}" price buy auction'
            )
        if {"pairing", "serving", "composition", "reviews"} & set(topics):
            queries.append(
                f'"{wine.producer}" "{wine.cuvee or ""}" "{wine.vintage or "NV"}" '
                "pairing serving tasting grapes"
            )

        results: dict[str, dict[str, Any]] = {}
        for query in queries[: config.ENRICHMENT_MAX_SEARCH_QUERIES]:
            params = urllib.parse.urlencode(
                {
                    "q": query,
                    "count": config.ENRICHMENT_MAX_SOURCES,
                    "extra_snippets": "true",
                    "safesearch": "moderate",
                }
            )
            response = _get_json(
                f"https://api.search.brave.com/res/v1/web/search?{params}",
                {
                    "Accept": "application/json",
                    "X-Subscription-Token": config.BRAVE_SEARCH_API_KEY,
                },
                config.ENRICHMENT_TIMEOUT_SECONDS,
            ).body
            for result in (response.get("web") or {}).get("results") or []:
                url = result.get("url")
                if not url:
                    continue
                results[url] = {
                    "url": url,
                    "title": result.get("title"),
                    "description": result.get("description"),
                    "extra_snippets": result.get("extra_snippets") or [],
                    "publisher": None,
                }
        return list(results.values())[: config.ENRICHMENT_MAX_SOURCES]


class BraveOpenAIResearchProvider:
    name = "brave_openai"

    def __init__(self, openai: OpenAIResearchProvider | None = None):
        self.openai = openai or OpenAIResearchProvider()
        self.search_client = BraveSearchClient()

    def research(
        self, wine: Wine, topics: list[str], locale: str
    ) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
        sources = self.search_client.search(wine, topics)
        if not sources:
            raise ProviderResponseError("Brave Search returned no sources")
        return self.openai.research(wine, topics, locale, supplied_sources=sources)


def get_provider(provider_name: str | None = None):
    provider_name = provider_name or select_automatic_provider_name()
    if provider_name is None:
        raise EnrichmentNotConfigured(provider_status().message)
    if not _automatic_provider_is_configured(provider_name):
        raise EnrichmentNotConfigured(
            f"Provider {provider_name} does not have all required credentials"
        )
    if provider_name == "brave_openai":
        return BraveOpenAIResearchProvider()
    if provider_name == "openai_web":
        return OpenAIResearchProvider()
    raise EnrichmentNotConfigured(f"Unknown automatic provider: {provider_name}")


def normalise_public_source_url(value: str | None) -> str | None:
    """Return a safe, user-clickable HTTP(S) source URL or ``None``.

    CellarManager never fetches model-provided URLs itself, but it displays them
    as evidence links. Reject local/private targets, credentials in URLs and
    non-web schemes so generated output cannot become a misleading or dangerous
    link.
    """
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username or parsed.password:
        return None
    host = parsed.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        return None
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
    ):
        return None
    return parsed.geturl()


def _domain(url: str) -> str:
    safe = normalise_public_source_url(url)
    return (urlparse(safe).hostname or "").lower().removeprefix("www.") if safe else ""


def _source_type_for_url(url: str, claims: list[dict[str, Any]]) -> str:
    types = [
        claim.get("source_type")
        for claim in claims
        if claim.get("source_url") == url and claim.get("source_type")
    ]
    if not types:
        return "unknown"
    return Counter(types).most_common(1)[0][0]


def _identity_component_score(item: dict[str, Any]) -> float:
    values = [
        bool(item.get("exact_producer")),
        bool(item.get("exact_cuvee")),
        bool(item.get("exact_vintage")),
        bool(item.get("exact_format")),
    ]
    weights = [0.35, 0.25, 0.25, 0.15]
    return sum(weight for value, weight in zip(values, weights, strict=True) if value)


def _published_freshness(published_at: str | None) -> float:
    if not published_at:
        return 0.55
    try:
        published = date.fromisoformat(published_at[:10])
    except ValueError:
        return 0.55
    age_days = max(0, (date.today() - published).days)
    return max(0.15, 1.0 - age_days / (365 * 8))


def _source_reliability(source_type: str) -> float:
    return SOURCE_RELIABILITY.get(source_type, SOURCE_RELIABILITY["unknown"])


def confidence_score(
    *,
    identity_confidence: float,
    evidence: list[dict[str, Any]],
    agreement: float,
    inferred: bool = False,
) -> float:
    if evidence:
        reliability = statistics.fmean(
            _source_reliability(item.get("source_type", "unknown")) for item in evidence
        )
        identity_detail = statistics.fmean(_identity_component_score(item) for item in evidence)
        freshness = statistics.fmean(
            _published_freshness(item.get("published_at")) for item in evidence
        )
        independent_sources = len(
            {_domain(item.get("source_url", "")) for item in evidence if item.get("source_url")}
        )
        source_count = min(1.0, independent_sources / 3)
    else:
        reliability = SOURCE_RELIABILITY["ai_inference"]
        identity_detail = identity_confidence
        freshness = 0.5
        source_count = 0.0

    score = (
        0.25 * max(0.0, min(1.0, identity_confidence))
        + 0.20 * reliability
        + 0.20 * identity_detail
        + 0.15 * max(0.0, min(1.0, agreement))
        + 0.10 * source_count
        + 0.10 * freshness
    )
    if inferred:
        score -= 0.18
    return round(max(0.05, min(0.98, score)), 3)


def _weighted_year(observations: list[dict[str, Any]], field: str) -> tuple[int | None, float]:
    usable = [item for item in observations if item.get(field)]
    if not usable:
        return None, 0.0
    weighted = []
    for item in usable:
        weight = _source_reliability(item.get("source_type", "unknown"))
        weight *= 0.5 + 0.5 * _identity_component_score(item)
        if not item.get("explicitly_stated"):
            weight *= 0.55
        weighted.append((int(item[field]), max(0.05, weight)))
    total = sum(weight for _, weight in weighted)
    year = round(sum(value * weight for value, weight in weighted) / total)
    spread = statistics.pstdev([value for value, _ in weighted]) if len(weighted) > 1 else 0
    agreement = max(0.0, 1.0 - spread / 5)
    return year, agreement


def _exact_market_match(item: dict[str, Any], wine: Wine) -> bool:
    if not item.get("exact_producer"):
        return False
    if wine.cuvee and not item.get("exact_cuvee"):
        return False
    if wine.vintage is not None and not item.get("exact_vintage"):
        return False
    if wine.format_ml is not None and not item.get("exact_format"):
        return False
    return True


def _valid_window_year(year: Any, wine: Wine) -> int | None:
    if year is None:
        return None
    try:
        value = int(year)
    except (TypeError, ValueError):
        return None
    lower = (wine.vintage or date.today().year - 50) - 2
    upper = date.today().year + 80
    return value if lower <= value <= upper else None


def _market_candidates(
    observations: list[dict[str, Any]],
    wine: Wine,
    identity_confidence: float,
) -> list[dict[str, Any]]:
    valid: list[dict[str, Any]] = []
    for item in observations:
        if not _exact_market_match(item, wine):
            continue
        try:
            amount = float(item["amount"])
            bottle_count = max(1, int(item.get("bottle_count") or 1))
        except (KeyError, TypeError, ValueError):
            continue
        if amount <= 0:
            continue
        target_format = wine.format_ml
        observed_format = item.get("format_ml")
        if target_format and observed_format and int(observed_format) != target_format:
            continue
        if item.get("in_stock") is False and item.get("offer_type") == "retail":
            continue
        normalized = dict(item)
        normalized["per_bottle_amount"] = round(amount / bottle_count, 2)
        normalized["currency"] = str(item.get("currency") or "").upper()
        valid.append(normalized)

    candidates: list[dict[str, Any]] = []
    for label, offer_types in (
        ("replacement_value", {"retail"}),
        ("secondary_market_value", {"secondary", "auction"}),
    ):
        group = [item for item in valid if item.get("offer_type") in offer_types]
        by_currency: dict[str, list[dict[str, Any]]] = {}
        for item in group:
            by_currency.setdefault(item["currency"], []).append(item)
        if not by_currency:
            continue
        currency, same_currency = max(by_currency.items(), key=lambda pair: len(pair[1]))
        values = [item["per_bottle_amount"] for item in same_currency]
        median = statistics.median(values)
        if len(values) > 2:
            mad = statistics.median(abs(value - median) for value in values) or 1.0
            filtered = [value for value in values if abs(value - median) <= 4 * mad]
        else:
            filtered = values
        median = statistics.median(filtered)
        spread = statistics.pstdev(filtered) if len(filtered) > 1 else 0.0
        agreement = max(0.0, 1.0 - spread / max(1.0, median * 0.35))
        confidence = confidence_score(
            identity_confidence=identity_confidence,
            evidence=same_currency,
            agreement=agreement,
        )
        candidates.append(
            {
                "topic": "market_value",
                "label": label,
                "value": {
                    "amount": round(median, 2),
                    "currency": currency,
                    "low": round(min(filtered), 2),
                    "high": round(max(filtered), 2),
                    "observations": len(filtered),
                    "offer_type": label,
                },
                "confidence": confidence,
                "method": "median_exact_listings",
                "rationale": (
                    f"Median of {len(filtered)} exact-format {label.replace('_', ' ')} "
                    f"observation(s) in {currency}; currencies are not converted."
                ),
                "evidence": same_currency,
            }
        )

    reference = next(
        (candidate for candidate in candidates if candidate["label"] == "secondary_market_value"),
        None,
    ) or next(
        (candidate for candidate in candidates if candidate["label"] == "replacement_value"),
        None,
    )
    if reference:
        multiplier = 0.75 if reference["label"] == "secondary_market_value" else 0.65
        candidates.append(
            {
                "topic": "market_value",
                "label": "quick_sale_estimate",
                "value": {
                    **reference["value"],
                    "amount": round(reference["value"]["amount"] * multiplier, 2),
                    "offer_type": "quick_sale_estimate",
                },
                "confidence": round(max(0.05, reference["confidence"] - 0.18), 3),
                "method": "derived_conservative_discount",
                "rationale": (
                    f"Conservative {round((1 - multiplier) * 100)}% discount from "
                    f"{reference['label'].replace('_', ' ')}; not a direct market quote."
                ),
                "evidence": reference["evidence"],
            }
        )
    return candidates


def _maturity(window: dict[str, Any]) -> dict[str, Any]:
    current = date.today().year
    after = window.get("drink_after_year")
    before = window.get("drink_before_year")
    if after is None and before is None:
        return {
            "state": "unknown",
            "readiness_score": None,
            "drink_soon": False,
            "rationale": "No defensible drinking window is available.",
        }
    if after is not None and current < after:
        distance = after - current
        return {
            "state": "too_young" if distance > 1 else "approaching_window",
            "readiness_score": max(0, min(4, 4 - distance)),
            "drink_soon": False,
            "rationale": f"The proposed window starts in {after}.",
        }
    if before is not None and current > before:
        return {
            "state": "possibly_declining",
            "readiness_score": 7,
            "drink_soon": True,
            "rationale": f"The proposed window ended in {before}.",
        }
    if before is not None and before - current <= 2:
        return {
            "state": "drink_soon",
            "readiness_score": 9,
            "drink_soon": True,
            "rationale": f"The proposed window ends in {before}.",
        }
    return {
        "state": "ready",
        "readiness_score": 8,
        "drink_soon": False,
        "rationale": "The current year is inside the proposed drinking window.",
    }


def _claim_items(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    items.extend(parsed.get("drinking_windows") or [])
    items.extend(parsed.get("market_observations") or [])
    items.extend(parsed.get("pairings") or [])
    return items


def _persist_sources(
    conn,
    job_id: str,
    parsed: dict[str, Any],
    provider_sources: list[dict[str, Any]],
    *,
    provider_name: str | None = None,
) -> dict[str, str]:
    """Persist only URLs present in the provider's evidence set.

    For automatic jobs, a URL becomes authoritative only when it also appears
    in OpenAI web-search citations or the Brave result set supplied to the
    model. For a manual job, the imported response itself is the evidence set;
    URLs are still restricted to safe public HTTP(S) targets and remain subject
    to human review. Unsupported claims lose their URL before aggregation.
    Source-free AI inference remains allowed only for pairing and serving.
    """
    claims = _claim_items(parsed)
    by_url: dict[str, dict[str, Any]] = {}
    for source in provider_sources:
        safe_url = normalise_public_source_url(source.get("url"))
        if safe_url:
            by_url[safe_url] = {**source, "url": safe_url}

    authoritative_urls = set(by_url)

    def authoritative(raw: Any) -> str:
        safe = normalise_public_source_url(raw if isinstance(raw, str) else None)
        return safe if safe in authoritative_urls else ""

    for claim in claims:
        claim["source_url"] = authoritative(claim.get("source_url"))

    for section in (parsed.get("serving") or {}, parsed.get("composition") or {}):
        section["source_urls"] = [
            safe for raw in (section.get("source_urls") or []) if (safe := authoritative(raw))
        ]

    for review in parsed.get("reviews") or []:
        review["source_url"] = authoritative(review.get("source_url"))

    for identifier in parsed.get("external_identifiers") or []:
        identifier["source_url"] = authoritative(identifier.get("source_url"))

    mapping: dict[str, str] = {}
    identity_conf = float((parsed.get("identity") or {}).get("confidence") or 0)
    for url, source in list(by_url.items())[: config.ENRICHMENT_MAX_SOURCES]:
        source_id = new_id()
        mapping[url] = source_id
        source_type = (
            "unverified_manual"
            if provider_name == "manual_chatgpt"
            else _source_type_for_url(url, claims)
        )
        domain = _domain(url)
        relevant_claims = [claim for claim in claims if claim.get("source_url") == url]
        identity_score = (
            statistics.fmean(_identity_component_score(claim) for claim in relevant_claims)
            if relevant_claims
            else identity_conf
        )
        published = next(
            (claim.get("published_at") for claim in relevant_claims if claim.get("published_at")),
            None,
        )
        excerpt = source.get("description") or " | ".join(source.get("extra_snippets") or [])
        er.insert_source(
            conn,
            source_id=source_id,
            job_id=job_id,
            url=url,
            title=source.get("title"),
            publisher=source.get("publisher"),
            domain=domain,
            source_type=source_type,
            retrieved_at=utcnow().isoformat(),
            published_at=published,
            excerpt=excerpt,
            content_hash=(hashlib.sha256(excerpt.encode("utf-8")).hexdigest() if excerpt else None),
            reliability=_source_reliability(source_type),
            identity_score=identity_score,
            metadata={"provider": provider_name or config.ENRICHMENT_PROVIDER},
        )
    return mapping


def _insert_candidate(
    conn,
    *,
    job_id: str,
    wine_id: str,
    topic: str,
    label: str,
    value: Any,
    confidence: float,
    method: str,
    rationale: str,
    source_urls: list[str],
    source_mapping: dict[str, str],
) -> str:
    candidate_id = new_id()
    er.insert_candidate(
        conn,
        candidate_id=candidate_id,
        job_id=job_id,
        wine_id=wine_id,
        topic=topic,
        label=label,
        value=value,
        confidence=confidence,
        method=method,
        rationale=rationale,
        source_ids=[source_mapping[url] for url in source_urls if url in source_mapping],
    )
    return candidate_id


def _persist_candidates(
    conn,
    *,
    job_id: str,
    wine: Wine,
    topics: list[str],
    parsed: dict[str, Any],
    source_mapping: dict[str, str],
    provider_name: str | None = None,
) -> list[str]:
    ids: list[str] = []
    manual_import = provider_name == "manual_chatgpt"
    identity_conf = float((parsed.get("identity") or {}).get("confidence") or 0)
    if identity_conf < config.ENRICHMENT_MIN_IDENTITY_CONFIDENCE:
        return ids

    windows = parsed.get("drinking_windows") or []
    for window in windows:
        window["drink_after_year"] = _valid_window_year(window.get("drink_after_year"), wine)
        window["drink_before_year"] = _valid_window_year(window.get("drink_before_year"), wine)
    windows = [
        window
        for window in windows
        if window.get("source_url")
        and (
            window.get("drink_after_year") is not None
            or window.get("drink_before_year") is not None
        )
    ]
    if "drinking_window" in topics and windows:
        after, after_agreement = _weighted_year(windows, "drink_after_year")
        before, before_agreement = _weighted_year(windows, "drink_before_year")
        if after is not None and before is not None and after > before:
            after, before = None, None
        if after is not None or before is not None:
            agreement = statistics.fmean(
                value for value in (after_agreement, before_agreement) if value or value == 0
            )
            inferred = not all(item.get("explicitly_stated") for item in windows)
            confidence = confidence_score(
                identity_confidence=identity_conf,
                evidence=windows,
                agreement=agreement,
                inferred=inferred,
            )
            value = {
                "drink_after_year": after,
                "drink_before_year": before,
                "observation_count": len(windows),
                "maturity": _maturity({"drink_after_year": after, "drink_before_year": before}),
            }
            urls = [item.get("source_url") for item in windows if item.get("source_url")]
            ids.append(
                _insert_candidate(
                    conn,
                    job_id=job_id,
                    wine_id=wine.id,
                    topic="drinking_window",
                    label="drinking_window",
                    value=value,
                    confidence=confidence,
                    method="source_consensus" if not inferred else "mixed_source_and_inference",
                    rationale=(
                        f"Confidence-weighted consensus from {len(windows)} observation(s); "
                        "exact vintage and explicit statements receive more weight."
                    ),
                    source_urls=urls,
                    source_mapping=source_mapping,
                )
            )
            ids.append(
                _insert_candidate(
                    conn,
                    job_id=job_id,
                    wine_id=wine.id,
                    topic="maturity",
                    label="maturity",
                    value=value["maturity"],
                    confidence=confidence,
                    method="derived_from_drinking_window",
                    rationale=value["maturity"]["rationale"],
                    source_urls=urls,
                    source_mapping=source_mapping,
                )
            )

    market_observations = [
        item
        for item in (parsed.get("market_observations") or [])
        if item.get("source_url") in source_mapping
    ]
    if "market_value" in topics:
        for item in market_observations:
            try:
                amount = float(item.get("amount"))
                bottle_count = max(1, int(item.get("bottle_count") or 1))
            except (TypeError, ValueError):
                continue
            currency = str(item.get("currency") or "").strip().upper()
            if amount <= 0 or not currency:
                continue
            url = item["source_url"]
            er.insert_market_observation(
                conn,
                observation_id=new_id(),
                job_id=job_id,
                wine_id=wine.id,
                source_id=source_mapping[url],
                amount=amount,
                currency=currency,
                offer_type=str(item.get("offer_type") or "unknown"),
                bottle_count=bottle_count,
                format_ml=item.get("format_ml"),
                tax_included=item.get("tax_included"),
                in_stock=item.get("in_stock"),
                exact_match=_identity_component_score(item) >= 0.85,
                observed_at=item.get("observed_at"),
                notes=item.get("notes"),
            )
        for candidate in _market_candidates(market_observations, wine, identity_conf):
            urls = [
                item.get("source_url") for item in candidate["evidence"] if item.get("source_url")
            ]
            ids.append(
                _insert_candidate(
                    conn,
                    job_id=job_id,
                    wine_id=wine.id,
                    topic=candidate["topic"],
                    label=candidate["label"],
                    value=candidate["value"],
                    confidence=candidate["confidence"],
                    method=candidate["method"],
                    rationale=candidate["rationale"],
                    source_urls=urls,
                    source_mapping=source_mapping,
                )
            )

    pairings = [
        item
        for item in (parsed.get("pairings") or [])
        if item.get("source_url") in source_mapping
        or (
            item.get("source_type") == "ai_inference"
            and not item.get("source_url")
            and not item.get("explicitly_stated")
        )
    ][: config.ENRICHMENT_MAX_PAIRINGS]
    if "pairing" in topics and pairings:
        explicit = [item for item in pairings if item.get("explicitly_stated")]
        confidence = confidence_score(
            identity_confidence=identity_conf,
            evidence=explicit or pairings,
            agreement=min(1.0, len(pairings) / 4),
            inferred=not bool(explicit),
        )
        urls = [item.get("source_url") for item in pairings if item.get("source_url")]
        ids.append(
            _insert_candidate(
                conn,
                job_id=job_id,
                wine_id=wine.id,
                topic="pairing",
                label="dish_pairings",
                value=pairings,
                confidence=confidence,
                method="source_backed" if explicit else "ai_style_inference",
                rationale="Pairings retain whether they were explicitly sourced or inferred.",
                source_urls=urls,
                source_mapping=source_mapping,
            )
        )

    serving = parsed.get("serving") or {}
    serving_is_supported = bool(serving.get("source_urls")) or (
        serving.get("method") == "style_inference"
    )
    if "serving" in topics and serving.get("available") and serving_is_supported:
        urls = serving.get("source_urls") or []
        confidence = confidence_score(
            identity_confidence=identity_conf,
            evidence=[
                {
                    "source_url": url,
                    "source_type": (
                        "unverified_manual"
                        if manual_import
                        else ("producer" if len(urls) == 1 else "editorial")
                    ),
                    "exact_producer": not manual_import,
                    "exact_cuvee": not manual_import,
                    "exact_vintage": bool(wine.vintage) and not manual_import,
                    "exact_format": not manual_import,
                }
                for url in urls
            ],
            agreement=0.75 if urls else 0.4,
            inferred=serving.get("method") == "style_inference",
        )
        ids.append(
            _insert_candidate(
                conn,
                job_id=job_id,
                wine_id=wine.id,
                topic="serving",
                label="serving_advice",
                value=serving,
                confidence=confidence,
                method=serving.get("method") or "unavailable",
                rationale=serving.get("rationale") or "",
                source_urls=urls,
                source_mapping=source_mapping,
            )
        )

    composition = parsed.get("composition") or {}
    if "composition" in topics and composition.get("available") and composition.get("source_urls"):
        urls = composition.get("source_urls") or []
        confidence = confidence_score(
            identity_confidence=identity_conf,
            evidence=[
                {
                    "source_url": url,
                    "source_type": ("unverified_manual" if manual_import else "producer"),
                    "exact_producer": not manual_import,
                    "exact_cuvee": not manual_import,
                    "exact_vintage": bool(wine.vintage) and not manual_import,
                    "exact_format": not manual_import,
                }
                for url in urls
            ],
            agreement=0.8 if urls else 0.2,
        )
        ids.append(
            _insert_candidate(
                conn,
                job_id=job_id,
                wine_id=wine.id,
                topic="composition",
                label="composition",
                value=composition,
                confidence=confidence,
                method="source_extraction",
                rationale="Structured producer/appellation composition facts.",
                source_urls=urls,
                source_mapping=source_mapping,
            )
        )

    reviews = [
        item for item in (parsed.get("reviews") or []) if item.get("source_url") in source_mapping
    ]
    if "reviews" in topics and reviews:
        urls = [item.get("source_url") for item in reviews if item.get("source_url")]
        confidence = confidence_score(
            identity_confidence=identity_conf,
            evidence=[
                {
                    "source_url": item.get("source_url"),
                    "source_type": ("unverified_manual" if manual_import else "critic"),
                    "exact_producer": not manual_import,
                    "exact_cuvee": not manual_import,
                    "exact_vintage": (item.get("exact_vintage", False) and not manual_import),
                    "exact_format": not manual_import,
                    "published_at": item.get("review_date"),
                }
                for item in reviews
            ],
            agreement=min(1.0, len(reviews) / 3),
        )
        ids.append(
            _insert_candidate(
                conn,
                job_id=job_id,
                wine_id=wine.id,
                topic="reviews",
                label="critical_reviews",
                value=reviews,
                confidence=confidence,
                method="source_extraction",
                rationale="Short factual review metadata; excerpts remain limited.",
                source_urls=urls,
                source_mapping=source_mapping,
            )
        )

    identifiers = [
        item
        for item in (parsed.get("external_identifiers") or [])
        if item.get("source_url") in source_mapping and item.get("value")
    ]
    if "identifiers" in topics and identifiers:
        urls = [item.get("source_url") for item in identifiers if item.get("source_url")]
        confidence = max(float(item.get("confidence") or 0) for item in identifiers)
        ids.append(
            _insert_candidate(
                conn,
                job_id=job_id,
                wine_id=wine.id,
                topic="identifiers",
                label="external_identifiers",
                value=identifiers,
                confidence=confidence,
                method="source_extraction",
                rationale="External identifiers require explicit source evidence.",
                source_urls=urls,
                source_mapping=source_mapping,
            )
        )
    return ids


def _manual_provider_sources(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    urls: set[str] = set()
    for claim in _claim_items(parsed):
        if safe := normalise_public_source_url(claim.get("source_url")):
            urls.add(safe)
    for section in (parsed.get("serving") or {}, parsed.get("composition") or {}):
        for value in section.get("source_urls") or []:
            if safe := normalise_public_source_url(value):
                urls.add(safe)
    for item in [
        *(parsed.get("reviews") or []),
        *(parsed.get("external_identifiers") or []),
    ]:
        if safe := normalise_public_source_url(item.get("source_url")):
            urls.add(safe)
    return [{"url": url, "title": None, "publisher": None} for url in sorted(urls)]


def _validate_research_response(
    response: Any,
    *,
    context: str,
) -> dict[str, Any]:
    """Validate and normalize provider output with a consistent error shape."""
    try:
        validated = ResearchResponse.model_validate(response)
    except ValidationError as exc:
        details = []
        for error in exc.errors(include_url=False)[:8]:
            location = ".".join(str(part) for part in error["loc"]) or "response"
            details.append(f"{location}: {error['msg']}")
        suffix = "; ".join(details)
        raise ProviderResponseError(f"{context} failed schema validation: {suffix}") from exc
    return validated.model_dump(mode="json")


def _validate_manual_response(response: dict[str, Any] | str) -> dict[str, Any]:
    if isinstance(response, str):
        raw = response.strip()
        if raw.startswith("```"):
            lines = raw.splitlines()
            if lines and lines[0].strip().lower() in {"```", "```json"}:
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            raw = "\n".join(lines).strip()
        try:
            response = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderResponseError("Manual ChatGPT response is not valid JSON") from exc

    if not isinstance(response, dict):
        raise ProviderResponseError("Manual ChatGPT response must be a JSON object")

    return _validate_research_response(
        response,
        context="Manual ChatGPT response",
    )


def _manual_confidence_cap() -> float:
    """Keep manual candidates below both high-confidence and auto-apply levels."""
    threshold = float(config.ENRICHMENT_AUTO_APPLY_THRESHOLD)
    return min(MANUAL_CONFIDENCE_CAP, max(0.0, threshold - 0.01))


def _mark_manual_evidence_unverified(parsed: dict[str, Any]) -> None:
    """Prevent pasted model assertions from masquerading as verified evidence."""
    for claim in _claim_items(parsed):
        if not claim.get("source_url"):
            continue
        claim["source_type"] = "unverified_manual"
        claim["exact_producer"] = False
        claim["exact_cuvee"] = False
        claim["exact_vintage"] = False
        claim["exact_format"] = False


def import_manual_chatgpt_response(
    conn,
    *,
    wine: Wine,
    user_id: str,
    topics: list[str],
    locale: str,
    response: dict[str, Any] | str,
) -> dict[str, Any]:
    """Validate and persist a manually obtained ChatGPT response.

    This path never calls an API and therefore does not require provider
    credentials or consume the automatic token budget.
    """
    if not config.MANUAL_CHATGPT_ENABLED:
        raise EnrichmentNotConfigured("Manual ChatGPT escalation is disabled")
    topics = _validated_topics(topics)
    parsed = _validate_manual_response(response)
    _mark_manual_evidence_unverified(parsed)
    job = er.create_job(
        conn,
        job_id=new_id(),
        wine_id=wine.id,
        user_id=user_id,
        provider="manual_chatgpt",
        topics=topics,
        locale=locale,
        auto_apply=False,
        model=None,
    )
    er.set_job_running(conn, job["id"])
    sources = _manual_provider_sources(parsed)
    source_mapping = _persist_sources(
        conn,
        job["id"],
        parsed,
        sources,
        provider_name="manual_chatgpt",
    )
    _persist_candidates(
        conn,
        job_id=job["id"],
        wine=wine,
        topics=topics,
        parsed=parsed,
        source_mapping=source_mapping,
        provider_name="manual_chatgpt",
    )
    er.cap_candidate_confidence_for_job(conn, job["id"], _manual_confidence_cap())
    er.complete_job(
        conn,
        job["id"],
        summary=parsed.get("summary") or "Manual ChatGPT research imported.",
        usage={},
        raw_response_json=(
            json.dumps(parsed, ensure_ascii=False) if config.ENRICHMENT_STORE_RAW_RESPONSE else None
        ),
    )
    return er.get_job_with_results(conn, job["id"]) or job


def _month_start() -> str:
    today = datetime.now(UTC)
    return today.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


def _day_start() -> str:
    today = datetime.now(UTC)
    return today.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def enforce_budget(conn) -> None:
    if er.automatic_jobs_created_since(conn, _day_start()) >= config.ENRICHMENT_MAX_JOBS_PER_DAY:
        raise EnrichmentBudgetExceeded("Daily enrichment job limit reached")
    if (
        config.ENRICHMENT_MAX_TOKENS_PER_MONTH > 0
        and er.tokens_used_since(conn, _month_start()) >= config.ENRICHMENT_MAX_TOKENS_PER_MONTH
    ):
        raise EnrichmentBudgetExceeded("Monthly enrichment token budget reached")


def create_job(
    conn,
    *,
    wine: Wine,
    user_id: str,
    topics: list[str],
    locale: str,
    auto_apply: bool,
) -> dict[str, Any]:
    status = provider_status()
    if not status.configured or status.automatic_provider is None:
        raise EnrichmentNotConfigured(status.message)
    topics = _validated_topics(topics)
    enforce_budget(conn)
    return er.create_job(
        conn,
        job_id=new_id(),
        wine_id=wine.id,
        user_id=user_id,
        provider=status.automatic_provider,
        topics=topics,
        locale=locale,
        auto_apply=auto_apply,
        model=status.model,
    )


def execute_job(db: Database, job_id: str) -> None:
    conn = db.connect()
    job = er.get_job(conn, job_id)
    if not job or job["status"] not in {"queued", "running"}:
        return
    try:
        er.set_job_running(conn, job_id)
        conn.commit()
        wine = repo.get_wine(conn, job["wine_id"])
        if wine is None:
            raise ProviderResponseError("Wine no longer exists")
        provider = get_provider(job.get("provider"))
        parsed, provider_sources, usage, raw_response = provider.research(
            wine, job["topics"], job["locale"]
        )
        source_mapping = _persist_sources(
            conn,
            job_id,
            parsed,
            provider_sources,
            provider_name=provider.name,
        )
        candidate_ids = _persist_candidates(
            conn,
            job_id=job_id,
            wine=wine,
            topics=job["topics"],
            parsed=parsed,
            source_mapping=source_mapping,
            provider_name=provider.name,
        )
        er.complete_job(
            conn,
            job_id,
            summary=parsed.get("summary") or "Research completed.",
            usage=usage,
            raw_response_json=(
                json.dumps(raw_response, ensure_ascii=False)
                if config.ENRICHMENT_STORE_RAW_RESPONSE
                else None
            ),
        )
        conn.commit()
        if job["auto_apply"]:
            for candidate_id in candidate_ids:
                candidate = er.get_candidate(conn, candidate_id)
                if candidate and candidate["confidence"] >= config.ENRICHMENT_AUTO_APPLY_THRESHOLD:
                    apply_candidate(
                        conn,
                        candidate_id=candidate_id,
                        user_id=job["user_id"],
                        force=False,
                    )
            conn.commit()
    except EnrichmentError as exc:
        conn.rollback()
        er.fail_job(conn, job_id, code=exc.code, message=str(exc))
        conn.commit()
    except Exception as exc:  # preserve a durable failure without exposing a traceback
        conn.rollback()
        er.fail_job(conn, job_id, code="enrichment_internal_error", message=str(exc))
        conn.commit()


def _pairing_summary(value: list[dict[str, Any]]) -> str:
    dishes = [item.get("dish", "").strip() for item in value if item.get("dish")]
    return "; ".join(dishes[:8])


def _serving_summary(value: dict[str, Any]) -> str:
    parts = []
    low = value.get("temperature_min_c")
    high = value.get("temperature_max_c")
    if low is not None or high is not None:
        parts.append(
            f"Serve at {low if low is not None else '?'}-{high if high is not None else '?'}°C"
        )
    if value.get("decant_minutes") is not None:
        parts.append(f"decant {value['decant_minutes']} min")
    if value.get("stand_upright_hours") is not None:
        parts.append(f"stand upright {value['stand_upright_hours']} h")
    if value.get("glass"):
        parts.append(f"glass: {value['glass']}")
    return "; ".join(parts) or value.get("rationale") or ""


def _candidate_source_urls(value: Any) -> set[str]:
    """Collect evidence URLs embedded in a candidate value."""
    found: set[str] = set()

    def visit(item: Any) -> None:
        if isinstance(item, list):
            for child in item:
                visit(child)
            return
        if not isinstance(item, dict):
            return
        for key, child in item.items():
            if key == "source_url" and isinstance(child, str) and child:
                found.add(child)
            elif key == "source_urls" and isinstance(child, list):
                found.update(url for url in child if isinstance(url, str) and url)
            else:
                visit(child)

    visit(value)
    return found


def _candidate_number(
    value: Any,
    field: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
    integer: bool = False,
    nullable: bool = True,
) -> int | float | None:
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        kind = "integer" if integer else "number"
        raise ValueError(f"{field} must be a {kind}{' or null' if nullable else ''}")
    if integer and not isinstance(value, int):
        raise ValueError(f"{field} must be an integer{' or null' if nullable else ''}")
    numeric = int(value) if integer else float(value)
    if minimum is not None and numeric < minimum:
        raise ValueError(f"{field} must be at least {minimum}")
    if maximum is not None and numeric > maximum:
        raise ValueError(f"{field} must be at most {maximum}")
    return numeric


def _candidate_text(
    value: Any,
    field: str,
    *,
    required: bool = False,
    max_length: int = MAX_MANUAL_TEXT_LENGTH,
) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string{' or null' if not required else ''}")
    cleaned = value.strip()
    if required and not cleaned:
        raise ValueError(f"{field} must not be empty")
    if len(cleaned) > max_length:
        raise ValueError(f"{field} must be at most {max_length} characters")
    return cleaned


def _validate_candidate_edit(candidate: dict[str, Any], value: Any) -> dict[str, Any] | list[Any]:
    """Validate a user correction without changing evidence or confidence.

    Candidate edits intentionally update only ``value_json``. Confidence,
    method provenance and source IDs remain under CellarManager control. URLs
    may be removed, but new evidence URLs cannot be introduced through the
    editor because they have not passed the research-source review pipeline.
    """
    if candidate.get("status") != "proposed":
        raise ValueError("Only proposed candidates can be edited")
    if not isinstance(value, (dict, list)):
        raise ValueError("Candidate value must be a JSON object or array")
    original = candidate.get("value")
    if isinstance(original, list) != isinstance(value, list):
        raise ValueError("Candidate value must keep its original JSON container type")

    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("Candidate value must be valid finite JSON") from exc
    if len(encoded.encode("utf-8")) > MAX_CANDIDATE_EDIT_BYTES:
        raise ValueError(f"Candidate value must be smaller than {MAX_CANDIDATE_EDIT_BYTES} bytes")

    added_urls = _candidate_source_urls(value) - _candidate_source_urls(original)
    if added_urls:
        raise ValueError(
            "Candidate edits cannot add evidence URLs; run new research to add sources"
        )

    topic = candidate.get("topic")
    if topic == "drinking_window":
        if not isinstance(value, dict):
            raise ValueError("Drinking-window value must be a JSON object")
        after = _candidate_number(
            value.get("drink_after_year"),
            "drink_after_year",
            minimum=1800,
            maximum=date.today().year + 100,
            integer=True,
        )
        before = _candidate_number(
            value.get("drink_before_year"),
            "drink_before_year",
            minimum=1800,
            maximum=date.today().year + 100,
            integer=True,
        )
        if after is not None and before is not None and after > before:
            raise ValueError("drink_after_year must not be later than drink_before_year")
        if "observation_count" in value:
            _candidate_number(
                value.get("observation_count"),
                "observation_count",
                minimum=0,
                integer=True,
                nullable=False,
            )
        if "maturity" in value and value["maturity"] is not None:
            _validate_maturity_edit(value["maturity"])
    elif topic == "maturity":
        _validate_maturity_edit(value)
    elif topic == "market_value":
        if not isinstance(value, dict):
            raise ValueError("Market-value candidate must be a JSON object")
        amount = _candidate_number(value.get("amount"), "amount", minimum=0.01, nullable=False)
        currency = _candidate_text(value.get("currency"), "currency", required=True, max_length=16)
        low = _candidate_number(value.get("low"), "low", minimum=0.01)
        high = _candidate_number(value.get("high"), "high", minimum=0.01)
        if low is not None and high is not None and low > high:
            raise ValueError("low must not be greater than high")
        if low is not None and amount is not None and amount < low:
            raise ValueError("amount must not be lower than low")
        if high is not None and amount is not None and amount > high:
            raise ValueError("amount must not be greater than high")
        value["amount"] = amount
        value["currency"] = currency.upper() if currency else currency
    elif topic == "pairing":
        if not isinstance(value, list):
            raise ValueError("Pairing candidate must be a JSON array")
        if len(value) > MAX_MANUAL_RESPONSE_ITEMS:
            raise ValueError("Pairing candidate contains too many items")
        for index, item in enumerate(value):
            if not isinstance(item, dict):
                raise ValueError(f"pairing[{index}] must be a JSON object")
            _candidate_text(
                item.get("dish"),
                f"pairing[{index}].dish",
                required=True,
                max_length=500,
            )
            _candidate_text(item.get("rationale"), f"pairing[{index}].rationale")
            avoid = item.get("avoid", [])
            if not isinstance(avoid, list) or any(not isinstance(x, str) for x in avoid):
                raise ValueError(f"pairing[{index}].avoid must be an array of strings")
            published_at = item.get("published_at")
            if published_at is not None:
                _validate_iso_date_or_datetime(published_at)
    elif topic == "serving":
        if not isinstance(value, dict):
            raise ValueError("Serving candidate must be a JSON object")
        try:
            value = ServingResearch.model_validate(value).model_dump(mode="json")
        except ValidationError as exc:
            message = exc.errors(include_url=False)[0]["msg"]
            raise ValueError(f"Invalid serving candidate: {message}") from exc
    elif topic == "composition":
        if not isinstance(value, dict):
            raise ValueError("Composition candidate must be a JSON object")
        try:
            value = CompositionResearch.model_validate(value).model_dump(mode="json")
        except ValidationError as exc:
            raise ValueError(
                f"Invalid composition candidate: {exc.errors(include_url=False)[0]['msg']}"
            ) from exc
    elif topic == "reviews":
        if not isinstance(value, list):
            raise ValueError("Reviews candidate must be a JSON array")
        try:
            value = [
                ReviewObservation.model_validate(item).model_dump(mode="json") for item in value
            ]
        except ValidationError as exc:
            message = exc.errors(include_url=False)[0]["msg"]
            raise ValueError(f"Invalid review candidate: {message}") from exc
    elif topic == "identifiers":
        if not isinstance(value, list):
            raise ValueError("Identifiers candidate must be a JSON array")
        try:
            value = [
                ExternalIdentifierObservation.model_validate(item).model_dump(mode="json")
                for item in value
            ]
        except ValidationError as exc:
            raise ValueError(
                f"Invalid identifier candidate: {exc.errors(include_url=False)[0]['msg']}"
            ) from exc
    else:
        raise ValueError(f"Candidate topic {topic!r} is not editable")

    return value


def _validate_maturity_edit(value: Any) -> None:
    if not isinstance(value, dict):
        raise ValueError("Maturity value must be a JSON object")
    _candidate_text(value.get("state"), "maturity.state", required=True, max_length=100)
    _candidate_number(
        value.get("readiness_score"),
        "maturity.readiness_score",
        minimum=0,
        maximum=10,
    )
    if not isinstance(value.get("drink_soon"), bool):
        raise ValueError("maturity.drink_soon must be a boolean")
    _candidate_text(value.get("rationale"), "maturity.rationale", required=True)


def edit_candidate(
    conn,
    *,
    candidate_id: str,
    user_id: str,
    value: dict[str, Any] | list[Any],
) -> dict[str, Any]:
    candidate = er.get_candidate(conn, candidate_id)
    if candidate is None:
        raise KeyError("Candidate not found")
    edited = _validate_candidate_edit(candidate, value)
    method = candidate.get("method") or "research"
    if not method.endswith("+user_edit"):
        method = f"{method}+user_edit"
    rationale = (candidate.get("rationale") or "").rstrip()
    edit_note = "Edited by the user before acceptance."
    if edit_note not in rationale:
        rationale = f"{rationale} {edit_note}".strip()
    er.update_candidate_value(
        conn,
        candidate_id,
        value=edited,
        method=method,
        rationale=rationale,
    )
    repo.insert_movement(
        conn,
        Movement(
            id=new_id(),
            action=MovementAction.ENRICH.value,
            wine_id=candidate["wine_id"],
            user_id=user_id,
            note=f"edited enrichment candidate: {candidate['label']}",
            details_json=json.dumps(
                {
                    "candidate_id": candidate_id,
                    "job_id": candidate["job_id"],
                    "topic": candidate["topic"],
                    "previous_value": candidate["value"],
                    "edited_value": edited,
                },
                ensure_ascii=False,
            ),
        ),
    )
    return er.get_candidate(conn, candidate_id) or candidate


def apply_candidate(
    conn,
    *,
    candidate_id: str,
    user_id: str,
    force: bool = False,
) -> dict[str, Any]:
    candidate = er.get_candidate(conn, candidate_id)
    if candidate is None:
        raise KeyError("Candidate not found")
    if candidate["status"] == "accepted":
        return candidate
    wine = repo.get_wine(conn, candidate["wine_id"])
    if wine is None:
        raise KeyError("Wine not found")

    topic = candidate["topic"]
    value = candidate["value"]
    source = f"research:{candidate['job_id']}"
    changed = False

    if topic == "drinking_window":
        after = value.get("drink_after_year")
        before = value.get("drink_before_year")
        manual_after = wine.drink_after is not None and not (
            wine.drink_after_source or ""
        ).startswith("research:")
        manual_before = wine.drink_before is not None and not (
            wine.drink_before_source or ""
        ).startswith("research:")
        if after is not None and (force or not manual_after):
            wine.drink_after = date(int(after), 1, 1)
            wine.drink_after_confidence = candidate["confidence"]
            wine.drink_after_source = source
            changed = True
        if before is not None and (force or not manual_before):
            wine.drink_before = date(int(before), 12, 31)
            wine.drink_before_confidence = candidate["confidence"]
            wine.drink_before_source = source
            changed = True
    elif topic == "market_value" and candidate["label"] == "replacement_value":
        manual = wine.market_value is not None and not (wine.market_value_source or "").startswith(
            "research:"
        )
        if force or not manual:
            wine.market_value = float(value["amount"])
            wine.market_value_confidence = candidate["confidence"]
            wine.market_value_source = source
            wine.market_value_updated_at = utcnow()
            changed = True
    elif topic == "pairing":
        # Automatic acceptance must not erase user-authored advice. Explicit UI
        # acceptance sends force=True and is therefore an intentional override.
        if force or not (wine.advice_pairing or "").strip():
            wine.advice_pairing = _pairing_summary(value)
            changed = True
    elif topic == "serving":
        if force or not (wine.advice_experience or "").strip():
            wine.advice_experience = _serving_summary(value)
            changed = True
    elif topic == "identifiers":
        for item in value:
            nested_confidence = item.get("confidence")
            if nested_confidence is None:
                nested_confidence = candidate["confidence"]
            item_confidence = min(
                float(candidate["confidence"]),
                float(nested_confidence),
            )
            # Keep both accepted stores consistent with the reviewed candidate.
            item["confidence"] = item_confidence
            source_id = next(iter(candidate["source_ids"]), None)
            er.upsert_external_identifier(
                conn,
                wine_id=wine.id,
                scheme=item.get("scheme", "unknown"),
                value=item.get("value", ""),
                confidence=item_confidence,
                source_id=source_id,
            )

    er.upsert_profile_topic(
        conn,
        wine_id=wine.id,
        topic=f"{topic}:{candidate['label']}",
        value=value,
        candidate_id=candidate_id,
    )
    if changed:
        repo.update_wine(conn, wine, expected_version=wine.version)
    er.decide_candidate(conn, candidate_id, status="accepted", reviewer_id=user_id)
    repo.insert_movement(
        conn,
        Movement(
            id=new_id(),
            action=MovementAction.ENRICH.value,
            wine_id=wine.id,
            user_id=user_id,
            note=f"accepted enrichment candidate: {candidate['label']}",
            details_json=json.dumps(
                {
                    "candidate_id": candidate_id,
                    "job_id": candidate["job_id"],
                    "topic": topic,
                    "confidence": candidate["confidence"],
                    "force": force,
                }
            ),
        ),
    )
    return er.get_candidate(conn, candidate_id) or candidate


def reject_candidate(conn, *, candidate_id: str, user_id: str) -> dict[str, Any]:
    candidate = er.get_candidate(conn, candidate_id)
    if candidate is None:
        raise KeyError("Candidate not found")
    er.decide_candidate(conn, candidate_id, status="rejected", reviewer_id=user_id)
    return er.get_candidate(conn, candidate_id) or candidate
