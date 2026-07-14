"""Configuration read from environment variables."""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

logger = logging.getLogger("winecellar")
BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = os.environ.get("WINECELLAR_DB_PATH", str(BASE_DIR / "data" / "winecellar.db"))

_secret_from_env = os.environ.get("WINECELLAR_SECRET_KEY", "").strip()
if _secret_from_env:
    SECRET_KEY = _secret_from_env
else:
    SECRET_KEY = secrets.token_hex(32)
    logger.warning(
        "WINECELLAR_SECRET_KEY is not set. Using a temporary process secret; "
        "all sessions will be invalidated on restart."
    )

TOKEN_TTL_SECONDS = int(os.environ.get("WINECELLAR_TOKEN_TTL_SECONDS", str(12 * 3600)))
DEFAULT_LOCALE = os.environ.get("WINECELLAR_DEFAULT_LOCALE", "en")

# Same-origin deployments need no CORS at all. Explicitly list trusted origins
# only when the frontend is hosted elsewhere; wildcard + credentials is unsafe.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("WINECELLAR_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
FRONTEND_DIR = Path(os.environ.get("WINECELLAR_FRONTEND_DIR", str(BASE_DIR.parent / "frontend")))
LOGIN_MAX_ATTEMPTS = int(os.environ.get("WINECELLAR_LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_WINDOW_SECONDS = int(os.environ.get("WINECELLAR_LOGIN_WINDOW_SECONDS", "300"))

# Optional but strongly recommended for Internet-reachable deployments. The
# first account can only be created by someone who knows this one-time token.
SETUP_TOKEN = os.environ.get("WINECELLAR_SETUP_TOKEN", "").strip()
if not SETUP_TOKEN:
    logger.warning(
        "WINECELLAR_SETUP_TOKEN is not set. The first visitor can bootstrap "
        "the owner account; restrict network access until setup is complete."
    )

ENABLE_DEMO_ENRICHMENT = os.environ.get(
    "WINECELLAR_ENABLE_DEMO_ENRICHMENT", "false"
).strip().lower() in {"1", "true", "yes", "on"}

# Evidence-backed Internet enrichment. Credentials are environment-only and are
# never stored in SQLite or returned by the status endpoint.
OPENAI_API_KEY = (
    os.environ.get("WINECELLAR_OPENAI_API_KEY", "").strip()
    or os.environ.get("OPENAI_API_KEY", "").strip()
)
OPENAI_BASE_URL = os.environ.get("WINECELLAR_OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
OPENAI_ENRICHMENT_MODEL = os.environ.get("WINECELLAR_OPENAI_MODEL", "gpt-5.5").strip()
BRAVE_SEARCH_API_KEY = os.environ.get("BRAVE_SEARCH_API_KEY", "").strip()
MANUAL_CHATGPT_ENABLED = os.environ.get(
    "WINECELLAR_MANUAL_CHATGPT_ENABLED", "true"
).strip().lower() in {"1", "true", "yes", "on"}

ENRICHMENT_PROVIDER = os.environ.get("WINECELLAR_ENRICHMENT_PROVIDER", "openai_web").strip().lower()
if ENRICHMENT_PROVIDER not in {"openai_web", "brave_openai"}:
    logger.warning(
        "Unknown WINECELLAR_ENRICHMENT_PROVIDER=%s; using openai_web",
        ENRICHMENT_PROVIDER,
    )
    ENRICHMENT_PROVIDER = "openai_web"

_raw_provider_order = os.environ.get(
    "WINECELLAR_ENRICHMENT_AUTOMATIC_PROVIDER_ORDER",
    "brave_openai,openai_web",
)
ENRICHMENT_AUTOMATIC_PROVIDER_ORDER = []
for _provider_name in _raw_provider_order.split(","):
    _provider_name = _provider_name.strip().lower()
    if not _provider_name:
        continue
    if _provider_name not in {"openai_web", "brave_openai"}:
        logger.warning(
            "Ignoring unknown automatic enrichment provider %s",
            _provider_name,
        )
        continue
    if _provider_name not in ENRICHMENT_AUTOMATIC_PROVIDER_ORDER:
        ENRICHMENT_AUTOMATIC_PROVIDER_ORDER.append(_provider_name)
ENRICHMENT_ALLOWED_DOMAINS = [
    domain.strip().lower()
    for domain in os.environ.get("WINECELLAR_ENRICHMENT_ALLOWED_DOMAINS", "").split(",")
    if domain.strip()
]
ENRICHMENT_TIMEOUT_SECONDS = float(os.environ.get("WINECELLAR_ENRICHMENT_TIMEOUT_SECONDS", "90"))
ENRICHMENT_MAX_JOBS_PER_DAY = int(os.environ.get("WINECELLAR_ENRICHMENT_MAX_JOBS_PER_DAY", "20"))
ENRICHMENT_MAX_TOKENS_PER_MONTH = int(
    os.environ.get("WINECELLAR_ENRICHMENT_MAX_TOKENS_PER_MONTH", "500000")
)
ENRICHMENT_MIN_IDENTITY_CONFIDENCE = float(
    os.environ.get("WINECELLAR_ENRICHMENT_MIN_IDENTITY_CONFIDENCE", "0.60")
)
ENRICHMENT_AUTO_APPLY_THRESHOLD = float(
    os.environ.get("WINECELLAR_ENRICHMENT_AUTO_APPLY_THRESHOLD", "0.90")
)
ENRICHMENT_MAX_SOURCES = int(os.environ.get("WINECELLAR_ENRICHMENT_MAX_SOURCES", "12"))
ENRICHMENT_MAX_PAIRINGS = int(os.environ.get("WINECELLAR_ENRICHMENT_MAX_PAIRINGS", "8"))
ENRICHMENT_MAX_SEARCH_QUERIES = int(os.environ.get("WINECELLAR_ENRICHMENT_MAX_SEARCH_QUERIES", "4"))
ENRICHMENT_SEARCH_CONTEXT_SIZE = (
    os.environ.get("WINECELLAR_ENRICHMENT_SEARCH_CONTEXT_SIZE", "medium").strip().lower()
)
if ENRICHMENT_SEARCH_CONTEXT_SIZE not in {"low", "medium", "high"}:
    ENRICHMENT_SEARCH_CONTEXT_SIZE = "medium"
ENRICHMENT_CA_BUNDLE = os.environ.get("WINECELLAR_ENRICHMENT_CA_BUNDLE", "").strip()
ENRICHMENT_STORE_RAW_RESPONSE = os.environ.get(
    "WINECELLAR_ENRICHMENT_STORE_RAW_RESPONSE", "false"
).strip().lower() in {"1", "true", "yes", "on"}
