# Production image: dependencies come from the committed uv.lock file.
FROM ghcr.io/astral-sh/uv:0.11.28 AS uv
FROM python:3.12-slim

COPY --from=uv /uv /uvx /bin/
WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-fra \
    && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend ./backend
COPY frontend ./frontend

WORKDIR /srv/backend
ENV PATH="/srv/.venv/bin:$PATH"
ENV WINECELLAR_DB_PATH=/srv/backend/data/winecellar.db
ENV WINECELLAR_HOST=0.0.0.0
ENV WINECELLAR_PORT=8000

EXPOSE 8000
VOLUME ["/srv/backend/data"]
CMD ["python", "run.py"]
