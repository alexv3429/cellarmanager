"""Unified Add inventory API: identity, acquisition, allocation, media and AI candidates."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import ValidationError as PydanticValidationError

from app.api.deps import get_conn, get_current_user_id
from app.api.inventory_schemas import (
    DuplicateCheckIn,
    InventoryCreateIn,
    ManualChatGPTImport,
)
from app.core.exceptions import NotFoundError, ValidationError
from app.services import inventory_service, inventory_vision_service, media_service
from app.storage import inventory_repository

router = APIRouter(
    prefix="/inventory",
    tags=["inventory"],
    dependencies=[Depends(get_current_user_id)],
)


@router.get("/manual-chatgpt-template")
def manual_chatgpt_template():
    schema = ManualChatGPTImport.model_json_schema()
    prompt = (
        "You are preparing a wine-inventory prefill from attached front-label, back-label, capsule, or "
        "bottle photos. First identify the exact producer, cuvee, vintage or NV status, wine type, format, "
        "country, region and appellation. Then research the identified wine using current web sources. "
        "When credible information is available, populate the drinking-window start and end years, concise "
        "serving advice, useful food pairings, and a short review synthesis. Prefer producer material and "
        "reputable specialist or merchant sources; include the URLs actually used in evidence_links. Do not "
        "fabricate critic scores or fill researched fields when the wine identity is uncertain. Never invent "
        "or return quantity, purchase price, currency, purchase date, vendor, taxes, fees, shipping, cellar, "
        "location, bottle condition, provenance, or other owner-owned facts. Use null, empty arrays, or empty "
        "objects when unknown; use 'NV' for clearly non-vintage wine; and include confidence values from 0 "
        "to 1 for the important identity and enrichment fields. Return exactly one object conforming to the "
        "supplied JSON Schema. Use straight ASCII double quotation marks. Return JSON only, with no prose."
    )
    return {"prompt": prompt, "json_schema": schema}


@router.post("/manual-chatgpt-validate")
def validate_manual_chatgpt(payload: ManualChatGPTImport):
    return inventory_service.manual_import_to_prefill(payload)


@router.post("/duplicates")
def duplicate_suggestions(
    payload: DuplicateCheckIn,
    conn: sqlite3.Connection = Depends(get_conn),
):
    return inventory_service.duplicate_suggestions(conn, payload.model_dump(mode="json"))


@router.get("/vision/status")
def vision_status():
    return {
        "configured": inventory_vision_service.configured(),
        "manual_chatgpt_available": True,
    }


@router.post("/vision-prefill")
async def vision_prefill(files: list[UploadFile] = File(...)):
    return await inventory_vision_service.identify_from_photos(files)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_inventory(
    payload: InventoryCreateIn,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    result = inventory_service.create_inventory(conn, payload=payload, user_id=user_id)
    conn.commit()
    return result


@router.post("/with-media", status_code=status.HTTP_201_CREATED)
async def create_inventory_with_media(
    payload: str = Form(...),
    categories: str = Form("[]"),
    files: list[UploadFile] = File(default=[]),
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        parsed_payload = InventoryCreateIn.model_validate_json(payload)
        parsed_categories = json.loads(categories)
        if not isinstance(parsed_categories, list) or not all(
            isinstance(item, str) for item in parsed_categories
        ):
            raise ValueError("categories must be a JSON string array")
    except (PydanticValidationError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    staged = await media_service.stage_uploads(files, parsed_categories)
    finalized: list[media_service.FinalizedMedia] = []
    try:
        result = inventory_service.create_inventory(conn, payload=parsed_payload, user_id=user_id)
        acquisition = result.get("acquisition") or {}
        holding = result.get("holding") or {}
        wine = result.get("wine") or {}
        if not acquisition.get("id") or not holding.get("id") or not wine.get("id"):
            raise ValidationError("Inventory transaction did not return attachable entities")
        if result.get("duplicate"):
            media_service.cleanup_staged(staged)
            result["media"] = [
                dict(row)
                for row in inventory_repository.list_media_for_acquisition(conn, acquisition["id"])
            ]
            conn.commit()
            return result
        finalized = media_service.finalize_and_record(
            conn,
            staged=staged,
            wine_id=wine["id"],
            acquisition_id=acquisition["id"],
            holding_id=holding["id"],
            user_id=user_id,
        )
        conn.commit()
        result["media"] = [item.metadata for item in finalized]
        return result
    except Exception:
        conn.rollback()
        media_service.cleanup_staged(staged)
        media_service.rollback_finalized(finalized)
        raise


@router.get("/media/{media_id}")
def get_media(
    media_id: str,
    thumbnail: bool = False,
    conn: sqlite3.Connection = Depends(get_conn),
):
    record = inventory_repository.get_media(conn, media_id)
    if record is None:
        raise NotFoundError(f"Media {media_id} not found")
    relative = (
        record["thumbnail_path"]
        if thumbnail and record["thumbnail_path"]
        else record["relative_path"]
    )
    path = media_service.resolve_media_path(relative)
    if not path.is_file():
        raise NotFoundError(f"Media file for {media_id} is missing")
    media_type = (
        "image/jpeg" if thumbnail and path.suffix.lower() == ".jpg" else record["mime_type"]
    )
    return FileResponse(
        Path(path),
        media_type=media_type,
        filename=record["original_filename"],
        content_disposition_type="inline",
    )
