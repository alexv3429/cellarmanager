#!/usr/bin/env python3
"""Convenience entry point: `python run.py` starts the API (and, if present,
serves the frontend) on http://localhost:8000. For production, prefer
running uvicorn/gunicorn directly behind a reverse proxy that terminates
HTTPS - see docs/security.md."""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.api.main:app",
        host=os.environ.get("WINECELLAR_HOST", "0.0.0.0"),
        port=int(os.environ.get("WINECELLAR_PORT", "8000")),
        reload=os.environ.get("WINECELLAR_RELOAD", "false").lower() == "true",
    )
