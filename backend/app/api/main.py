"""FastAPI application factory and route registration.

Run locally with:  uvicorn app.api.main:app --reload
or simply:          python run.py
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import config
from app.api.routers import auth, cellars, enrichment, holdings, imports_exports, insights, wines
from app.core.exceptions import ConfigurationError, ConflictError, NotFoundError, ValidationError

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Wine Cellar Manager API",
    description=(
        "Backend for managing one or more wine cellars: CSV import/export, "
        "bottle add/move/remove with a full journal, statistics, a move-plan "
        "advisor, recommendations, and optional drink-window/market-value "
        "enrichment. See /docs for interactive API documentation."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(NotFoundError)
def _not_found_handler(request: Request, exc: NotFoundError):
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"detail": str(exc)})


@app.exception_handler(ValidationError)
def _validation_handler(request: Request, exc: ValidationError):
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(exc), "field": exc.field})


@app.exception_handler(ConflictError)
def _conflict_handler(request: Request, exc: ConflictError):
    return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": str(exc)})


@app.exception_handler(ConfigurationError)
def _configuration_handler(request: Request, exc: ConfigurationError):
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(exc)})


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


@app.get("/i18n/{locale}")
def get_translations(locale: str):
    from app.i18n.loader import translate_all
    return translate_all(locale)


# Serve the frontend PWA (static files) if present, so the whole app can be
# hosted from a single process. In development you can also just open
# frontend/index.html directly, or serve it separately, and point it at this
# API's URL.
if config.FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR), html=True), name="frontend")
