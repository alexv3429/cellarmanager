/** Pure helpers for structured cellar locations. */

export const LOCATION_KINDS = ["loose", "grid", "grid_sub", "sequential", "depth"];
export const LOCATION_ORDERS = [
  "prefix_column_row",
  "prefix_row_column",
  "column_row",
  "row_column",
];
export const DEPTH_ORDERS = [
  "prefix_row_depth",
  "prefix_depth_row",
  "row_depth",
  "depth_row",
];

const MAX_LOCATIONS = 1000;

export function defaultLocationScheme(kind = "grid") {
  const common = {
    kind,
    enabled: true,
    prefix: "",
    separator: "",
    store_internal: true,
  };
  if (kind === "loose") {
    return { ...common, prefix: "STC", separator: " ", containers: [], allow_free_text: true };
  }
  if (kind === "grid_sub") {
    return {
      ...common,
      column_start: "A",
      column_end: "D",
      row_start: 1,
      row_end: 3,
      order: "prefix_column_row",
      horizontal_direction: "ltr",
      vertical_direction: "ttb",
      sub_start: 1,
      sub_end: 2,
      sub_separator: ".",
    };
  }
  if (kind === "sequential") {
    return {
      ...common,
      rows: 7,
      columns: 4,
      position_count: 26,
      start_label: "A",
      fill_order: "row_major",
      horizontal_direction: "ltr",
      vertical_direction: "ttb",
    };
  }
  if (kind === "depth") {
    return {
      ...common,
      prefix: "G",
      row_start: 1,
      row_end: 9,
      depths: [
        { code: "F", label: "Front" },
        { code: "B", label: "Back" },
      ],
      order: "prefix_row_depth",
      vertical_direction: "ttb",
    };
  }
  return {
    ...common,
    kind: "grid",
    column_start: "A",
    column_end: "D",
    row_start: 1,
    row_end: 3,
    order: "prefix_column_row",
    horizontal_direction: "ltr",
    vertical_direction: "ttb",
  };
}

function integer(value, fallback, min = 0, max = 999) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error("row_number");
  }
  return number;
}

function letter(value, fallback) {
  const text = String(value ?? fallback).trim().toUpperCase();
  if (!/^[A-Z]$/.test(text)) throw new Error("column_letter");
  return text;
}

function normalizeCommon(value, kind) {
  const prefix = String(value.prefix || "").trim().toUpperCase();
  const separator = String(value.separator ?? "");
  if (prefix.length > 20) throw new Error("prefix_too_long");
  if (/\r|\n/.test(prefix)) throw new Error("prefix_invalid");
  if (separator.length > 3 || /\r|\n/.test(separator)) {
    throw new Error("separator_too_long");
  }
  return {
    kind,
    enabled: value.enabled !== false,
    prefix,
    separator,
    store_internal: value.store_internal !== false,
  };
}

function splitValues(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,;]+/);
  const seen = new Set();
  return source
    .map((item) => String(item).trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function parseDepthDefinitions(value) {
  const source = Array.isArray(value) ? value : splitValues(value);
  const seen = new Set();
  const result = source.map((raw) => {
    let code;
    let label;
    if (raw && typeof raw === "object") {
      code = String(raw.code || "").trim().toUpperCase();
      label = String(raw.label || code).trim();
    } else {
      const text = String(raw || "").trim();
      const index = text.indexOf("=");
      code = (index >= 0 ? text.slice(0, index) : text).trim().toUpperCase();
      label = (index >= 0 ? text.slice(index + 1) : text).trim() || code;
    }
    if (!code || code.length > 8 || /\s/.test(code)) throw new Error("depth_code");
    const key = code.toLocaleLowerCase();
    if (seen.has(key)) throw new Error("depth_duplicate");
    seen.add(key);
    return { code, label };
  });
  if (!result.length) throw new Error("depth_required");
  if (result.length > 20) throw new Error("depth_too_many");
  return result;
}

function excelLabelToNumber(label) {
  const text = String(label || "").trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(text)) throw new Error("sequential_label");
  let number = 0;
  for (const char of text) number = number * 26 + char.charCodeAt(0) - 64;
  return number;
}

function numberToExcelLabel(number) {
  let value = number;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

export function normalizeLocationScheme(input = {}) {
  const requestedKind = String(input?.kind || "grid");
  const kind = LOCATION_KINDS.includes(requestedKind) ? requestedKind : "grid";
  const value = { ...defaultLocationScheme(kind), ...(input || {}), kind };
  const common = normalizeCommon(value, kind);

  if (kind === "loose") {
    const containers = splitValues(value.containers);
    if (containers.length > 200) throw new Error("containers_too_many");
    return {
      ...common,
      separator: String(value.separator ?? " "),
      containers,
      allow_free_text: value.allow_free_text !== false,
    };
  }

  if (kind === "grid" || kind === "grid_sub") {
    const scheme = {
      ...common,
      column_start: letter(value.column_start, "A"),
      column_end: letter(value.column_end, "D"),
      row_start: integer(value.row_start, 1),
      row_end: integer(value.row_end, 3),
      order: LOCATION_ORDERS.includes(value.order) ? value.order : "prefix_column_row",
      horizontal_direction: value.horizontal_direction === "rtl" ? "rtl" : "ltr",
      vertical_direction: value.vertical_direction === "btt" ? "btt" : "ttb",
    };
    if (scheme.column_start > scheme.column_end) throw new Error("column_range");
    if (scheme.row_start > scheme.row_end) throw new Error("row_range");
    const baseCount =
      (scheme.column_end.charCodeAt(0) - scheme.column_start.charCodeAt(0) + 1) *
      (scheme.row_end - scheme.row_start + 1);
    if (kind === "grid") {
      if (baseCount > MAX_LOCATIONS) throw new Error("grid_too_large");
      return scheme;
    }
    const sub_start = integer(value.sub_start, 1);
    const sub_end = integer(value.sub_end, 2);
    const sub_separator = String(value.sub_separator ?? ".");
    if (sub_start > sub_end) throw new Error("sub_range");
    if (!sub_separator) throw new Error("sub_separator_required");
    if (sub_separator.length > 3 || /\r|\n/.test(sub_separator)) {
      throw new Error("separator_too_long");
    }
    if (baseCount * (sub_end - sub_start + 1) > MAX_LOCATIONS) {
      throw new Error("grid_too_large");
    }
    return { ...scheme, kind: "grid_sub", sub_start, sub_end, sub_separator };
  }

  if (kind === "sequential") {
    const rows = integer(value.rows, 7, 1, 100);
    const columns = integer(value.columns, 4, 1, 100);
    const capacity = rows * columns;
    const position_count = integer(value.position_count, capacity, 1, capacity);
    if (position_count > MAX_LOCATIONS) throw new Error("grid_too_large");
    const startNumber = excelLabelToNumber(value.start_label || "A");
    if (startNumber + position_count - 1 > excelLabelToNumber("ZZZ")) {
      throw new Error("sequential_label");
    }
    return {
      ...common,
      rows,
      columns,
      position_count,
      start_label: numberToExcelLabel(startNumber),
      fill_order: value.fill_order === "column_major" ? "column_major" : "row_major",
      horizontal_direction: value.horizontal_direction === "rtl" ? "rtl" : "ltr",
      vertical_direction: value.vertical_direction === "btt" ? "btt" : "ttb",
    };
  }

  const row_start = integer(value.row_start, 1);
  const row_end = integer(value.row_end, 9);
  if (row_start > row_end) throw new Error("row_range");
  const depths = parseDepthDefinitions(value.depths);
  if ((row_end - row_start + 1) * depths.length > MAX_LOCATIONS) {
    throw new Error("grid_too_large");
  }
  return {
    ...common,
    kind: "depth",
    row_start,
    row_end,
    depths,
    order: DEPTH_ORDERS.includes(value.order) ? value.order : "prefix_row_depth",
    vertical_direction: value.vertical_direction === "btt" ? "btt" : "ttb",
  };
}

export function schemeColumns(scheme) {
  const value = normalizeLocationScheme(scheme);
  if (!["grid", "grid_sub"].includes(value.kind)) return [];
  const result = [];
  for (let code = value.column_start.charCodeAt(0); code <= value.column_end.charCodeAt(0); code += 1) {
    result.push(String.fromCharCode(code));
  }
  return result;
}

export function schemeRows(scheme) {
  const value = normalizeLocationScheme(scheme);
  if (!["grid", "grid_sub", "depth"].includes(value.kind)) return [];
  return Array.from({ length: value.row_end - value.row_start + 1 }, (_, index) => value.row_start + index);
}

function joinParts(parts, separator) {
  return parts.filter((part) => String(part) !== "").map(String).join(separator);
}

function gridParts(value, column, row) {
  return ["prefix_row_column", "row_column"].includes(value.order)
    ? [String(row), column]
    : [column, String(row)];
}

function withPrefix(value, parts) {
  return value.prefix && value.order.startsWith("prefix_") ? [value.prefix, ...parts] : parts;
}

function sequentialCoordinates(value) {
  const rows = Array.from({ length: value.rows }, (_, index) => index);
  const columns = Array.from({ length: value.columns }, (_, index) => index);
  const rowOrder = value.vertical_direction === "btt" ? [...rows].reverse() : rows;
  const columnOrder = value.horizontal_direction === "rtl" ? [...columns].reverse() : columns;
  const result = [];
  if (value.fill_order === "column_major") {
    for (const column of columnOrder) for (const row of rowOrder) result.push([row, column]);
  } else {
    for (const row of rowOrder) for (const column of columnOrder) result.push([row, column]);
  }
  return result;
}

export function generateLocations(scheme) {
  const value = normalizeLocationScheme(scheme);
  const items = [];

  if (value.kind === "loose") {
    if (value.prefix) {
      items.push({ row: 0, column: 0, internal: "", import: value.prefix, label: "Unspecified", unspecified: true });
    }
    value.containers.forEach((container, index) => {
      items.push({
        row: index + 1,
        column: 0,
        internal: container,
        import: value.prefix ? joinParts([value.prefix, container], value.separator) : container,
        label: container,
        container,
      });
    });
    return items;
  }

  if (["grid", "grid_sub"].includes(value.kind)) {
    const rows = schemeRows(value);
    const columns = schemeColumns(value);
    rows.forEach((row, rowIndex) => {
      columns.forEach((column, columnIndex) => {
        const physicalRow = value.vertical_direction === "btt" ? rows.length - 1 - rowIndex : rowIndex;
        const physicalColumn = value.horizontal_direction === "rtl" ? columns.length - 1 - columnIndex : columnIndex;
        const parts = gridParts(value, column, row);
        const baseInternal = joinParts(parts, value.separator);
        const baseImport = joinParts(withPrefix(value, parts), value.separator);
        if (value.kind === "grid") {
          items.push({ row: physicalRow, column: physicalColumn, internal: baseInternal, import: baseImport, label: baseInternal });
        } else {
          for (let sub = value.sub_start; sub <= value.sub_end; sub += 1) {
            items.push({
              row: physicalRow,
              column: physicalColumn,
              sub_position: sub,
              group: baseInternal,
              internal: `${baseInternal}${value.sub_separator}${sub}`,
              import: `${baseImport}${value.sub_separator}${sub}`,
              label: String(sub),
            });
          }
        }
      });
    });
    return items;
  }

  if (value.kind === "sequential") {
    const start = excelLabelToNumber(value.start_label);
    sequentialCoordinates(value)
      .slice(0, value.position_count)
      .forEach(([row, column], index) => {
        const label = numberToExcelLabel(start + index);
        items.push({
          row,
          column,
          sequence: index + 1,
          internal: label,
          import: value.prefix ? joinParts([value.prefix, label], value.separator) : label,
          label,
        });
      });
    return items.sort((a, b) => a.row - b.row || a.column - b.column);
  }

  const depthRows = schemeRows(value);
  depthRows.forEach((row, rowIndex) => {
    const physicalRow = value.vertical_direction === "btt" ? depthRows.length - 1 - rowIndex : rowIndex;
    value.depths.forEach((depth, depthIndex) => {
      const parts = ["prefix_depth_row", "depth_row"].includes(value.order)
        ? [depth.code, String(row)]
        : [String(row), depth.code];
      const importParts = value.prefix && value.order.startsWith("prefix_")
        ? [value.prefix, ...parts]
        : parts;
      items.push({
        row: physicalRow,
        column: depthIndex,
        depth: depth.code,
        depth_label: depth.label,
        internal: joinParts(parts, value.separator),
        import: joinParts(importParts, value.separator),
        label: depth.label,
      });
    });
  });
  return items;
}

export function buildLocationGrid(scheme) {
  const value = normalizeLocationScheme(scheme);
  const locations = generateLocations(value);
  if (value.kind === "loose") return locations.map((item) => [item]);
  const rows = value.kind === "sequential" ? value.rows : value.row_end - value.row_start + 1;
  const columns = value.kind === "sequential"
    ? value.columns
    : value.kind === "depth"
      ? value.depths.length
      : schemeColumns(value).length;
  const matrix = Array.from({ length: rows }, () => Array(columns).fill(null));
  if (value.kind === "grid_sub") {
    for (const item of locations) {
      if (!matrix[item.row][item.column]) {
        matrix[item.row][item.column] = {
          group: true,
          internal: item.group,
          import: item.import.slice(0, item.import.lastIndexOf(value.sub_separator)),
          children: [],
        };
      }
      matrix[item.row][item.column].children.push(item);
    }
  } else {
    for (const item of locations) matrix[item.row][item.column] = item;
  }
  return matrix;
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function simpleGridRule(value) {
  const columns = schemeColumns(value);
  const column = columns.length === 1
    ? regexEscape(columns[0])
    : `[${regexEscape(columns[0])}-${regexEscape(columns.at(-1))}]`;
  const row = `(?:${schemeRows(value)
    .map(String)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(regexEscape)
    .join("|")})`;
  const separator = regexEscape(value.separator);
  const internal = ["prefix_row_column", "row_column"].includes(value.order)
    ? `${row}${separator}${column}`
    : `${column}${separator}${row}`;
  if (value.order.startsWith("prefix_") && value.prefix) {
    return `^${regexEscape(value.prefix)}${separator}(?P<sub>${internal})$`;
  }
  return `^(?P<sub>${internal})$`;
}

export function buildLocationRule(scheme) {
  const value = normalizeLocationScheme(scheme);
  if (value.kind === "grid") return simpleGridRule(value);
  if (value.kind === "loose") {
    if (!value.prefix) return null;
    if (value.allow_free_text) {
      return `^${regexEscape(value.prefix)}(?:[\\s\\-.:/]+(?P<sub>.+))?$`;
    }
  }
  const codes = generateLocations(value).map((item) => regexEscape(item.import));
  return codes.length ? `^(?:${codes.join("|")})$` : null;
}

export function parseCellarLayout(layout) {
  if (!layout) return {};
  try {
    const value = typeof layout === "string" ? JSON.parse(layout) : layout;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function schemeFromCellar(cellar) {
  const layout = parseCellarLayout(cellar?.layout);
  const raw = layout.location_scheme;
  if (!raw || raw.enabled === false) return null;
  try {
    return normalizeLocationScheme(raw);
  } catch {
    return null;
  }
}

export function layoutWithScheme(existingLayout, scheme) {
  const layout = parseCellarLayout(existingLayout);
  if (!scheme || scheme.enabled === false) {
    delete layout.location_scheme;
    delete layout.location_catalog;
  } else {
    const normalized = normalizeLocationScheme(scheme);
    layout.location_scheme = normalized;
    layout.location_catalog = { version: 1, positions: generateLocations(normalized) };
  }
  return JSON.stringify(layout);
}
