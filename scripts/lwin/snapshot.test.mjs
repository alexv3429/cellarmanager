import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import ExcelJS from "@excel.js/exceljs";

import {
  LWIN_HEADERS,
  loadLwinSnapshot,
  lwinEntryBatches,
} from "./snapshot.mjs";

function sourceRow({
  lwin = 1000001,
  status = "Live",
  displayName = "Example Estate, Example Wine",
  reference = "",
} = {}) {
  return [
    lwin,
    status,
    displayName,
    "Domaine",
    "Example Estate",
    "Example Wine",
    "France",
    "Burgundy",
    "Example Village",
    "Example Site",
    "NA",
    "Red",
    "Wine",
    "Still",
    "AOP",
    "Premier Cru",
    "sequential",
    2000,
    2025,
    "2020-01-02 03:04:05",
    "2026-08-19 16:15:06",
    reference,
  ];
}

async function fixtureWorkbook(rows, headers = LWIN_HEADERS) {
  const directory = await mkdtemp(join(tmpdir(), "cellarmanager-lwin-test-"));
  const filePath = join(directory, "fixture.xlsx");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("LWINdatabase");
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  await workbook.xlsx.writeFile(filePath);
  return { directory, filePath };
}

test("profiles and normalizes an official-shape workbook", async () => {
  const fixture = await fixtureWorkbook([
    sourceRow(),
    sourceRow({
      lwin: 1000002,
      status: "Combined",
      displayName: "NA",
      reference: 1000001,
    }),
    sourceRow({ lwin: 1000003, status: "Deleted", displayName: "NA" }),
  ]);
  try {
    const snapshot = await loadLwinSnapshot(fixture.filePath);
    assert.deepEqual(snapshot.profile, {
      recordCount: 3,
      liveRecordCount: 1,
      combinedRecordCount: 1,
      deletedRecordCount: 1,
      sourceUpdatedThrough: "2026-08-19T16:15:06",
    });
    assert.match(snapshot.contentSha256, /^[0-9a-f]{64}$/);

    const batches = [...lwinEntryBatches(snapshot.worksheet, "snapshot-id", 2)];
    assert.equal(batches.length, 2);
    assert.equal(batches[0][0].snapshot_id, "snapshot-id");
    assert.equal(batches[0][0].producer_title, "Domaine");
    assert.equal(batches[0][1].display_name, null);
    assert.equal(batches[0][1].successor_lwin7, "1000001");
    assert.equal(batches[1][0].source_status, "deleted");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects a changed workbook header before any upload", async () => {
  const headers = [...LWIN_HEADERS];
  headers[5] = "PRODUCT";
  const fixture = await fixtureWorkbook([sourceRow()], headers);
  try {
    await assert.rejects(
      loadLwinSnapshot(fixture.filePath),
      /Unexpected LWIN workbook headers/,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects duplicate LWIN rows", async () => {
  const fixture = await fixtureWorkbook([sourceRow(), sourceRow()]);
  try {
    await assert.rejects(loadLwinSnapshot(fixture.filePath), /duplicate LWIN/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects a successor absent from the same snapshot", async () => {
  const fixture = await fixtureWorkbook([
    sourceRow({
      status: "Combined",
      reference: 1999999,
    }),
  ]);
  try {
    await assert.rejects(
      loadLwinSnapshot(fixture.filePath),
      /references missing LWIN 1999999/,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
