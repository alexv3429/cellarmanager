"""Configuration read from environment variables."""
from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

logger = logging.getLogger("winecellar")
BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = os.environ.get(
    "WINECELLAR_DB_PATH", str(BASE_DIR / "data" / "winecellar.db")
)

_secret_from_env = os.environ.get("WINECELLAR_SECRET_KEY", "").strip()
if _secret_from_env:
    SECRET_KEY = _secret_from_env
else:
    SECRET_KEY = secrets.token_hex(32)
    logger.warning(
        "WINECELLAR_SECRET_KEY is not set. Using a temporary process secret; "
        "all sessions will be invalidated on restart."
    )

TOKEN_TTL_SECONDS = int(
    os.environ.get("WINECELLAR_TOKEN_TTL_SECONDS", str(12 * 3600))
)
DEFAULT_LOCALE = os.environ.get("WINECELLAR_DEFAULT_LOCALE", "en")

# Same-origin deployments need no CORS at all. Explicitly list trusted origins
# only when the frontend is hosted elsewhere; wildcard + credentials is unsafe.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("WINECELLAR_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
FRONTEND_DIR = Path(
    os.environ.get("WINECELLAR_FRONTEND_DIR", str(BASE_DIR.parent / "frontend"))
)
LOGIN_MAX_ATTEMPTS = int(os.environ.get("WINECELLAR_LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_WINDOW_SECONDS = int(
    os.environ.get("WINECELLAR_LOGIN_WINDOW_SECONDS", "300")
)

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
