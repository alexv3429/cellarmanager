import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import ExcelJS from "@excel.js/exceljs";

export const LWIN_SOURCE_KEY = "liv-ex-lwin";
export const LWIN_SNAPSHOT_URL =
  "https://s3-eu-west-1.amazonaws.com/lwin-dictionary/latest/LWINdatabase.xlsx";
export const LWIN_WORKSHEET_NAME = "LWINdatabase";

export const LWIN_HEADERS = Object.freeze([
  "LWIN",
  "STATUS",
  "DISPLAY_NAME",
  "PRODUCER_TITLE",
  "PRODUCER_NAME",
  "WINE",
  "COUNTRY",
  "REGION",
  "SUB_REGION",
  "SITE",
  "PARCEL",
  "COLOUR",
  "TYPE",
  "SUB_TYPE",
  "DESIGNATION",
  "CLASSIFICATION",
  "VINTAGE_CONFIG",
  "FIRST_VINTAGE",
  "FINAL_VINTAGE",
  "DATE_ADDED",
  "DATE_UPDATED",
  "REFERENCE",
]);

const STATUS_VALUES = new Map([
  ["Live", "live"],
  ["Combined", "combined"],
  ["Deleted", "deleted"],
]);

const VINTAGE_CONFIGURATION_VALUES = new Map([
  ["sequential", "sequential"],
  ["nonSequential", "non_sequential"],
  ["singleVintageOnly", "single_vintage_only"],
]);

function primitiveCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "object" && "result" in value) return value.result;
  if (typeof value === "object" && "text" in value) return value.text;
  throw new Error("Unsupported workbook cell value");
}

function requiredSourceString(value, fieldName, rowNumber) {
  const primitive = primitiveCellValue(value);
  const normalized = primitive === null ? "" : String(primitive).trim();
  if (normalized.length === 0) {
    throw new Error(`Row ${rowNumber}: ${fieldName} is empty`);
  }
  return normalized;
}

export function normalizeOptionalSourceText(value) {
  const primitive = primitiveCellValue(value);
  if (primitive === null) return null;
  const normalized = String(primitive).trim();
  if (["", "NA", "N/A"].includes(normalized.toUpperCase())) return null;
  return normalized;
}

function normalizeLwin(value, fieldName, rowNumber, { optional = false } = {}) {
  const primitive = primitiveCellValue(value);
  if (optional && (primitive === null || String(primitive).trim() === "")) {
    return null;
  }
  const normalized =
    typeof primitive === "number" && Number.isInteger(primitive)
      ? String(primitive)
      : String(primitive ?? "").trim();
  if (!/^\d{7}$/.test(normalized)) {
    throw new Error(
      `Row ${rowNumber}: ${fieldName} must be a seven-digit LWIN`,
    );
  }
  return normalized;
}

function normalizeVintage(value, fieldName, rowNumber) {
  const normalized = normalizeOptionalSourceText(value);
  if (normalized === null) return null;
  if (!/^\d{4}$/.test(normalized)) {
    throw new Error(`Row ${rowNumber}: ${fieldName} must be a four-digit year`);
  }
  return Number(normalized);
}

function normalizeTimestamp(value, fieldName, rowNumber) {
  const primitive = primitiveCellValue(value);
  if (primitive === null) return null;
  const normalized =
    primitive instanceof Date
      ? primitive.toISOString().slice(0, 19)
      : String(primitive).trim().replace(" ", "T").replace(/Z$/, "").slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    throw new Error(
      `Row ${rowNumber}: ${fieldName} must be an ISO-like source timestamp`,
    );
  }
  return normalized;
}

function cell(row, columnName) {
  return row.getCell(LWIN_HEADERS.indexOf(columnName) + 1).value;
}

export function normalizeLwinRow(row, rowNumber = row.number) {
  const sourceStatus = requiredSourceString(
    cell(row, "STATUS"),
    "STATUS",
    rowNumber,
  );
  const normalizedStatus = STATUS_VALUES.get(sourceStatus);
  if (!normalizedStatus) {
    throw new Error(`Row ${rowNumber}: unsupported STATUS ${sourceStatus}`);
  }

  const sourceVintageConfiguration = requiredSourceString(
    cell(row, "VINTAGE_CONFIG"),
    "VINTAGE_CONFIG",
    rowNumber,
  );
  const vintageConfiguration = VINTAGE_CONFIGURATION_VALUES.get(
    sourceVintageConfiguration,
  );
  if (!vintageConfiguration) {
    throw new Error(
      `Row ${rowNumber}: unsupported VINTAGE_CONFIG ${sourceVintageConfiguration}`,
    );
  }

  const lwin7 = normalizeLwin(cell(row, "LWIN"), "LWIN", rowNumber);
  const successorLwin7 = normalizeLwin(
    cell(row, "REFERENCE"),
    "REFERENCE",
    rowNumber,
    { optional: true },
  );

  if (normalizedStatus === "combined" && successorLwin7 === null) {
    throw new Error(`Row ${rowNumber}: Combined LWIN requires REFERENCE`);
  }
  if (normalizedStatus === "live" && successorLwin7 !== null) {
    throw new Error(`Row ${rowNumber}: Live LWIN cannot have REFERENCE`);
  }
  if (successorLwin7 === lwin7) {
    throw new Error(`Row ${rowNumber}: LWIN cannot reference itself`);
  }

  const firstVintage = normalizeVintage(
    cell(row, "FIRST_VINTAGE"),
    "FIRST_VINTAGE",
    rowNumber,
  );
  const finalVintage = normalizeVintage(
    cell(row, "FINAL_VINTAGE"),
    "FINAL_VINTAGE",
    rowNumber,
  );
  if (
    firstVintage !== null &&
    finalVintage !== null &&
    firstVintage > finalVintage
  ) {
    throw new Error(`Row ${rowNumber}: FIRST_VINTAGE exceeds FINAL_VINTAGE`);
  }

  return {
    lwin7,
    source_row_number: rowNumber,
    source_status: normalizedStatus,
    display_name: normalizeOptionalSourceText(cell(row, "DISPLAY_NAME")),
    producer_title: normalizeOptionalSourceText(cell(row, "PRODUCER_TITLE")),
    producer_name: normalizeOptionalSourceText(cell(row, "PRODUCER_NAME")),
    wine_name: normalizeOptionalSourceText(cell(row, "WINE")),
    country: normalizeOptionalSourceText(cell(row, "COUNTRY")),
    region: normalizeOptionalSourceText(cell(row, "REGION")),
    sub_region: normalizeOptionalSourceText(cell(row, "SUB_REGION")),
    site: normalizeOptionalSourceText(cell(row, "SITE")),
    parcel: normalizeOptionalSourceText(cell(row, "PARCEL")),
    colour: normalizeOptionalSourceText(cell(row, "COLOUR")),
    product_type: normalizeOptionalSourceText(cell(row, "TYPE")),
    product_sub_type: normalizeOptionalSourceText(cell(row, "SUB_TYPE")),
    designation: normalizeOptionalSourceText(cell(row, "DESIGNATION")),
    classification: normalizeOptionalSourceText(cell(row, "CLASSIFICATION")),
    vintage_configuration: vintageConfiguration,
    first_vintage: firstVintage,
    final_vintage: finalVintage,
    source_added_at: normalizeTimestamp(
      cell(row, "DATE_ADDED"),
      "DATE_ADDED",
      rowNumber,
    ),
    source_updated_at: normalizeTimestamp(
      cell(row, "DATE_UPDATED"),
      "DATE_UPDATED",
      rowNumber,
    ),
    successor_lwin7: successorLwin7,
  };
}

function assertWorkbookShape(workbook, worksheet) {
  if (!worksheet) {
    throw new Error(`Workbook is missing worksheet ${LWIN_WORKSHEET_NAME}`);
  }
  if (workbook.worksheets.length !== 1) {
    throw new Error("Official LWIN workbook must contain exactly one worksheet");
  }
  const headers = LWIN_HEADERS.map((_, index) =>
    String(primitiveCellValue(worksheet.getRow(1).getCell(index + 1).value) ?? "").trim(),
  );
  if (JSON.stringify(headers) !== JSON.stringify(LWIN_HEADERS)) {
    throw new Error(
      `Unexpected LWIN workbook headers: ${headers.join(", ")}`,
    );
  }
}

export function profileLwinWorksheet(worksheet) {
  const lwinRows = new Map();
  const counts = { live: 0, combined: 0, deleted: 0 };
  let sourceUpdatedThrough = null;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const normalized = normalizeLwinRow(worksheet.getRow(rowNumber), rowNumber);
    if (lwinRows.has(normalized.lwin7)) {
      throw new Error(
        `Row ${rowNumber}: duplicate LWIN ${normalized.lwin7} (first seen on row ${lwinRows.get(normalized.lwin7).rowNumber})`,
      );
    }
    lwinRows.set(normalized.lwin7, {
      rowNumber,
      successorLwin7: normalized.successor_lwin7,
    });
    counts[normalized.source_status] += 1;
    if (
      normalized.source_updated_at !== null &&
      (sourceUpdatedThrough === null ||
        normalized.source_updated_at > sourceUpdatedThrough)
    ) {
      sourceUpdatedThrough = normalized.source_updated_at;
    }
  }

  for (const [lwin7, entry] of lwinRows) {
    if (
      entry.successorLwin7 !== null &&
      !lwinRows.has(entry.successorLwin7)
    ) {
      throw new Error(
        `Row ${entry.rowNumber}: LWIN ${lwin7} references missing LWIN ${entry.successorLwin7}`,
      );
    }
  }

  if (lwinRows.size === 0) throw new Error("LWIN workbook contains no data rows");

  return {
    recordCount: lwinRows.size,
    liveRecordCount: counts.live,
    combinedRecordCount: counts.combined,
    deletedRecordCount: counts.deleted,
    sourceUpdatedThrough,
  };
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function loadLwinSnapshot(filePath) {
  const file = await stat(filePath);
  if (!file.isFile()) throw new Error(`LWIN source is not a file: ${filePath}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(LWIN_WORKSHEET_NAME);
  assertWorkbookShape(workbook, worksheet);
  const profile = profileLwinWorksheet(worksheet);

  return {
    workbook,
    worksheet,
    profile,
    contentSha256: await sha256File(filePath),
    byteLength: file.size,
  };
}

export function* lwinEntryBatches(worksheet, snapshotId, batchSize) {
  let batch = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    batch.push({
      snapshot_id: snapshotId,
      ...normalizeLwinRow(worksheet.getRow(rowNumber), rowNumber),
    });
    if (batch.length === batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}
