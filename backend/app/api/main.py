"""FastAPI application factory and route registration."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import config
from app.api.routers import (
    auth,
    cellars,
    enrichment,
    holdings,
    imports_exports,
    insights,
    wines,
)
from app.core.exceptions import (
    ConfigurationError,
    ConflictError,
    NotFoundError,
    ValidationError,
)

logging.basicConfig(level=logging.INFO)
app = FastAPI(
    title="Wine Cellar Manager API",
    description=(
        "Backend for managing one or more wine cellars: CSV import/export, "
        "bottle add/move/remove with a full journal, statistics, a move-plan "
        "advisor, recommendations, and optional provider-backed enrichment."
    ),
    version="0.2.0",
)

if config.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_credentials="*" not in config.CORS_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    security_values = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "same-origin",
        "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
        "Content-Security-Policy": (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        ),
    }
    if request.url.scheme == "https":
        security_values["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    for name, value in security_values.items():
        if name not in response.headers:
            response.headers[name] = value
    return response


@app.exception_handler(NotFoundError)
def _not_found_handler(request: Request, exc: NotFoundError):
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND, content={"detail": str(exc)}
    )


@app.exception_handler(ValidationError)
def _validation_handler(request: Request, exc: ValidationError):
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": str(exc), "field": exc.field},
    )


@app.exception_handler(ConflictError)
def _conflict_handler(request: Request, exc: ConflictError):
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": {"code": "optimistic_conflict", "message": str(exc)}},
    )


@app.exception_handler(ConfigurationError)
def _configuration_handler(request: Request, exc: ConfigurationError):
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(exc)}
    )


app.include_router(auth.router)
app.include_router(wines.router)
app.include_router(cellars.router)
app.include_router(holdings.router)
app.include_router(imports_exports.router)
app.include_router(insights.router)
app.include_router(enrichment.router)


@app.get("/health")
def health():
    return {"status": "ok"}


# Keep the generic API away from the static /i18n/*.json PWA dictionaries.
# Exact legacy EN/FR routes remain for backward compatibility and cannot match
# /i18n/en.json or /i18n/fr.json. Future locales use /api/i18n/{locale}.
def _translations(locale: str):
    from app.i18n.loader import translate_all

    return translate_all(locale)


@app.get("/api/i18n/{locale}")
def get_translations(locale: str):
    return _translations(locale)


@app.get("/i18n/en")
def get_english_translations():
    return _translations("en")


@app.get("/i18n/fr")
def get_french_translations():
    return _translations("fr")


if config.FRONTEND_DIR.exists():
    app.mount(
        "/",
        StaticFiles(directory=str(config.FRONTEND_DIR), html=True),
        name="frontend",
    )
