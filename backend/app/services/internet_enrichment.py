"""Evidence-backed Internet and AI enrichment for wine records.

The language model is used to search, match, extract and explain. It is never
used as an untraceable source of truth: factual candidates retain source URLs,
identity-match components, deterministic confidence scores and a review state.

Two real provider modes are supported:

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
from typing import Any
from urllib.parse import urlparse

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
    "ai_inference": 0.34,
}


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
class ProviderStatus:
    configured: bool
    provider: str
    model: str | None
    search_provider: str | None
    allowed_domains: list[str]
    available_topics: list[str]
    max_jobs_per_day: int
    max_tokens_per_month: int
    auto_apply_threshold: float
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


def provider_status() -> ProviderStatus:
    openai = bool(config.OPENAI_API_KEY)
    brave = bool(config.BRAVE_SEARCH_API_KEY)
    requested = config.ENRICHMENT_PROVIDER
    if requested == "brave_openai":
        configured = openai and brave
        message = (
            "Brave Search and OpenAI are configured."
            if configured
            else "Set both BRAVE_SEARCH_API_KEY and OPENAI_API_KEY."
        )
        search_provider = "brave"
    else:
        configured = openai
        message = (
            "OpenAI web research is configured."
            if configured
            else "Set OPENAI_API_KEY to enable evidence-backed research."
        )
        search_provider = "openai_web_search"
    return ProviderStatus(
        configured=configured,
        provider=requested,
        model=config.OPENAI_ENRICHMENT_MODEL if openai else None,
        search_provider=search_provider,
        allowed_domains=config.ENRICHMENT_ALLOWED_DOMAINS,
        available_topics=sorted(TOPICS),
        max_jobs_per_day=config.ENRICHMENT_MAX_JOBS_PER_DAY,
        max_tokens_per_month=config.ENRICHMENT_MAX_TOKENS_PER_MONTH,
        auto_apply_threshold=config.ENRICHMENT_AUTO_APPLY_THRESHOLD,
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


def _research_schema() -> dict[str, Any]:
    nullable_string = {"type": ["string", "null"]}
    nullable_number = {"type": ["number", "null"]}
    nullable_integer = {"type": ["integer", "null"]}
    nullable_boolean = {"type": ["boolean", "null"]}

    source_fields = {
        "source_url": {"type": "string"},
        "source_type": {
            "type": "string",
            "enum": [
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
            ],
        },
        "published_at": nullable_string,
        "exact_producer": {"type": "boolean"},
        "exact_cuvee": {"type": "boolean"},
        "exact_vintage": {"type": "boolean"},
        "exact_format": {"type": "boolean"},
    }

    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "identity",
            "drinking_windows",
            "market_observations",
            "pairings",
            "serving",
            "composition",
            "reviews",
            "external_identifiers",
            "summary",
        ],
        "properties": {
            "identity": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "matched_name",
                    "confidence",
                    "explanation",
                    "ambiguities",
                ],
                "properties": {
                    "matched_name": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "explanation": {"type": "string"},
                    "ambiguities": {"type": "array", "items": {"type": "string"}},
                },
            },
            "drinking_windows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "drink_after_year",
                        "drink_before_year",
                        "explicitly_stated",
                        "notes",
                        *source_fields.keys(),
                    ],
                    "properties": {
                        "drink_after_year": nullable_integer,
                        "drink_before_year": nullable_integer,
                        "explicitly_stated": {"type": "boolean"},
                        "notes": {"type": "string"},
                        **source_fields,
                    },
                },
            },
            "market_observations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "amount",
                        "currency",
                        "offer_type",
                        "bottle_count",
                        "format_ml",
                        "tax_included",
                        "in_stock",
                        "observed_at",
                        "notes",
                        *source_fields.keys(),
                    ],
                    "properties": {
                        "amount": {"type": "number", "exclusiveMinimum": 0},
                        "currency": {"type": "string"},
                        "offer_type": {
                            "type": "string",
                            "enum": ["retail", "secondary", "auction", "unknown"],
                        },
                        "bottle_count": {"type": "integer", "minimum": 1},
                        "format_ml": nullable_integer,
                        "tax_included": nullable_boolean,
                        "in_stock": nullable_boolean,
                        "observed_at": nullable_string,
                        "notes": {"type": "string"},
                        **source_fields,
                    },
                },
            },
            "pairings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "dish",
                        "category",
                        "explicitly_stated",
                        "rationale",
                        "avoid",
                        *source_fields.keys(),
                    ],
                    "properties": {
                        "dish": {"type": "string"},
                        "category": {
                            "type": "string",
                            "enum": [
                                "meat",
                                "fish",
                                "vegetarian",
                                "cheese",
                                "dessert",
                                "regional",
                                "casual",
                                "celebration",
                                "other",
                            ],
                        },
                        "explicitly_stated": {"type": "boolean"},
                        "rationale": {"type": "string"},
                        "avoid": {"type": "array", "items": {"type": "string"}},
                        **source_fields,
                    },
                },
            },
            "serving": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "available",
                    "temperature_min_c",
                    "temperature_max_c",
                    "decant_minutes",
                    "stand_upright_hours",
                    "glass",
                    "rationale",
                    "source_urls",
                    "method",
                ],
                "properties": {
                    "available": {"type": "boolean"},
                    "temperature_min_c": nullable_number,
                    "temperature_max_c": nullable_number,
                    "decant_minutes": nullable_integer,
                    "stand_upright_hours": nullable_integer,
                    "glass": nullable_string,
                    "rationale": {"type": "string"},
                    "source_urls": {"type": "array", "items": {"type": "string"}},
                    "method": {
                        "type": "string",
                        "enum": ["source_backed", "style_inference", "unavailable"],
                    },
                },
            },
            "composition": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "available",
                    "grapes",
                    "alcohol_percent",
                    "sweetness",
                    "oak",
                    "certifications",
                    "source_urls",
                ],
                "properties": {
                    "available": {"type": "boolean"},
                    "grapes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["name", "percentage"],
                            "properties": {
                                "name": {"type": "string"},
                                "percentage": nullable_number,
                            },
                        },
                    },
                    "alcohol_percent": nullable_number,
                    "sweetness": nullable_string,
                    "oak": nullable_string,
                    "certifications": {"type": "array", "items": {"type": "string"}},
                    "source_urls": {"type": "array", "items": {"type": "string"}},
                },
            },
            "reviews": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "score",
                        "scale",
                        "reviewer",
                        "review_date",
                        "note_excerpt",
                        "source_url",
                        "exact_vintage",
                    ],
                    "properties": {
                        "score": nullable_number,
                        "scale": nullable_number,
                        "reviewer": {"type": "string"},
                        "review_date": nullable_string,
                        "note_excerpt": {"type": "string", "maxLength": 240},
                        "source_url": {"type": "string"},
                        "exact_vintage": {"type": "boolean"},
                    },
                },
            },
            "external_identifiers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["scheme", "value", "source_url", "confidence"],
                    "properties": {
                        "scheme": {"type": "string"},
                        "value": {"type": "string"},
                        "source_url": {"type": "string"},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                },
            },
            "summary": {"type": "string"},
        },
    }


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
            parsed = json.loads(_extract_output_text(response))
        except json.JSONDecodeError as exc:
            raise ProviderResponseError("Structured output was not valid JSON") from exc
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


def get_provider():
    status = provider_status()
    if not status.configured:
        raise EnrichmentNotConfigured(status.message)
    if config.ENRICHMENT_PROVIDER == "brave_openai":
        return BraveOpenAIResearchProvider()
    return OpenAIResearchProvider()


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
) -> dict[str, str]:
    """Persist only URLs returned by the configured search provider.

    The model may extract a claim's URL, but it is not allowed to manufacture
    evidence. A URL becomes authoritative only when it also appears in the
    OpenAI web-search sources/citations or the Brave result set supplied to the
    model. Unsupported factual claims lose their URL and are filtered before
    candidate aggregation; source-free AI inference remains allowed only for
    pairing and serving advice.
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
        source_type = _source_type_for_url(url, claims)
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
            metadata={"provider": config.ENRICHMENT_PROVIDER},
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
) -> list[str]:
    ids: list[str] = []
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
                    "source_type": "producer" if len(urls) == 1 else "editorial",
                    "exact_producer": True,
                    "exact_cuvee": True,
                    "exact_vintage": bool(wine.vintage),
                    "exact_format": True,
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
                    "source_type": "producer",
                    "exact_producer": True,
                    "exact_cuvee": True,
                    "exact_vintage": bool(wine.vintage),
                    "exact_format": True,
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
                    "source_type": "critic",
                    "exact_producer": True,
                    "exact_cuvee": True,
                    "exact_vintage": item.get("exact_vintage", False),
                    "exact_format": True,
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


def _month_start() -> str:
    today = datetime.now(UTC)
    return today.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


def _day_start() -> str:
    today = datetime.now(UTC)
    return today.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def enforce_budget(conn) -> None:
    if er.jobs_created_since(conn, _day_start()) >= config.ENRICHMENT_MAX_JOBS_PER_DAY:
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
    if not status.configured:
        raise EnrichmentNotConfigured(status.message)
    invalid = set(topics) - TOPICS
    if invalid:
        raise ValueError(f"Unknown enrichment topics: {', '.join(sorted(invalid))}")
    topics = sorted(set(topics)) or sorted(TOPICS)
    enforce_budget(conn)
    return er.create_job(
        conn,
        job_id=new_id(),
        wine_id=wine.id,
        user_id=user_id,
        provider=status.provider,
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
        provider = get_provider()
        parsed, provider_sources, usage, raw_response = provider.research(
            wine, job["topics"], job["locale"]
        )
        source_mapping = _persist_sources(conn, job_id, parsed, provider_sources)
        candidate_ids = _persist_candidates(
            conn,
            job_id=job_id,
            wine=wine,
            topics=job["topics"],
            parsed=parsed,
            source_mapping=source_mapping,
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
            source_id = next(iter(candidate["source_ids"]), None)
            er.upsert_external_identifier(
                conn,
                wine_id=wine.id,
                scheme=item.get("scheme", "unknown"),
                value=item.get("value", ""),
                confidence=float(item.get("confidence") or candidate["confidence"]),
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
