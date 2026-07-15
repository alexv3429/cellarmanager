"""Validated local-filesystem media storage for inventory attachments."""

from __future__ import annotations

import hashlib
import io
import os
import shutil
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app import config
from app.core.domain import new_id
from app.core.exceptions import ValidationError
from app.storage import inventory_repository

MAX_UPLOAD_BYTES = int(os.environ.get("WINECELLAR_MEDIA_MAX_BYTES", str(20 * 1024 * 1024)))
MAX_IMAGE_DIMENSION = int(os.environ.get("WINECELLAR_MEDIA_MAX_DIMENSION", "5000"))
THUMBNAIL_DIMENSION = 480
IMAGE_CATEGORIES = {
    "front_label",
    "back_label",
    "full_bottle",
    "capsule",
    "original_case",
    "condition",
    "cellar_location",
    "other",
}
DOCUMENT_CATEGORIES = {"receipt", "other"}


def media_root() -> Path:
    configured = os.environ.get("WINECELLAR_MEDIA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path(config.DATABASE_PATH).expanduser().resolve().parent / "media").resolve()


@dataclass
class StagedMedia:
    category: str
    original_filename: str
    mime_type: str
    sha256: str
    width: int | None
    height: int | None
    extension: str
    staged_original: Path
    staged_thumbnail: Path | None


@dataclass
class FinalizedMedia:
    metadata: dict
    created_paths: list[Path]


def _safe_filename(filename: str | None) -> str:
    return Path(filename or "upload").name[:255]


def _temporary_path(*, prefix: str, directory: Path) -> Path:
    fd, name = tempfile.mkstemp(prefix=prefix, dir=directory)
    os.close(fd)
    return Path(name)


async def _read_limited(upload: UploadFile) -> bytes:
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValidationError(
            f"'{_safe_filename(upload.filename)}' exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit"
        )
    if not data:
        raise ValidationError(f"'{_safe_filename(upload.filename)}' is empty")
    return data


def _normalize_image(data: bytes) -> tuple[bytes, bytes, str, str, int, int]:
    try:
        with Image.open(io.BytesIO(data)) as opened:
            opened.verify()
        with Image.open(io.BytesIO(data)) as opened:
            image = ImageOps.exif_transpose(opened)
            if image.width <= 0 or image.height <= 0:
                raise ValidationError("Image dimensions are invalid")
            image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
            has_alpha = image.mode in {"RGBA", "LA"} or (
                image.mode == "P" and "transparency" in image.info
            )
            output = io.BytesIO()
            if has_alpha:
                normalized = image.convert("RGBA")
                normalized.save(output, format="PNG", optimize=True)
                mime_type, extension = "image/png", ".png"
            else:
                normalized = image.convert("RGB")
                normalized.save(output, format="JPEG", quality=92, optimize=True)
                mime_type, extension = "image/jpeg", ".jpg"
            width, height = normalized.size

            thumb = normalized.copy()
            thumb.thumbnail((THUMBNAIL_DIMENSION, THUMBNAIL_DIMENSION), Image.Resampling.LANCZOS)
            thumb_output = io.BytesIO()
            if has_alpha:
                thumb.save(thumb_output, format="PNG", optimize=True)
            else:
                thumb.save(thumb_output, format="JPEG", quality=85, optimize=True)
            return output.getvalue(), thumb_output.getvalue(), mime_type, extension, width, height
    except (UnidentifiedImageError, OSError) as exc:
        raise ValidationError("The uploaded file is not a valid supported image") from exc


def _normalize_document(data: bytes, category: str) -> tuple[bytes, str, str, None, None]:
    if category not in DOCUMENT_CATEGORIES or not data.startswith(b"%PDF-"):
        raise ValidationError("Only validated images and PDF receipts/documents are accepted")
    return data, "application/pdf", ".pdf", None, None


async def stage_uploads(files: Iterable[UploadFile], categories: list[str]) -> list[StagedMedia]:
    uploads = list(files)
    if len(uploads) != len(categories):
        raise ValidationError("Each uploaded file must have one media category")
    if len(uploads) > 20:
        raise ValidationError("At most 20 files can be attached in one operation")

    root = media_root()
    staging_dir = root / ".staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    staged: list[StagedMedia] = []
    try:
        for upload, category in zip(uploads, categories, strict=True):
            if category not in IMAGE_CATEGORIES | DOCUMENT_CATEGORIES:
                raise ValidationError(f"Unsupported media category '{category}'")
            data = await _read_limited(upload)
            try:
                normalized, thumbnail, mime_type, extension, width, height = _normalize_image(data)
            except ValidationError:
                normalized, mime_type, extension, width, height = _normalize_document(
                    data, category
                )
                thumbnail = None
            digest = hashlib.sha256(normalized).hexdigest()
            token = new_id()
            staged_original = _temporary_path(prefix=f"{token}-", directory=staging_dir)
            staged_original.write_bytes(normalized)
            staged_thumbnail = None
            if thumbnail is not None:
                staged_thumbnail = _temporary_path(prefix=f"{token}-thumb-", directory=staging_dir)
                staged_thumbnail.write_bytes(thumbnail)
            staged.append(
                StagedMedia(
                    category=category,
                    original_filename=_safe_filename(upload.filename),
                    mime_type=mime_type,
                    sha256=digest,
                    width=width,
                    height=height,
                    extension=extension,
                    staged_original=staged_original,
                    staged_thumbnail=staged_thumbnail,
                )
            )
        return staged
    except Exception:
        cleanup_staged(staged)
        raise


def cleanup_staged(staged: Iterable[StagedMedia]) -> None:
    for item in staged:
        item.staged_original.unlink(missing_ok=True)
        if item.staged_thumbnail:
            item.staged_thumbnail.unlink(missing_ok=True)


def finalize_and_record(
    conn,
    *,
    staged: list[StagedMedia],
    wine_id: str,
    acquisition_id: str,
    holding_id: str,
    user_id: str,
) -> list[FinalizedMedia]:
    root = media_root()
    date_prefix = datetime.now(UTC).strftime("%Y/%m")
    finalized: list[FinalizedMedia] = []
    for item in staged:
        directory = root / item.category / date_prefix
        directory.mkdir(parents=True, exist_ok=True)
        final_path = directory / f"{item.sha256}{item.extension}"
        thumb_path = directory / f"{item.sha256}.thumb{item.extension}"
        created_paths: list[Path] = []
        if not final_path.exists():
            shutil.move(str(item.staged_original), final_path)
            created_paths.append(final_path)
        else:
            item.staged_original.unlink(missing_ok=True)
        relative_thumb: str | None = None
        if item.staged_thumbnail:
            if not thumb_path.exists():
                shutil.move(str(item.staged_thumbnail), thumb_path)
                created_paths.append(thumb_path)
            else:
                item.staged_thumbnail.unlink(missing_ok=True)
            relative_thumb = thumb_path.relative_to(root).as_posix()

        metadata = {
            "id": new_id(),
            "storage_backend": "local",
            "relative_path": final_path.relative_to(root).as_posix(),
            "thumbnail_path": relative_thumb,
            "mime_type": item.mime_type,
            "original_filename": item.original_filename,
            "sha256": item.sha256,
            "width": item.width,
            "height": item.height,
            "category": item.category,
            "wine_id": wine_id,
            "acquisition_id": acquisition_id,
            "holding_id": holding_id if item.category == "cellar_location" else None,
            "created_by": user_id,
            "created_at": datetime.now(UTC).isoformat(),
        }
        inventory_repository.insert_media(conn, metadata)
        finalized.append(FinalizedMedia(metadata=metadata, created_paths=created_paths))
    return finalized


def rollback_finalized(finalized: Iterable[FinalizedMedia]) -> None:
    for item in finalized:
        for path in item.created_paths:
            path.unlink(missing_ok=True)


def resolve_media_path(relative_path: str) -> Path:
    root = media_root()
    resolved = (root / relative_path).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValidationError("Invalid media path")
    return resolved
