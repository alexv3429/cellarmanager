"""CSV import, analysis, preview and export.

The importer accepts English/French aliases, but it no longer depends on a
particular header vocabulary. A browser can first analyze a CSV, let the user
map arbitrary source columns to CellarManager fields, preview normalized rows,
and then execute the import with exactly that mapping.

Mapping values use stable per-file column IDs (``column_1``, ``column_2``, ...)
so duplicate or blank spreadsheet headers remain distinguishable. A target may
name more than one source column; the first non-empty value wins. This supports
files that contain, for example, a manually corrected drinking window followed
by a calculated fallback window.
"""
from __future__ import annotations

import csv
import difflib
import io
import math
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

from app.core.domain import Cellar, Holding, HoldingState, Wine, WineColor, new_id, utcnow
from app.core.exceptions import ValidationError

# ---------------------------------------------------------------------------
# canonical fields and header aliases
# ---------------------------------------------------------------------------

MANDATORY_FIELDS = ["producer", "cuvee", "appellation", "vintage", "color", "area", "format"]
OPTIONAL_FIELDS = [
    "price_bought",
    "quantity",
    "drink_before",
    "drink_after",
    "cellar",
    "location",
    "state",
    "advice_experience",
    "advice_pairing",
    "market_value",
]
ALL_FIELDS = MANDATORY_FIELDS + OPTIONAL_FIELDS

HEADER_ALIASES: dict[str, list[str]] = {
    "producer": ["producer", "producteur", "domaine", "winery"],
    "cuvee": ["cuvee", "cuvée", "wine name", "nom du vin"],
    "appellation": ["appellation", "aoc", "aop", "do", "doc"],
    "vintage": [
        "vintage",
        "millesime",
        "millésime",
        "year",
        "annee",
        "année",
        "annee prod",
        "année prod",
        "annee production",
        "année production",
    ],
    "color": ["color", "colour", "couleur", "type couleur"],
    "area": ["area", "region", "région", "wine region", "vignoble", "terroir"],
    "format": ["format", "bottle size", "taille", "fmt", "contenance"],
    "price_bought": [
        "price bought",
        "purchase price",
        "price",
        "prix d'achat",
        "prix achat",
        "prix",
        "prix unitaire",
    ],
    "quantity": [
        "quantity",
        "number of bottles",
        "bottles",
        "qty",
        "quantite",
        "quantité",
        "nombre de bouteilles",
        "nb",
        "nb bouteilles",
        "nbre bout",
    ],
    "drink_before": [
        "drink before",
        "best before",
        "drink by",
        "a boire avant",
        "à boire avant",
        "annee max",
        "année max",
        "manuel max",
        "manual max",
    ],
    "drink_after": [
        "drink after",
        "best after",
        "a boire apres",
        "à boire après",
        "annee min",
        "année min",
        "manuel min",
        "manual min",
    ],
    "cellar": ["cellar", "cave", "nom cave"],
    "location": ["location", "emplacement", "position", "place", "casier"],
    "state": ["state", "status", "etat", "état", "statut"],
    "advice_experience": [
        "advice experience",
        "serving advice",
        "conseil de degustation",
        "conseil de dégustation",
        "conseil de service",
        "commentaire",
        "notes",
    ],
    "advice_pairing": [
        "advice pairing",
        "food pairing",
        "dish association",
        "accord mets-vin",
        "accord",
    ],
    "market_value": [
        "market value",
        "estimated value",
        "current value",
        "valeur marche",
        "valeur marché",
        "valeur estimee",
        "valeur estimée",
    ],
}

EXPORT_HEADERS: dict[str, dict[str, str]] = {
    "producer": {"en": "Producer", "fr": "Producteur"},
    "cuvee": {"en": "Cuvee", "fr": "Cuvée"},
    "appellation": {"en": "Appellation", "fr": "Appellation"},
    "vintage": {"en": "Vintage", "fr": "Millésime"},
    "color": {"en": "Color", "fr": "Couleur"},
    "area": {"en": "Area", "fr": "Région"},
    "format": {"en": "Format", "fr": "Format"},
    "price_bought": {"en": "Price bought", "fr": "Prix d'achat"},
    "quantity": {"en": "Quantity", "fr": "Quantité"},
    "drink_before": {"en": "Drink before", "fr": "À boire avant"},
    "drink_after": {"en": "Drink after", "fr": "À boire après"},
    "cellar": {"en": "Cellar", "fr": "Cave"},
    "location": {"en": "Location", "fr": "Emplacement"},
    "state": {"en": "State", "fr": "État"},
    "advice_experience": {"en": "Serving advice", "fr": "Conseil de dégustation"},
    "advice_pairing": {"en": "Dish pairing", "fr": "Accord mets-vin"},
    "market_value": {"en": "Market value", "fr": "Valeur estimée"},
}

COLOR_LABELS: dict[str, dict[str, str]] = {
    "red": {"en": "Red", "fr": "Rouge"},
    "white": {"en": "White", "fr": "Blanc"},
    "rose": {"en": "Rosé", "fr": "Rosé"},
    "sparkling": {"en": "Sparkling", "fr": "Effervescent"},
    "orange": {"en": "Orange", "fr": "Orange"},
    "fortified": {"en": "Fortified", "fr": "Fortifié"},
    "other": {"en": "Other", "fr": "Autre"},
}

STATE_LABELS: dict[str, dict[str, str]] = {
    "in_cellar": {"en": "In cellar", "fr": "En cave"},
    "gifted": {"en": "Gifted", "fr": "Offerte"},
    "broken": {"en": "Broken", "fr": "Cassée"},
    "sold": {"en": "Sold", "fr": "Vendue"},
    "lost": {"en": "Lost", "fr": "Perdue"},
    "drunk": {"en": "Drunk", "fr": "Bue"},
}

_COLOR_ALIASES = {
    "red": "red",
    "rouge": "red",
    "white": "white",
    "blanc": "white",
    "rose": "rose",
    "rosé": "rose",
    "sparkling": "sparkling",
    "effervescent": "sparkling",
    "petillant": "sparkling",
    "pétillant": "sparkling",
    "champagne": "sparkling",
    "orange": "orange",
    "fortified": "fortified",
    "fortifie": "fortified",
    "fortifié": "fortified",
    "vin mute": "fortified",
    "vin muté": "fortified",
}

_STATE_ALIASES = {
    "in cellar": "in_cellar",
    "in_cellar": "in_cellar",
    "en cave": "in_cellar",
    "gifted": "gifted",
    "offerte": "gifted",
    "offert": "gifted",
    "broken": "broken",
    "cassee": "broken",
    "cassée": "broken",
    "casse": "broken",
    "sold": "sold",
    "vendue": "sold",
    "vendu": "sold",
    "lost": "lost",
    "perdue": "lost",
    "perdu": "lost",
    "drunk": "drunk",
    "bue": "drunk",
    "bu": "drunk",
}


def _strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_header(header: str) -> str:
    return re.sub(r"\s+", " ", _strip_accents(header.strip().lower()))


def _build_alias_lookup() -> dict[str, str]:
    lookup: dict[str, str] = {}
    for canonical, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            lookup[normalize_header(alias)] = canonical
    return lookup


_ALIAS_LOOKUP = _build_alias_lookup()
_NORMALIZED_ALIASES = {
    canonical: [normalize_header(alias) for alias in aliases]
    for canonical, aliases in HEADER_ALIASES.items()
}


def map_headers(raw_headers: list[str]) -> dict[str, str]:
    """Map recognized raw headers to canonical fields (legacy API)."""
    mapping: dict[str, str] = {}
    for raw in raw_headers:
        canonical = _ALIAS_LOOKUP.get(normalize_header(raw))
        if canonical:
            mapping[raw] = canonical
    return mapping


# ---------------------------------------------------------------------------
# CSV document, column analysis and mapping
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CsvColumn:
    id: str
    label: str
    original_label: str
    position: int


@dataclass
class CsvDocument:
    encoding: str
    delimiter: str
    columns: list[CsvColumn]
    rows: list[dict[str, str]]
    notices: list[str] = field(default_factory=list)


def detect_encoding(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            raw.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    return "cp1252"


def sniff_dialect(sample_text: str) -> type[csv.Dialect]:
    try:
        return csv.Sniffer().sniff(sample_text, delimiters=",;\t")
    except csv.Error:
        class _Fallback(csv.excel):
            delimiter = ";" if sample_text.count(";") > sample_text.count(",") else ","
        return _Fallback


def decode_csv_document(raw: bytes) -> CsvDocument:
    """Read a CSV while preserving duplicate and blank columns.

    ``csv.DictReader`` cannot distinguish duplicate headers. The mapping UI
    needs stable source identities, so every physical position receives its own
    ID and a human-readable label.
    """
    if not raw:
        raise ValidationError("The CSV file is empty")

    encoding = detect_encoding(raw)
    text = raw.decode(encoding, errors="replace")
    dialect = sniff_dialect(text[:4096])
    matrix = list(csv.reader(io.StringIO(text), dialect=dialect))
    while matrix and not any(cell.strip() for cell in matrix[0]):
        matrix.pop(0)
    if not matrix:
        raise ValidationError("The CSV file contains no header row")

    header_cells = list(matrix[0])
    data_rows = matrix[1:]
    max_width = max([len(header_cells), *(len(row) for row in data_rows)] or [0])
    if max_width == 0:
        raise ValidationError("The CSV file contains no columns")
    header_cells.extend([""] * (max_width - len(header_cells)))

    # Completely blank trailing spreadsheet columns do not help the user and
    # can make a mapping table unwieldy. Keep a blank-header column only when it
    # actually contains data.
    active_indices = [
        index
        for index in range(max_width)
        if header_cells[index].strip()
        or any(index < len(row) and row[index].strip() for row in data_rows)
    ]
    if not active_indices:
        raise ValidationError("The CSV file contains no usable columns")

    notices: list[str] = []
    seen_labels: dict[str, int] = {}
    columns: list[CsvColumn] = []
    for index in active_indices:
        original = header_cells[index]
        base = original.strip() or f"Column {index + 1}"
        normalized = normalize_header(base)
        occurrence = seen_labels.get(normalized, 0) + 1
        seen_labels[normalized] = occurrence
        label = base if occurrence == 1 else f"{base} ({occurrence})"
        if not original.strip():
            notices.append(f"Column {index + 1} has no header and was named '{label}'")
        elif occurrence > 1:
            notices.append(f"Duplicate header '{base}' was renamed '{label}'")
        columns.append(
            CsvColumn(
                id=f"column_{index + 1}",
                label=label,
                original_label=original,
                position=index,
            )
        )

    rows: list[dict[str, str]] = []
    for source_row in data_rows:
        rows.append(
            {
                column.id: source_row[column.position] if column.position < len(source_row) else ""
                for column in columns
            }
        )

    return CsvDocument(
        encoding=encoding,
        delimiter=dialect.delimiter,
        columns=columns,
        rows=rows,
        notices=notices,
    )


def decode_csv_bytes(raw: bytes) -> tuple[list[dict[str, str]], list[str]]:
    """Compatibility wrapper returning rows keyed by unique display labels."""
    document = decode_csv_document(raw)
    label_by_id = {column.id: column.label for column in document.columns}
    return (
        [
            {label_by_id[column_id]: value for column_id, value in row.items()}
            for row in document.rows
        ],
        [column.label for column in document.columns],
    )


def _manual_fallback_priority(canonical: str, label: str) -> tuple[int, int]:
    normalized = normalize_header(label)
    if canonical in {"drink_after", "drink_before"}:
        if "manuel" in normalized or "manual" in normalized:
            return (0, 0)
        if "annee" in normalized or "year" in normalized:
            return (1, 0)
    return (2, 0)


def _fuzzy_canonical(label: str) -> tuple[Optional[str], float]:
    normalized = normalize_header(label)
    if not normalized or len(normalized) < 3:
        return None, 0.0
    best_field: Optional[str] = None
    best_score = 0.0
    for canonical, aliases in _NORMALIZED_ALIASES.items():
        for alias in aliases:
            score = difflib.SequenceMatcher(a=normalized, b=alias).ratio()
            if score > best_score:
                best_field, best_score = canonical, score
    return (best_field, best_score) if best_score >= 0.84 else (None, best_score)


def suggest_mapping(columns: list[CsvColumn]) -> dict[str, dict[str, Any]]:
    candidates: dict[str, list[tuple[CsvColumn, str, float]]] = {}
    for column in columns:
        normalized = normalize_header(column.original_label or column.label)
        canonical = _ALIAS_LOOKUP.get(normalized)
        confidence = "exact"
        score = 1.0
        if canonical is None:
            canonical, score = _fuzzy_canonical(column.original_label or column.label)
            confidence = "suggested"
        if canonical:
            candidates.setdefault(canonical, []).append((column, confidence, score))

    result: dict[str, dict[str, Any]] = {}
    for canonical, entries in candidates.items():
        entries.sort(
            key=lambda item: (
                _manual_fallback_priority(canonical, item[0].original_label or item[0].label),
                -item[2],
                item[0].position,
            )
        )
        # Two source columns are enough for the common manual/calculated
        # fallback case and avoid accidentally swallowing unrelated duplicates.
        selected = entries[:2]
        result[canonical] = {
            "columns": [entry[0].id for entry in selected],
            "confidence": "exact" if all(entry[1] == "exact" for entry in selected) else "suggested",
        }
    return result


def analyze_csv(raw: bytes, *, sample_limit: int = 8) -> dict[str, Any]:
    document = decode_csv_document(raw)
    suggestions = suggest_mapping(document.columns)
    headers = []
    for column in document.columns:
        samples = [
            row.get(column.id, "").strip()
            for row in document.rows
            if row.get(column.id, "").strip()
        ][:3]
        headers.append(
            {
                "id": column.id,
                "label": column.label,
                "position": column.position + 1,
                "samples": samples,
            }
        )
    return {
        "encoding": document.encoding,
        "delimiter": document.delimiter,
        "total_rows": len(document.rows),
        "headers": headers,
        "sample_rows": document.rows[:sample_limit],
        "suggested_mapping": suggestions,
        "notices": document.notices,
        "mandatory_fields": MANDATORY_FIELDS,
        "optional_fields": OPTIONAL_FIELDS,
    }


def _mapping_columns(spec: Any) -> list[str]:
    if spec is None:
        return []
    if isinstance(spec, str):
        return [spec] if spec else []
    if isinstance(spec, list):
        return [str(item) for item in spec if item]
    if isinstance(spec, dict):
        columns = spec.get("columns", [])
        if isinstance(columns, str):
            return [columns] if columns else []
        if isinstance(columns, list):
            return [str(item) for item in columns if item]
    raise ValidationError("Each mapping entry must contain a source column or a list of source columns")


def normalize_column_mapping(
    mapping: Optional[dict[str, Any]],
    document: CsvDocument,
) -> dict[str, list[str]]:
    """Validate a user mapping and return canonical -> ordered column IDs."""
    if mapping is None:
        mapping = suggest_mapping(document.columns)
    if not isinstance(mapping, dict):
        raise ValidationError("CSV mapping must be a JSON object")

    by_id = {column.id: column.id for column in document.columns}
    by_label: dict[str, str] = {}
    original_counts: dict[str, int] = {}
    for column in document.columns:
        by_label[column.label] = column.id
        if column.original_label:
            original_counts[column.original_label] = original_counts.get(column.original_label, 0) + 1
    for column in document.columns:
        if column.original_label and original_counts[column.original_label] == 1:
            by_label[column.original_label] = column.id

    normalized: dict[str, list[str]] = {}
    source_owners: dict[str, str] = {}
    for canonical, spec in mapping.items():
        if canonical not in ALL_FIELDS:
            raise ValidationError(f"Unknown import target field: {canonical}")
        resolved: list[str] = []
        for source in _mapping_columns(spec):
            source_id = by_id.get(source) or by_label.get(source)
            if source_id is None:
                raise ValidationError(f"Mapped CSV column no longer exists: {source}")
            if source_id in resolved:
                continue
            owner = source_owners.get(source_id)
            if owner and owner != canonical:
                raise ValidationError(
                    f"CSV column '{source}' is mapped to both '{owner}' and '{canonical}'"
                )
            source_owners[source_id] = canonical
            resolved.append(source_id)
        if resolved:
            normalized[canonical] = resolved

    missing = [field for field in MANDATORY_FIELDS if not normalized.get(field)]
    if missing:
        raise ValidationError("Missing required field mapping(s): " + ", ".join(missing))
    return normalized


def _first_non_empty(raw_row: dict[str, str], source_ids: list[str]) -> Optional[str]:
    first_value: Optional[str] = None
    for source_id in source_ids:
        value = raw_row.get(source_id)
        if first_value is None:
            first_value = value
        if value is not None and value.strip():
            return value
    return first_value


def map_source_row(raw_row: dict[str, str], mapping: dict[str, list[str]]) -> dict[str, Optional[str]]:
    return {
        canonical: _first_non_empty(raw_row, source_ids)
        for canonical, source_ids in mapping.items()
    }


# ---------------------------------------------------------------------------
# value parsing
# ---------------------------------------------------------------------------

def parse_number(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    text = re.sub(r"[^\d,.\-]", "", text)
    if not text:
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        if re.match(r"^-?\d+,\d{1,2}$", text):
            text = text.replace(",", ".")
        else:
            text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def parse_vintage(raw: Optional[str]) -> Optional[int]:
    if raw is None:
        return None
    text = raw.strip().upper()
    if not text or text in ("NV", "N/V", "NON VINTAGE", "SANS MILLESIME", "SANS MILLÉSIME"):
        return None
    match = re.search(r"(1[5-9]\d{2}|20\d{2})", text)
    return int(match.group(1)) if match else None


_DATE_PATTERNS = [
    ("%Y-%m-%d", "iso"),
    ("%d/%m/%Y", "fr_slash"),
    ("%d-%m-%Y", "fr_dash"),
    ("%m/%d/%Y", "us_slash"),
]


def parse_date_value(raw: Optional[str], *, year_end_of_year: bool = False) -> Optional[date]:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    if re.fullmatch(r"(1[5-9]\d{2}|20\d{2})", text):
        year = int(text)
        return date(year, 12, 31) if year_end_of_year else date(year, 1, 1)
    from datetime import datetime as _dt
    for fmt, _name in _DATE_PATTERNS:
        try:
            return _dt.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def parse_positive_quantity(raw: Optional[str]) -> int:
    if raw is None or not raw.strip():
        return 1
    value = parse_number(raw)
    if value is None or not math.isfinite(value) or value <= 0 or not value.is_integer():
        raise ValidationError(f"Invalid quantity '{raw}': expected a positive whole number")
    return int(value)


def _merge_import_purchase_metadata(
    holding: Holding,
    *,
    old_quantity: int,
    added_quantity: int,
    incoming_price: Optional[float],
) -> None:
    if incoming_price is not None and incoming_price < 0:
        raise ValidationError("Purchase price cannot be negative")
    if old_quantity <= 0:
        holding.price_bought = incoming_price
    elif holding.price_bought is not None and incoming_price is not None:
        holding.price_bought = round(
            (holding.price_bought * old_quantity + incoming_price * added_quantity)
            / (old_quantity + added_quantity),
            4,
        )
    elif added_quantity > 0:
        holding.price_bought = None


def normalize_color(raw: Optional[str]) -> str:
    if not raw:
        return WineColor.OTHER.value
    key = _strip_accents(raw.strip().lower())
    return _COLOR_ALIASES.get(key, WineColor.OTHER.value)


def normalize_state(raw: Optional[str]) -> str:
    if not raw:
        return HoldingState.IN_CELLAR.value
    key = _strip_accents(raw.strip().lower())
    return _STATE_ALIASES.get(key, HoldingState.IN_CELLAR.value)


_FORMAT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(cl|ml|l)\b", re.IGNORECASE)


def parse_format_ml(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    match = _FORMAT_RE.search(raw.replace(",", "."))
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).lower()
    multiplier = {"cl": 10, "ml": 1, "l": 1000}[unit]
    return round(value * multiplier)


# ---------------------------------------------------------------------------
# preview and import
# ---------------------------------------------------------------------------

@dataclass
class ImportWarning:
    row_number: int
    message: str


@dataclass
class ImportReport:
    total_rows: int = 0
    imported: int = 0
    merged_into_existing_wine: int = 0
    skipped: int = 0
    unassigned_rows: int = 0
    unassigned_bottles: int = 0
    warnings: list[ImportWarning] = field(default_factory=list)
    created_wine_ids: list[str] = field(default_factory=list)
    created_holding_ids: list[str] = field(default_factory=list)

    def add_warning(self, row_number: int, message: str) -> None:
        self.warnings.append(ImportWarning(row_number, message))


def _resolve_destination(
    row: dict[str, Optional[str]],
    *,
    conn,
    all_cellars: list[Cellar],
    default_cellar_id: Optional[str],
) -> tuple[Optional[str], Optional[str], list[str]]:
    from app.storage import repositories as repo

    warnings: list[str] = []
    cellar_id = default_cellar_id
    cellar_name = (row.get("cellar") or "").strip()
    location = (row.get("location") or "").strip() or None
    selected_cellar = None
    if cellar_name:
        selected_cellar = repo.get_cellar_by_name(conn, cellar_name)
        if selected_cellar:
            cellar_id = selected_cellar.id
        else:
            warnings.append(f"Cellar '{cellar_name}' not found; bottle will be left unassigned")
            cellar_id = None
    elif location:
        from app.services import cellar_rules
        selected_cellar = cellar_rules.match_cellar_for_location(location, all_cellars)
        cellar_id = selected_cellar.id if selected_cellar else default_cellar_id
        if selected_cellar is None and default_cellar_id:
            selected_cellar = next(
                (cellar for cellar in all_cellars if cellar.id == default_cellar_id),
                None,
            )
        if selected_cellar is None and default_cellar_id is None:
            if all_cellars:
                warnings.append(
                    f"No cellar location naming scheme matches '{location}'; bottle will remain unassigned until a matching cellar is configured"
                )
            else:
                warnings.append(
                    "No cellar exists yet; bottle will remain unassigned and will be matched automatically after a cellar with a suitable location naming scheme is created"
                )
    elif cellar_id is None:
        warnings.append(
            "No cellar or location was provided; bottle will remain unassigned until assigned manually"
        )
    if selected_cellar is None and cellar_id:
        selected_cellar = next(
            (cellar for cellar in all_cellars if cellar.id == cellar_id),
            None,
        )
    if selected_cellar is not None and location:
        from app.services import cellar_rules
        location = cellar_rules.normalize_location_for_cellar(selected_cellar, location)
    return cellar_id, location, warnings


def _preview_values(
    row: dict[str, Optional[str]],
    *,
    row_number: int,
    conn,
    all_cellars: list[Cellar],
    default_cellar_id: Optional[str],
) -> tuple[str, dict[str, Any], list[str]]:
    from app.storage import repositories as repo

    warnings: list[str] = []
    producer = (row.get("producer") or "").strip()
    cuvee = (row.get("cuvee") or "").strip()
    appellation = (row.get("appellation") or "").strip()
    if not producer and not cuvee and not appellation:
        return "skipped", {}, ["Producer, cuvee and appellation are all empty"]
    if not producer:
        producer = cuvee or appellation or "Unknown producer"
        warnings.append("Producer is empty; cuvee/appellation will be used as a placeholder")

    raw_color = row.get("color")
    color = normalize_color(raw_color)
    if raw_color and color == WineColor.OTHER.value and normalize_header(raw_color) not in _COLOR_ALIASES:
        warnings.append(f"Unrecognized color '{raw_color}', stored as 'other'")

    try:
        quantity = parse_positive_quantity(row.get("quantity"))
        price_bought = parse_number(row.get("price_bought"))
        if row.get("price_bought") and price_bought is None:
            raise ValidationError(f"Invalid purchase price '{row.get('price_bought')}'")
        if price_bought is not None and price_bought < 0:
            raise ValidationError("Purchase price cannot be negative")
    except ValidationError as exc:
        return "error", {}, [str(exc)]

    drink_after = parse_date_value(row.get("drink_after"), year_end_of_year=False)
    drink_before = parse_date_value(row.get("drink_before"), year_end_of_year=True)
    if row.get("drink_after") and not drink_after:
        warnings.append(f"Could not parse drink-after value '{row.get('drink_after')}'")
    if row.get("drink_before") and not drink_before:
        warnings.append(f"Could not parse drink-before value '{row.get('drink_before')}'")

    cellar_id, location, destination_warnings = _resolve_destination(
        row,
        conn=conn,
        all_cellars=all_cellars,
        default_cellar_id=default_cellar_id,
    )
    warnings.extend(destination_warnings)
    cellar = repo.get_cellar(conn, cellar_id) if cellar_id else None

    values = {
        "producer": producer,
        "cuvee": cuvee,
        "appellation": appellation,
        "vintage": parse_vintage(row.get("vintage")),
        "color": color,
        "area": (row.get("area") or "").strip(),
        "format": (row.get("format") or "75cl").strip() or "75cl",
        "quantity": quantity,
        "price_bought": price_bought,
        "drink_after": drink_after.isoformat() if drink_after else None,
        "drink_before": drink_before.isoformat() if drink_before else None,
        "cellar": cellar.name if cellar else None,
        "location": location,
        "state": normalize_state(row.get("state")),
    }
    return "valid", values, warnings


def preview_csv(
    raw: bytes,
    *,
    mapping: dict[str, Any],
    conn,
    default_cellar_id: Optional[str] = None,
    max_preview_rows: int = 20,
) -> dict[str, Any]:
    from app.storage import repositories as repo

    document = decode_csv_document(raw)
    normalized_mapping = normalize_column_mapping(mapping, document)
    all_cellars = repo.list_cellars(conn)

    valid_rows = 0
    skipped_rows = 0
    error_rows = 0
    unassigned_rows = 0
    unassigned_bottles = 0
    preview_rows: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    for index, raw_row in enumerate(document.rows, start=2):
        canonical_row = map_source_row(raw_row, normalized_mapping)
        status, values, row_warnings = _preview_values(
            canonical_row,
            row_number=index,
            conn=conn,
            all_cellars=all_cellars,
            default_cellar_id=default_cellar_id,
        )
        if status == "valid":
            valid_rows += 1
            if values.get("cellar") is None and values.get("state") == HoldingState.IN_CELLAR.value:
                unassigned_rows += 1
                unassigned_bottles += int(values.get("quantity") or 0)
        elif status == "skipped":
            skipped_rows += 1
        else:
            error_rows += 1
        for message in row_warnings:
            warnings.append({"row": index, "message": message, "severity": "error" if status == "error" else "warning"})
        if len(preview_rows) < max_preview_rows:
            preview_rows.append(
                {
                    "row": index,
                    "status": status,
                    "values": values,
                    "warnings": row_warnings,
                }
            )

    return {
        "total_rows": len(document.rows),
        "valid_rows": valid_rows,
        "skipped_rows": skipped_rows,
        "error_rows": error_rows,
        "unassigned_rows": unassigned_rows,
        "unassigned_bottles": unassigned_bottles,
        "preview_rows": preview_rows,
        "warnings": warnings,
        "can_import": valid_rows > 0,
    }


def import_csv(
    raw: bytes,
    *,
    conn,
    user_id: Optional[str],
    default_cellar_id: Optional[str] = None,
    mapping: Optional[dict[str, Any]] = None,
) -> ImportReport:
    """Import bytes using either a user mapping or automatic suggestions."""
    from app.storage import repositories as repo

    document = decode_csv_document(raw)
    normalized_mapping = normalize_column_mapping(mapping, document)
    all_cellars = repo.list_cellars(conn)
    report = ImportReport(total_rows=len(document.rows))

    for row_number, raw_row in enumerate(document.rows, start=2):
        row = map_source_row(raw_row, normalized_mapping)
        producer = (row.get("producer") or "").strip()
        cuvee = (row.get("cuvee") or "").strip() or None
        appellation = (row.get("appellation") or "").strip() or None
        if not producer and not cuvee and not appellation:
            report.skipped += 1
            report.add_warning(row_number, "Skipped: producer, cuvee and appellation are all empty")
            continue
        if not producer:
            producer = cuvee or appellation or "Unknown producer"
            report.add_warning(row_number, "Producer was empty; used cuvee/appellation as a placeholder")

        # Validate stock data before creating a Wine. An invalid quantity must
        # not leave an orphan wine record behind.
        try:
            quantity = parse_positive_quantity(row.get("quantity"))
            price_bought = parse_number(row.get("price_bought"))
            if row.get("price_bought") and price_bought is None:
                raise ValidationError(f"Invalid purchase price '{row.get('price_bought')}'")
            if price_bought is not None and price_bought < 0:
                raise ValidationError("Purchase price cannot be negative")
        except ValidationError as exc:
            report.skipped += 1
            report.add_warning(row_number, f"Skipped: {exc}")
            continue

        vintage = parse_vintage(row.get("vintage"))
        color = normalize_color(row.get("color"))
        if row.get("color") and color == WineColor.OTHER.value and normalize_header(row["color"] or "") not in _COLOR_ALIASES:
            report.add_warning(row_number, f"Unrecognized color '{row.get('color')}', stored as 'other'")
        area = (row.get("area") or "").strip() or None
        fmt = (row.get("format") or "75cl").strip() or "75cl"

        cellar_id, location, destination_warnings = _resolve_destination(
            row,
            conn=conn,
            all_cellars=all_cellars,
            default_cellar_id=default_cellar_id,
        )
        for message in destination_warnings:
            report.add_warning(row_number, message)

        wine = repo.find_wine_by_identity(conn, producer, cuvee, appellation, vintage, fmt)
        if wine is None:
            wine = Wine(
                id=new_id(),
                producer=producer,
                cuvee=cuvee,
                appellation=appellation,
                vintage=vintage,
                color=color,
                area=area,
                format=fmt,
                format_ml=parse_format_ml(fmt),
                drink_after=parse_date_value(row.get("drink_after"), year_end_of_year=False),
                drink_before=parse_date_value(row.get("drink_before"), year_end_of_year=True),
                market_value=parse_number(row.get("market_value")),
                advice_experience=(row.get("advice_experience") or "").strip() or None,
                advice_pairing=(row.get("advice_pairing") or "").strip() or None,
            )
            if wine.drink_after:
                wine.drink_after_confidence, wine.drink_after_source = 1.0, "manual"
            if wine.drink_before:
                wine.drink_before_confidence, wine.drink_before_source = 1.0, "manual"
            if wine.market_value is not None:
                wine.market_value_confidence, wine.market_value_source = 1.0, "manual"
                wine.market_value_updated_at = utcnow()
            repo.insert_wine(conn, wine)
            report.created_wine_ids.append(wine.id)
            report.imported += 1
        else:
            report.merged_into_existing_wine += 1

        state = normalize_state(row.get("state"))
        if cellar_id is None and state == HoldingState.IN_CELLAR.value:
            report.unassigned_rows += 1
            report.unassigned_bottles += quantity
        existing_holding = (
            repo.find_active_holding(conn, wine.id, cellar_id, location)
            if state == HoldingState.IN_CELLAR.value
            else None
        )
        if existing_holding:
            old_quantity = existing_holding.quantity
            _merge_import_purchase_metadata(
                existing_holding,
                old_quantity=old_quantity,
                added_quantity=quantity,
                incoming_price=price_bought,
            )
            existing_holding.quantity += quantity
            repo.update_holding(conn, existing_holding, expected_version=existing_holding.version)
            holding_id = existing_holding.id
        else:
            holding = Holding(
                id=new_id(),
                wine_id=wine.id,
                cellar_id=cellar_id,
                location=location,
                quantity=quantity,
                state=state,
                price_bought=price_bought,
                acquired_date=None,
            )
            repo.insert_holding(conn, holding)
            report.created_holding_ids.append(holding.id)
            holding_id = holding.id

        from app.core.domain import Movement, MovementAction
        repo.insert_movement(
            conn,
            Movement(
                id=new_id(),
                action=MovementAction.IMPORT.value,
                wine_id=wine.id,
                holding_id=holding_id,
                to_cellar_id=cellar_id,
                to_location=location,
                quantity_delta=quantity,
                user_id=user_id,
                note="CSV import",
            ),
        )

    return report


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

DEFAULT_EXPORT_COLUMNS = ALL_FIELDS


def export_csv(
    rows: list[tuple[Wine, Holding, Optional[Cellar]]],
    *,
    columns: Optional[list[str]] = None,
    language: str = "en",
    delimiter: Optional[str] = None,
) -> str:
    columns = columns or DEFAULT_EXPORT_COLUMNS
    unknown = [column for column in columns if column not in ALL_FIELDS]
    if unknown:
        raise ValidationError(f"Unknown export column(s): {', '.join(unknown)}")
    delim = delimiter or (";" if language == "fr" else ",")

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delim, lineterminator="\n")
    writer.writerow([EXPORT_HEADERS[column].get(language, EXPORT_HEADERS[column]["en"]) for column in columns])

    getters = {
        "producer": lambda w, h, c: w.producer,
        "cuvee": lambda w, h, c: w.cuvee or "",
        "appellation": lambda w, h, c: w.appellation or "",
        "vintage": lambda w, h, c: w.vintage if w.vintage else ("NV" if language != "fr" else "SM"),
        "color": lambda w, h, c: COLOR_LABELS.get(w.color, COLOR_LABELS["other"]).get(language, w.color),
        "area": lambda w, h, c: w.area or "",
        "format": lambda w, h, c: w.format,
        "price_bought": lambda w, h, c: h.price_bought if h.price_bought is not None else "",
        "quantity": lambda w, h, c: h.quantity,
        "drink_before": lambda w, h, c: w.drink_before.isoformat() if w.drink_before else "",
        "drink_after": lambda w, h, c: w.drink_after.isoformat() if w.drink_after else "",
        "cellar": lambda w, h, c: c.name if c else "",
        "location": lambda w, h, c: h.location or "",
        "state": lambda w, h, c: STATE_LABELS.get(h.state, STATE_LABELS["in_cellar"]).get(language, h.state),
        "advice_experience": lambda w, h, c: w.advice_experience or "",
        "advice_pairing": lambda w, h, c: w.advice_pairing or "",
        "market_value": lambda w, h, c: w.market_value if w.market_value is not None else "",
    }

    for wine, holding, cellar in rows:
        writer.writerow([getters[column](wine, holding, cellar) for column in columns])
    return buffer.getvalue()
