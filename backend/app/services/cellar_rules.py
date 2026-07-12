"""Cellar location structures and matching.

Normal users choose one of five structured presets stored in the cellar's
existing JSON ``layout`` field:

* ``loose``: no fixed positions, optionally named boxes/containers;
* ``grid``: row/column codes such as ``A1``;
* ``grid_sub``: row/column slots with sub-positions such as ``A1.1``;
* ``sequential``: a physical grid labelled A, B, C ... in display order;
* ``depth``: numbered rows with depth codes such as ``G1F`` / ``G1B``.

The server validates each scheme, generates an explicit location catalog in
the layout JSON, and performs exact matching against that catalog. Legacy
plain-prefix and regular-expression rules remain supported in advanced mode.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from app.core.domain import Cellar
from app.core.exceptions import ConfigurationError

_REGEX_HINT_CHARS = set(".^$*+?{}[]|()\\")
_MAX_LOCATIONS = 1000
_ALLOWED_KINDS = {"loose", "grid", "grid_sub", "sequential", "depth"}
_GRID_ORDERS = {
    "prefix_column_row",
    "prefix_row_column",
    "column_row",
    "row_column",
}
_DEPTH_ORDERS = {
    "prefix_row_depth",
    "prefix_depth_row",
    "row_depth",
    "depth_row",
}
_NO_MATCH = object()


def _looks_like_regex(rule: str) -> bool:
    return any(ch in _REGEX_HINT_CHARS for ch in rule)


def rule_matches(rule: str, location: str) -> bool:
    """Return whether one legacy/generated rule matches a location."""
    if not rule or not location:
        return False
    if _looks_like_regex(rule):
        try:
            return re.match(rule, location.strip(), flags=re.IGNORECASE) is not None
        except re.error as exc:
            raise ConfigurationError(f"Invalid location rule regex '{rule}': {exc}") from exc
    return location.strip().casefold().startswith(rule.strip().casefold())


def _layout_object(layout: Optional[str]) -> dict[str, Any]:
    if not layout:
        return {}
    try:
        value = json.loads(layout)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ConfigurationError("Cellar layout must be valid JSON") from exc
    if not isinstance(value, dict):
        raise ConfigurationError("Cellar layout must be a JSON object")
    return value


def _integer(value: Any, field_name: str, *, minimum: int = 0, maximum: int = 999) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigurationError(f"{field_name} must be a whole number") from exc
    if number < minimum or number > maximum:
        raise ConfigurationError(f"{field_name} must be between {minimum} and {maximum}")
    return number


def _letter(value: Any, field_name: str) -> str:
    text = str(value or "").strip().upper()
    if len(text) != 1 or not ("A" <= text <= "Z"):
        raise ConfigurationError(f"{field_name} must be one letter from A to Z")
    return text


def _prefix(value: Any) -> str:
    text = str(value or "").strip().upper()
    if len(text) > 20:
        raise ConfigurationError("The cellar code must be 20 characters or fewer")
    if "\n" in text or "\r" in text:
        raise ConfigurationError("The cellar code cannot contain a line break")
    return text


def _separator(value: Any, field_name: str = "Location separator", *, default: str = "") -> str:
    text = str(default if value is None else value)
    if len(text) > 3 or "\n" in text or "\r" in text:
        raise ConfigurationError(f"{field_name} must be at most 3 characters")
    return text


def _common(raw: dict[str, Any], kind: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "enabled": bool(raw.get("enabled", True)),
        "prefix": _prefix(raw.get("prefix")),
        "separator": _separator(raw.get("separator")),
        "store_internal": bool(raw.get("store_internal", True)),
    }


def _split_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_values = value
    else:
        raw_values = re.split(r"[\n,;]+", str(value))
    result: list[str] = []
    seen: set[str] = set()
    for raw in raw_values:
        text = str(raw).strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def _parse_depths(value: Any) -> list[dict[str, str]]:
    if isinstance(value, list):
        raw_values = value
    else:
        raw_values = _split_values(value)
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in raw_values:
        if isinstance(raw, dict):
            code = str(raw.get("code") or "").strip().upper()
            label = str(raw.get("label") or code).strip()
        else:
            text = str(raw).strip()
            if "=" in text:
                code, label = (part.strip() for part in text.split("=", 1))
            else:
                code, label = text, text
            code = code.upper()
        if not code or len(code) > 8 or any(ch.isspace() for ch in code):
            raise ConfigurationError("Each depth code must contain 1 to 8 non-space characters")
        key = code.casefold()
        if key in seen:
            raise ConfigurationError(f"Depth code '{code}' is duplicated")
        seen.add(key)
        result.append({"code": code, "label": label or code})
    if not result:
        raise ConfigurationError("At least one depth position is required")
    if len(result) > 20:
        raise ConfigurationError("Use at most 20 depth positions")
    return result


def _excel_label_to_number(label: str) -> int:
    text = str(label or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{1,3}", text):
        raise ConfigurationError("The first sequential label must contain letters A to Z")
    number = 0
    for char in text:
        number = number * 26 + (ord(char) - ord("A") + 1)
    return number


def _number_to_excel_label(number: int) -> str:
    if number < 1:
        raise ConfigurationError("Sequential label number must be positive")
    chars: list[str] = []
    while number:
        number, remainder = divmod(number - 1, 26)
        chars.append(chr(ord("A") + remainder))
    return "".join(reversed(chars))


def normalize_grid_scheme(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate the existing simple-grid format (backwards compatible)."""
    if not isinstance(raw, dict):
        raise ConfigurationError("Location naming configuration must be an object")
    common = _common(raw, "grid")
    column_start = _letter(raw.get("column_start", "A"), "First column")
    column_end = _letter(raw.get("column_end", "D"), "Last column")
    if column_start > column_end:
        raise ConfigurationError("The first column must come before the last column")
    row_start = _integer(raw.get("row_start", 1), "First row")
    row_end = _integer(raw.get("row_end", 3), "Last row")
    if row_start > row_end:
        raise ConfigurationError("The first row must be less than or equal to the last row")
    order = str(raw.get("order") or "prefix_column_row").strip()
    if order not in _GRID_ORDERS:
        raise ConfigurationError("Unsupported location code order")
    count = (ord(column_end) - ord(column_start) + 1) * (row_end - row_start + 1)
    if count > _MAX_LOCATIONS:
        raise ConfigurationError(f"This structure would create {count} positions; maximum {_MAX_LOCATIONS}")
    horizontal_direction = str(raw.get("horizontal_direction") or "ltr")
    if horizontal_direction not in {"ltr", "rtl"}:
        raise ConfigurationError("Unsupported horizontal direction")
    vertical_direction = str(raw.get("vertical_direction") or "ttb")
    if vertical_direction not in {"ttb", "btt"}:
        raise ConfigurationError("Unsupported vertical direction")
    return {
        **common,
        "column_start": column_start,
        "column_end": column_end,
        "row_start": row_start,
        "row_end": row_end,
        "order": order,
        "horizontal_direction": horizontal_direction,
        "vertical_direction": vertical_direction,
    }


def _normalize_grid_sub(raw: dict[str, Any]) -> dict[str, Any]:
    base = normalize_grid_scheme({**raw, "kind": "grid"})
    sub_start = _integer(raw.get("sub_start", 1), "First sub-position", minimum=0)
    sub_end = _integer(raw.get("sub_end", 2), "Last sub-position", minimum=0)
    if sub_start > sub_end:
        raise ConfigurationError("The first sub-position must be less than or equal to the last")
    sub_separator = _separator(raw.get("sub_separator", "."), "Sub-position separator", default=".")
    if not sub_separator:
        raise ConfigurationError("A separator is required before a numeric sub-position")
    count = (
        (ord(base["column_end"]) - ord(base["column_start"]) + 1)
        * (base["row_end"] - base["row_start"] + 1)
        * (sub_end - sub_start + 1)
    )
    if count > _MAX_LOCATIONS:
        raise ConfigurationError(f"This structure would create {count} positions; maximum {_MAX_LOCATIONS}")
    return {**base, "kind": "grid_sub", "sub_start": sub_start, "sub_end": sub_end, "sub_separator": sub_separator}


def _normalize_loose(raw: dict[str, Any]) -> dict[str, Any]:
    common = _common(raw, "loose")
    containers = _split_values(raw.get("containers"))
    if len(containers) > 200:
        raise ConfigurationError("Use at most 200 named boxes or containers")
    return {
        **common,
        "separator": _separator(raw.get("separator", " "), default=" "),
        "containers": containers,
        "allow_free_text": bool(raw.get("allow_free_text", True)),
    }


def _normalize_sequential(raw: dict[str, Any]) -> dict[str, Any]:
    common = _common(raw, "sequential")
    rows = _integer(raw.get("rows", 7), "Number of rows", minimum=1, maximum=100)
    columns = _integer(raw.get("columns", 4), "Number of columns", minimum=1, maximum=100)
    capacity = rows * columns
    position_count = _integer(raw.get("position_count", capacity), "Number of positions", minimum=1, maximum=capacity)
    start_number = _excel_label_to_number(str(raw.get("start_label") or "A"))
    if start_number + position_count - 1 > _excel_label_to_number("ZZZ"):
        raise ConfigurationError("Sequential labels cannot go beyond ZZZ")
    fill_order = str(raw.get("fill_order") or "row_major")
    if fill_order not in {"row_major", "column_major"}:
        raise ConfigurationError("Unsupported sequential fill order")
    horizontal_direction = str(raw.get("horizontal_direction") or "ltr")
    if horizontal_direction not in {"ltr", "rtl"}:
        raise ConfigurationError("Unsupported horizontal direction")
    vertical_direction = str(raw.get("vertical_direction") or "ttb")
    if vertical_direction not in {"ttb", "btt"}:
        raise ConfigurationError("Unsupported vertical direction")
    if position_count > _MAX_LOCATIONS:
        raise ConfigurationError(f"Use at most {_MAX_LOCATIONS} positions")
    return {
        **common,
        "rows": rows,
        "columns": columns,
        "position_count": position_count,
        "start_label": _number_to_excel_label(start_number),
        "fill_order": fill_order,
        "horizontal_direction": horizontal_direction,
        "vertical_direction": vertical_direction,
    }


def _normalize_depth(raw: dict[str, Any]) -> dict[str, Any]:
    common = _common(raw, "depth")
    row_start = _integer(raw.get("row_start", 1), "First row")
    row_end = _integer(raw.get("row_end", 9), "Last row")
    if row_start > row_end:
        raise ConfigurationError("The first row must be less than or equal to the last row")
    depths = _parse_depths(raw.get("depths") or [{"code": "F", "label": "Front"}, {"code": "B", "label": "Back"}])
    order = str(raw.get("order") or "prefix_row_depth")
    if order not in _DEPTH_ORDERS:
        raise ConfigurationError("Unsupported depth code order")
    vertical_direction = str(raw.get("vertical_direction") or "ttb")
    if vertical_direction not in {"ttb", "btt"}:
        raise ConfigurationError("Unsupported vertical direction")
    count = (row_end - row_start + 1) * len(depths)
    if count > _MAX_LOCATIONS:
        raise ConfigurationError(f"This structure would create {count} positions; maximum {_MAX_LOCATIONS}")
    return {
        **common,
        "row_start": row_start,
        "row_end": row_end,
        "depths": depths,
        "order": order,
        "vertical_direction": vertical_direction,
    }


def normalize_location_scheme(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ConfigurationError("Location naming configuration must be an object")
    kind = str(raw.get("kind") or "grid").strip()
    if kind == "grid":
        return normalize_grid_scheme(raw)
    if kind == "grid_sub":
        return _normalize_grid_sub(raw)
    if kind == "loose":
        return _normalize_loose(raw)
    if kind == "sequential":
        return _normalize_sequential(raw)
    if kind == "depth":
        return _normalize_depth(raw)
    raise ConfigurationError(f"Unsupported location structure '{kind}'")


def get_location_scheme(layout: Optional[str]) -> Optional[dict[str, Any]]:
    """Return a validated structured scheme, or ``None`` for legacy/custom layouts."""
    if not layout:
        return None
    try:
        value = _layout_object(layout)
        raw = value.get("location_scheme")
        if not isinstance(raw, dict) or raw.get("enabled") is False:
            return None
        return normalize_location_scheme(raw)
    except ConfigurationError:
        # A malformed historical layout should not prevent users listing data.
        return None


def _columns(scheme: dict[str, Any]) -> list[str]:
    return [chr(code) for code in range(ord(scheme["column_start"]), ord(scheme["column_end"]) + 1)]


def _rows(scheme: dict[str, Any]) -> list[int]:
    return list(range(scheme["row_start"], scheme["row_end"] + 1))


def _join(parts: list[Any], separator: str) -> str:
    return separator.join(str(part) for part in parts if str(part) != "")


def _grid_parts(scheme: dict[str, Any], column: str, row: int) -> list[str]:
    return [str(row), column] if scheme["order"] in {"prefix_row_column", "row_column"} else [column, str(row)]


def _with_prefix(scheme: dict[str, Any], parts: list[str]) -> list[str]:
    if scheme.get("prefix") and str(scheme.get("order", "")).startswith("prefix_"):
        return [scheme["prefix"], *parts]
    return parts


def _sequential_coordinates(scheme: dict[str, Any]) -> list[tuple[int, int]]:
    visual_rows = list(range(scheme["rows"]))
    visual_columns = list(range(scheme["columns"]))
    row_order = visual_rows if scheme["vertical_direction"] == "ttb" else list(reversed(visual_rows))
    column_order = visual_columns if scheme["horizontal_direction"] == "ltr" else list(reversed(visual_columns))
    if scheme["fill_order"] == "column_major":
        return [(row, column) for column in column_order for row in row_order]
    return [(row, column) for row in row_order for column in column_order]


def generate_locations(scheme: dict[str, Any]) -> list[dict[str, Any]]:
    """Generate explicit valid positions for one normalized scheme."""
    value = normalize_location_scheme(scheme)
    kind = value["kind"]
    items: list[dict[str, Any]] = []

    if kind == "loose":
        if value["prefix"]:
            items.append({
                "row": 0,
                "column": 0,
                "internal": "",
                "import": value["prefix"],
                "label": "Unspecified",
                "unspecified": True,
            })
        for index, container in enumerate(value["containers"]):
            import_code = _join([value["prefix"], container], value["separator"]) if value["prefix"] else container
            items.append({
                "row": index + 1,
                "column": 0,
                "internal": container,
                "import": import_code,
                "label": container,
                "container": container,
            })
        return items

    if kind in {"grid", "grid_sub"}:
        rows = _rows(value)
        columns = _columns(value)
        for row_index, row in enumerate(rows):
            physical_row = len(rows) - 1 - row_index if value["vertical_direction"] == "btt" else row_index
            for column_index, column in enumerate(columns):
                physical_column = len(columns) - 1 - column_index if value["horizontal_direction"] == "rtl" else column_index
                base_parts = _grid_parts(value, column, row)
                base_internal = _join(base_parts, value["separator"])
                base_import = _join(_with_prefix(value, base_parts), value["separator"])
                if kind == "grid":
                    items.append({
                        "row": physical_row,
                        "column": physical_column,
                        "row_value": row,
                        "column_value": column,
                        "internal": base_internal,
                        "import": base_import,
                        "label": base_internal,
                    })
                    continue
                for sub in range(value["sub_start"], value["sub_end"] + 1):
                    internal = f"{base_internal}{value['sub_separator']}{sub}"
                    import_code = f"{base_import}{value['sub_separator']}{sub}"
                    items.append({
                        "row": physical_row,
                        "column": physical_column,
                        "row_value": row,
                        "column_value": column,
                        "sub_position": sub,
                        "group": base_internal,
                        "internal": internal,
                        "import": import_code,
                        "label": str(sub),
                    })
        return items

    if kind == "sequential":
        start = _excel_label_to_number(value["start_label"])
        coordinates = _sequential_coordinates(value)[: value["position_count"]]
        for index, (row, column) in enumerate(coordinates):
            label = _number_to_excel_label(start + index)
            import_code = _join([value["prefix"], label], value["separator"]) if value["prefix"] else label
            items.append({
                "row": row,
                "column": column,
                "sequence": index + 1,
                "internal": label,
                "import": import_code,
                "label": label,
            })
        items.sort(key=lambda item: (item["row"], item["column"]))
        return items

    if kind == "depth":
        rows = _rows(value)
        for row_index, row in enumerate(rows):
            physical_row = len(rows) - 1 - row_index if value["vertical_direction"] == "btt" else row_index
            for depth_index, depth in enumerate(value["depths"]):
                if value["order"] in {"prefix_depth_row", "depth_row"}:
                    parts = [depth["code"], str(row)]
                else:
                    parts = [str(row), depth["code"]]
                internal = _join(parts, value["separator"])
                import_parts = [value["prefix"], *parts] if value["prefix"] and value["order"].startswith("prefix_") else parts
                items.append({
                    "row": physical_row,
                    "column": depth_index,
                    "row_value": row,
                    "depth": depth["code"],
                    "depth_label": depth["label"],
                    "internal": internal,
                    "import": _join(import_parts, value["separator"]),
                    "label": depth["label"],
                })
        return items

    raise ConfigurationError(f"Unsupported location structure '{kind}'")


def grid_locations(scheme: dict[str, Any]) -> list[dict[str, Any]]:
    """Backwards-compatible simple-grid generator."""
    value = normalize_grid_scheme(scheme)
    return generate_locations(value)


def _grid_pattern(scheme: dict[str, Any]) -> str:
    columns = _columns(scheme)
    column = re.escape(columns[0]) if len(columns) == 1 else f"[{re.escape(columns[0])}-{re.escape(columns[-1])}]"
    rows = sorted((str(row) for row in _rows(scheme)), key=lambda text: (-len(text), text))
    row = "(?:" + "|".join(re.escape(text) for text in rows) + ")"
    separator = re.escape(scheme["separator"])
    return f"{row}{separator}{column}" if scheme["order"] in {"prefix_row_column", "row_column"} else f"{column}{separator}{row}"


def build_grid_rule(scheme: dict[str, Any]) -> str:
    """Generate the historical simple-grid regex (kept for compatibility)."""
    value = normalize_grid_scheme(scheme)
    internal = _grid_pattern(value)
    if value["order"].startswith("prefix_") and value["prefix"]:
        return f"^{re.escape(value['prefix'])}{re.escape(value['separator'])}(?P<sub>{internal})$"
    return f"^(?P<sub>{internal})$"


def build_location_rule(scheme: dict[str, Any]) -> Optional[str]:
    value = normalize_location_scheme(scheme)
    if value["kind"] == "grid":
        return build_grid_rule(value)
    if value["kind"] == "loose":
        if not value["prefix"]:
            return None
        prefix = re.escape(value["prefix"])
        if value["allow_free_text"]:
            return rf"^{prefix}(?:[\s\-.:/]+(?P<sub>.+))?$"
        codes = [re.escape(item["import"]) for item in generate_locations(value)]
        return "^(?:" + "|".join(codes) + ")$" if codes else rf"^{prefix}$"
    codes = [re.escape(item["import"]) for item in generate_locations(value)]
    return "^(?:" + "|".join(codes) + ")$" if codes else None


def normalize_location_configuration(
    location_rule: Optional[str],
    layout: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    """Validate a structured scheme and persist its explicit catalog."""
    if not layout:
        return location_rule, layout
    data = _layout_object(layout)
    raw = data.get("location_scheme")
    if not isinstance(raw, dict):
        return location_rule, layout
    if raw.get("enabled") is False:
        data.pop("location_scheme", None)
        data.pop("location_catalog", None)
        return location_rule, json.dumps(data, ensure_ascii=False, separators=(",", ":"))

    scheme = normalize_location_scheme(raw)
    data["location_scheme"] = scheme
    data["location_catalog"] = {
        "version": 1,
        "positions": generate_locations(scheme),
    }
    return (
        build_location_rule(scheme),
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
    )


def _match_loose(value: dict[str, Any], text: str, *, allow_internal: bool) -> object:
    folded = text.casefold()
    for item in generate_locations(value):
        if item["import"].casefold() == folded:
            if item.get("unspecified"):
                return None
            return item["internal"] if value["store_internal"] else item["import"]
        if allow_internal and item["internal"] and item["internal"].casefold() == folded:
            return item["internal"] if value["store_internal"] else item["import"]
    prefix = value["prefix"]
    if prefix and folded == prefix.casefold():
        return None
    if prefix and folded.startswith(prefix.casefold()) and value["allow_free_text"]:
        raw_remainder = text[len(prefix):]
        # Avoid treating a longer unrelated code such as STC2 as free text for
        # STC. A suffix must be separated by whitespace or visible punctuation.
        if raw_remainder and raw_remainder[0] not in " \t-.:/":
            return _NO_MATCH
        remainder = raw_remainder.strip().lstrip("-.:/").strip()
        if remainder:
            return remainder if value["store_internal"] else text
    if not prefix and allow_internal and value["allow_free_text"] and text:
        return text
    return _NO_MATCH


def _match_scheme(value: dict[str, Any], text: str, *, allow_internal: bool) -> object:
    if value["kind"] == "loose":
        return _match_loose(value, text, allow_internal=allow_internal)
    folded = text.casefold()
    for item in generate_locations(value):
        if item["import"].casefold() == folded:
            return item["internal"] if value["store_internal"] else item["import"]
        if allow_internal and item["internal"].casefold() == folded:
            return item["internal"] if value["store_internal"] else item["import"]
    return _NO_MATCH


def normalize_location_for_cellar(cellar: Cellar, location: Optional[str]) -> Optional[str]:
    """Return the canonical location stored inside a structured cellar."""
    if location is None:
        return None
    text = location.strip()
    if not text:
        return None
    scheme = get_location_scheme(cellar.layout)
    if scheme is None:
        return text
    result = _match_scheme(scheme, text, allow_internal=True)
    return text if result is _NO_MATCH else result  # type: ignore[return-value]


def match_cellar_for_location(location: Optional[str], cellars: list[Cellar]) -> Optional[Cellar]:
    """Return the most specific cellar matching an imported/unassigned code."""
    if not location or not location.strip():
        return None
    text = location.strip()
    candidates: list[tuple[int, Cellar]] = []
    for cellar in cellars:
        scheme = get_location_scheme(cellar.layout)
        if scheme is not None:
            if scheme["kind"] == "loose" and not scheme.get("prefix"):
                # An unprefixed loose cellar would match arbitrary free text
                # and steal locations from every other cellar. It can still be
                # selected explicitly as the import default, but not inferred.
                result = _NO_MATCH
            else:
                result = _match_scheme(scheme, text, allow_internal=not bool(scheme.get("prefix")))
            if result is not _NO_MATCH:
                # Structured exact catalogs outrank legacy prefix matches. A
                # longer cellar prefix wins when loose schemes overlap.
                candidates.append((10_000 + len(scheme.get("prefix") or ""), cellar))
                continue
        if cellar.location_rule and rule_matches(cellar.location_rule, text):
            candidates.append((len(cellar.location_rule), cellar))
    if not candidates:
        return None
    candidates.sort(key=lambda pair: pair[0], reverse=True)
    return candidates[0][1]


def validate_rule_uniqueness(
    new_rule: Optional[str],
    cellar_id: Optional[str],
    existing: list[Cellar],
) -> None:
    """Reject an identical generated or legacy rule used by another cellar."""
    if not new_rule:
        return
    normalized = new_rule.strip().casefold()
    for cellar in existing:
        if cellar.id == cellar_id:
            continue
        if cellar.location_rule and cellar.location_rule.strip().casefold() == normalized:
            raise ConfigurationError(
                f"Location rule '{new_rule}' is already used by cellar '{cellar.name}'"
            )


def parse_sub_location(rule: str, location: str) -> Optional[str]:
    """Return a regex ``sub`` capture or remainder after a plain prefix."""
    if _looks_like_regex(rule):
        try:
            match = re.match(rule, location.strip(), flags=re.IGNORECASE)
        except re.error as exc:
            raise ConfigurationError(f"Invalid location rule regex '{rule}': {exc}") from exc
        if match and "sub" in match.groupdict():
            return match.group("sub")
        return None
    if location.strip().casefold().startswith(rule.strip().casefold()):
        return location.strip()[len(rule.strip()):]
    return None
