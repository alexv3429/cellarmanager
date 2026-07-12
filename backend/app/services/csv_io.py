"""CSV import and export.

Import is intentionally forgiving: French exports from Excel commonly use
``;`` as the field delimiter (because ``,`` is the decimal separator) and a
``cp1252``/Latin-1 encoding with no BOM, while exports from other tools tend
to be UTF-8 with a comma. Both are auto-detected. Column headers are matched
in either English or French (or a mix), so a CSV re-exported by a French
user can be re-imported without edits.

Mandatory columns (producer, cuvee, appellation, vintage, color, area,
format) must exist in the file, but individual cells may be blank where that
is legitimate (e.g. no vintage for a non-vintage Champagne). A row with no
identifying information at all (producer, cuvee, and appellation all blank)
is skipped with a warning rather than failing the whole import.
"""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from app.core.domain import Cellar, Holding, HoldingState, Wine, WineColor, new_id, utcnow
from app.core.exceptions import ValidationError

# ---------------------------------------------------------------------------
# header aliases (canonical field -> accepted header spellings, EN + FR)
# ---------------------------------------------------------------------------

MANDATORY_FIELDS = ["producer", "cuvee", "appellation", "vintage", "color", "area", "format"]
OPTIONAL_FIELDS = [
    "price_bought", "quantity", "drink_before", "drink_after",
    "cellar", "location", "state", "advice_experience", "advice_pairing", "market_value",
]
ALL_FIELDS = MANDATORY_FIELDS + OPTIONAL_FIELDS

HEADER_ALIASES: dict[str, list[str]] = {
    "producer": ["producer", "producteur"],
    "cuvee": ["cuvee", "cuvée", "wine name", "nom du vin"],
    "appellation": ["appellation"],
    "vintage": ["vintage", "millesime", "millésime", "year", "annee", "année"],
    "color": ["color", "colour", "couleur"],
    "area": ["area", "region", "région", "wine region"],
    "format": ["format", "bottle size", "taille"],
    "price_bought": ["price bought", "purchase price", "price", "prix d'achat", "prix achat", "prix"],
    "quantity": ["quantity", "number of bottles", "bottles", "qty", "quantite", "quantité", "nombre de bouteilles"],
    "drink_before": ["drink before", "best before", "drink by", "a boire avant", "à boire avant"],
    "drink_after": ["drink after", "best after", "a boire apres", "à boire après"],
    "cellar": ["cellar", "cave"],
    "location": ["location", "emplacement", "position"],
    "state": ["state", "status", "etat", "état", "statut"],
    "advice_experience": ["advice experience", "serving advice", "conseil de degustation", "conseil de dégustation", "conseil de service"],
    "advice_pairing": ["advice pairing", "food pairing", "dish association", "accord mets-vin", "accord"],
    "market_value": ["market value", "estimated value", "current value", "valeur marche", "valeur marché", "valeur estimee", "valeur estimée"],
}

# Column headers used on export, keyed by [field][language]
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
    "red": "red", "rouge": "red",
    "white": "white", "blanc": "white",
    "rose": "rose", "rosé": "rose",
    "sparkling": "sparkling", "effervescent": "sparkling", "petillant": "sparkling", "pétillant": "sparkling", "champagne": "sparkling",
    "orange": "orange",
    "fortified": "fortified", "fortifie": "fortified", "fortifié": "fortified", "vin mute": "fortified", "vin muté": "fortified",
}

_STATE_ALIASES = {
    "in cellar": "in_cellar", "in_cellar": "in_cellar", "en cave": "in_cellar",
    "gifted": "gifted", "offerte": "gifted", "offert": "gifted",
    "broken": "broken", "cassee": "broken", "cassée": "broken", "casse": "broken",
    "sold": "sold", "vendue": "sold", "vendu": "sold",
    "lost": "lost", "perdue": "lost", "perdu": "lost",
    "drunk": "drunk", "bue": "drunk", "bu": "drunk",
}


def _strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_header(header: str) -> str:
    return _strip_accents(header.strip().lower())


def _build_alias_lookup() -> dict[str, str]:
    lookup = {}
    for canonical, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            lookup[normalize_header(alias)] = canonical
    return lookup


_ALIAS_LOOKUP = _build_alias_lookup()


def map_headers(raw_headers: list[str]) -> dict[str, str]:
    """Map raw CSV header -> canonical field name, for headers we recognize."""
    mapping = {}
    for raw in raw_headers:
        canonical = _ALIAS_LOOKUP.get(normalize_header(raw))
        if canonical:
            mapping[raw] = canonical
    return mapping


# ---------------------------------------------------------------------------
# value parsing
# ---------------------------------------------------------------------------

def detect_encoding(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            raw.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    return "cp1252"  # common for French Excel exports; near-universal fallback


def sniff_dialect(sample_text: str) -> type[csv.Dialect]:
    try:
        return csv.Sniffer().sniff(sample_text, delimiters=",;\t")
    except csv.Error:
        class _Fallback(csv.excel):
            delimiter = ";" if sample_text.count(";") > sample_text.count(",") else ","
        return _Fallback


def parse_number(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    text = re.sub(r"[^\d,.\-]", "", text)  # drop currency symbols, spaces, etc.
    if not text:
        return None
    # Heuristic: if both separators are present, the last one is the decimal
    # point (e.g. "1.234,56" FR-style or "1,234.56" EN-style).
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        # A single comma with exactly two trailing digits is almost always a
        # decimal separator (French convention); otherwise treat as a
        # thousands separator.
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
    """Parse a date cell. Accepts ISO, DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, or
    a bare year. For a bare year, `year_end_of_year` decides whether it means
    Jan 1 (the earliest acceptable date - used for "drink after") or Dec 31
    (drink by the end of that year - used for "drink before")."""
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
# import
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
    warnings: list[ImportWarning] = field(default_factory=list)
    created_wine_ids: list[str] = field(default_factory=list)
    created_holding_ids: list[str] = field(default_factory=list)

    def add_warning(self, row_number: int, message: str) -> None:
        self.warnings.append(ImportWarning(row_number, message))


def decode_csv_bytes(raw: bytes) -> tuple[list[dict[str, str]], list[str]]:
    """Decode raw CSV bytes into a list of raw-header dict rows, auto-detecting
    encoding and dialect. Returns (rows, raw_fieldnames)."""
    encoding = detect_encoding(raw)
    text = raw.decode(encoding, errors="replace")
    sample = text[:4096]
    dialect = sniff_dialect(sample)
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    fieldnames = reader.fieldnames or []
    rows = list(reader)
    return rows, list(fieldnames)


def import_csv(
    raw: bytes,
    *,
    conn,
    user_id: Optional[str],
    default_cellar_id: Optional[str] = None,
) -> ImportReport:
    """Import a CSV file's bytes. Opens no transaction itself: wrap the call
    in ``Database.session()`` so a failure partway through rolls everything
    back rather than leaving a half-imported cellar."""
    from app.storage import repositories as repo

    rows, raw_headers = decode_csv_bytes(raw)
    header_map = map_headers(raw_headers)
    canonical_present = set(header_map.values())
    missing_mandatory = [f for f in MANDATORY_FIELDS if f not in canonical_present]
    if missing_mandatory:
        raise ValidationError(
            "The CSV is missing required column(s): " + ", ".join(missing_mandatory)
        )

    all_cellars = repo.list_cellars(conn)
    report = ImportReport(total_rows=len(rows))

    for i, raw_row in enumerate(rows, start=2):  # row 1 is the header
        row = {header_map[k]: v for k, v in raw_row.items() if k in header_map}

        producer = (row.get("producer") or "").strip()
        cuvee = (row.get("cuvee") or "").strip() or None
        appellation = (row.get("appellation") or "").strip() or None
        if not producer and not cuvee and not appellation:
            report.skipped += 1
            report.add_warning(i, "Skipped: producer, cuvee and appellation are all empty")
            continue
        if not producer:
            producer = cuvee or appellation or "Unknown producer"
            report.add_warning(i, "Producer was empty; used cuvee/appellation as a placeholder")

        vintage = parse_vintage(row.get("vintage"))
        color = normalize_color(row.get("color"))
        if row.get("color") and color == WineColor.OTHER.value and normalize_header(row["color"]) not in _COLOR_ALIASES:
            report.add_warning(i, f"Unrecognized color '{row.get('color')}', stored as 'other'")
        area = (row.get("area") or "").strip() or None
        fmt = (row.get("format") or "75cl").strip() or "75cl"

        wine = repo.find_wine_by_identity(conn, producer, cuvee, appellation, vintage, fmt)
        if wine is None:
            wine = Wine(
                id=new_id(), producer=producer, cuvee=cuvee, appellation=appellation,
                vintage=vintage, color=color, area=area, format=fmt,
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
            if wine.market_value:
                wine.market_value_confidence, wine.market_value_source = 1.0, "manual"
                wine.market_value_updated_at = utcnow()
            repo.insert_wine(conn, wine)
            report.created_wine_ids.append(wine.id)
            report.imported += 1
        else:
            report.merged_into_existing_wine += 1

        cellar_id = default_cellar_id
        cellar_name = (row.get("cellar") or "").strip()
        location = (row.get("location") or "").strip() or None
        if cellar_name:
            match = repo.get_cellar_by_name(conn, cellar_name)
            if match:
                cellar_id = match.id
            else:
                report.add_warning(i, f"Cellar '{cellar_name}' not found; bottle left unassigned")
                cellar_id = None
        elif location:
            from app.services.cellar_rules import match_cellar_for_location
            match = match_cellar_for_location(location, all_cellars)
            cellar_id = match.id if match else default_cellar_id

        quantity_raw = parse_number(row.get("quantity"))
        quantity = int(quantity_raw) if quantity_raw else 1
        state = normalize_state(row.get("state"))

        existing_holding = repo.find_active_holding(conn, wine.id, cellar_id, location) if state == HoldingState.IN_CELLAR.value else None
        if existing_holding:
            existing_holding.quantity += quantity
            repo.update_holding(conn, existing_holding, expected_version=existing_holding.version)
            holding_id = existing_holding.id
        else:
            holding = Holding(
                id=new_id(), wine_id=wine.id, cellar_id=cellar_id, location=location,
                quantity=quantity, state=state,
                price_bought=parse_number(row.get("price_bought")),
                acquired_date=None,
            )
            repo.insert_holding(conn, holding)
            report.created_holding_ids.append(holding.id)
            holding_id = holding.id

        from app.core.domain import Movement, MovementAction
        repo.insert_movement(conn, Movement(
            id=new_id(), action=MovementAction.IMPORT.value, wine_id=wine.id, holding_id=holding_id,
            to_cellar_id=cellar_id, to_location=location, quantity_delta=quantity,
            user_id=user_id, note="CSV import",
        ))

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
    """Render (wine, holding, cellar) triples to CSV text.

    `columns` controls both which fields are exported and in what order.
    `language` controls header text and the display language of color/state
    enum values (producer/cuvee/appellation/area are proper nouns and are
    never translated). Defaults to ';' for French (matches Excel's French
    locale convention) and ',' otherwise, unless overridden.
    """
    columns = columns or DEFAULT_EXPORT_COLUMNS
    unknown = [c for c in columns if c not in ALL_FIELDS]
    if unknown:
        raise ValidationError(f"Unknown export column(s): {', '.join(unknown)}")
    delim = delimiter or (";" if language == "fr" else ",")

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delim, lineterminator="\n")
    writer.writerow([EXPORT_HEADERS[c].get(language, EXPORT_HEADERS[c]["en"]) for c in columns])

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
        writer.writerow([getters[c](wine, holding, cellar) for c in columns])

    return buffer.getvalue()
