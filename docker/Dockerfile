# Builds a single image that runs the API and serves the frontend PWA as
# static files (app.api.main mounts ../frontend automatically).
FROM python:3.12-slim

WORKDIR /srv

# tesseract-ocr is a system package (pytesseract, in requirements.txt, just
# shells out to it) - installed here so label OCR (requirement 7) works out
# of the box in the container, not just when installed manually on a host.
# tesseract-ocr-fra is included since wine labels are commonly French.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-fra \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY frontend ./frontend

WORKDIR /srv/backend
ENV WINECELLAR_DB_PATH=/srv/backend/data/winecellar.db
ENV WINECELLAR_HOST=0.0.0.0
ENV WINECELLAR_PORT=8000

EXPOSE 8000
VOLUME ["/srv/backend/data"]

CMD ["python", "run.py"]
