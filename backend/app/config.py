"""Configuration, read from environment variables with sane defaults for a
quick local trial. See .env.example for the full list with explanations."""
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
        "WINECELLAR_SECRET_KEY is not set. Using a temporary secret generated for this "
        "process only - all sessions will be invalidated on restart. Set "
        "WINECELLAR_SECRET_KEY in your environment for persistent logins."
    )

TOKEN_TTL_SECONDS = int(os.environ.get("WINECELLAR_TOKEN_TTL_SECONDS", str(12 * 3600)))
DEFAULT_LOCALE = os.environ.get("WINECELLAR_DEFAULT_LOCALE", "en")
CORS_ORIGINS = [o.strip() for o in os.environ.get("WINECELLAR_CORS_ORIGINS", "*").split(",") if o.strip()]
FRONTEND_DIR = Path(os.environ.get("WINECELLAR_FRONTEND_DIR", str(BASE_DIR.parent / "frontend")))
LOGIN_MAX_ATTEMPTS = int(os.environ.get("WINECELLAR_LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_WINDOW_SECONDS = int(os.environ.get("WINECELLAR_LOGIN_WINDOW_SECONDS", "300"))
