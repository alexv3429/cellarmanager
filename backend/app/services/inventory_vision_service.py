"""Optional photo-to-form assistance using the configured OpenAI Responses API."""

from __future__ import annotations

import base64
import io
import json
import urllib.error
import urllib.request
from collections.abc import Iterable

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app import config
from app.api.inventory_schemas import ManualChatGPTImport
from app.core.exceptions import ConfigurationError, ValidationError
from app.services.inventory_service import manual_import_to_prefill

MAX_VISION_IMAGE_BYTES = 12 * 1024 * 1024


def configured() -> bool:
    return bool(config.OPENAI_API_KEY)


async def _image_data_url(upload: UploadFile) -> str:
    data = await upload.read(MAX_VISION_IMAGE_BYTES + 1)
    if not data or len(data) > MAX_VISION_IMAGE_BYTES:
        raise ValidationError("Each AI-assistance photo must be between 1 byte and 12 MB")
    try:
        with Image.open(io.BytesIO(data)) as opened:
            opened.verify()
        with Image.open(io.BytesIO(data)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=88, optimize=True)
    except (UnidentifiedImageError, OSError) as exc:
        raise ValidationError("AI assistance accepts valid images only") from exc
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def _extract_output_text(response: dict) -> str:
    direct = response.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct
    for item in response.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
            if content.get("type") == "refusal":
                raise ValidationError(f"AI assistance declined the image: {content.get('refusal')}")
    raise ValidationError("AI assistance returned no structured text")


async def identify_from_photos(files: Iterable[UploadFile]) -> dict:
    uploads = list(files)
    if not configured():
        raise ConfigurationError(
            "Automatic photo assistance is not configured. Use manual entry or Manual ChatGPT JSON import."
        )
    if not 1 <= len(uploads) <= 3:
        raise ValidationError("Provide one to three label or bottle photos")

    content = [
        {
            "type": "input_text",
            "text": (
                "Identify the wine from these bottle photos. Return JSON only. Populate only facts visible "
                "on the bottle or well-supported wine identity/enrichment facts. Never include quantity, "
                "purchase price, purchase date, vendor, taxes, cellar, location, condition, provenance, "
                "or other owner-specific facts. Use 'NV' for a clearly non-vintage wine. Unknown values "
                "must be null, empty arrays, or empty objects. The JSON must conform to this schema: "
                + json.dumps(ManualChatGPTImport.model_json_schema(), separators=(",", ":"))
            ),
        }
    ]
    for upload in uploads:
        content.append(
            {"type": "input_image", "image_url": await _image_data_url(upload), "detail": "high"}
        )

    request_body = {
        "model": config.OPENAI_ENRICHMENT_MODEL,
        "input": [{"role": "user", "content": content}],
        "text": {"format": {"type": "json_object"}},
        "max_output_tokens": 3000,
    }
    endpoint = config.OPENAI_BASE_URL.rstrip("/") + "/responses"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.ENRICHMENT_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        raise ConfigurationError(f"OpenAI photo assistance failed ({exc.code}): {detail}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ConfigurationError(f"OpenAI photo assistance could not be completed: {exc}") from exc

    raw = _extract_output_text(result)
    try:
        validated = ManualChatGPTImport.model_validate_json(raw)
    except Exception as exc:
        raise ValidationError(
            f"AI response failed strict inventory JSON validation: {exc}"
        ) from exc
    return manual_import_to_prefill(validated)
