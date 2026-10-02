import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { buildLegacyPricesPlan, normalizeLegacyHoldingPrices, renderLegacyPricesSql } from "./restore_prices_lib.mjs"

const HOUSEHOLD = "00000000-0000-4000-8000-000000000100"
const OWNER = "00000000-0000-4000-8000-000000000001"
const WINE = "00000000-0000-4000-8000-000000000110"
const HOLDING = "00000000-0000-4000-8000-000000000130"
const SOURCE_HASH = "a".repeat(64)

function sample(overrides = {}) {
  return {
    id: HOLDING, wine_id: WINE, cellar_id: null, location: "A1",
    quantity: 2, state: "in_cellar", price_bought: 12.5, acquired_date: null,
    ...overrides,
  }
}

function plan(overrides = {}) {
  return normalizeLegacyHoldingPrices({
    holdings: [sample(overrides)], wines: [{ id: WINE }],
    acquisitions: 0, allocations: 0, householdId: HOUSEHOLD, sourceSha256: SOURCE_HASH,
  })
}

test("a v0.1 holding price is evidence, not a purchase or an acquired quantity", () => {
  const result = plan()
  assert.deepEqual(result.report, {
    source_holding_count: 1, source_acquisition_count: 0, source_allocation_count: 0,
    price_rows: 1, date_rows: 0, source_noncurrent_rows: 0, evidence_rows: 1,
    blockers: [],
  })
  assert.equal(result.rows[0].price_bought, "12.50")
  assert.equal(result.rows[0].source_quantity, 2)
  assert.equal(result.rows[0].acquired_on, null)
  assert.equal(Object.hasOwn(result.rows[0], "acquisition_kind"), false)
  const sql = renderLegacyPricesSql({ plan: result, importedBy: OWNER, mode: "preview" })
  assert.match(sql, /rollback;\s*$/u)
  assert.doesNotMatch(sql, /insert into public\.wine_acquisitions/iu)
  assert.doesNotMatch(sql, /insert into public\.holdings/iu)
})

test("unknown price and a real archived date remain separate evidence", () => {
  const result = plan({ price_bought: null, acquired_date: "2020-02-29" })
  assert.equal(result.report.price_rows, 0)
  assert.equal(result.report.date_rows, 1)
  assert.equal(result.rows[0].price_bought, null)
  assert.equal(result.rows[0].acquired_on, "2020-02-29")
})

test("invalid and ambiguous source values block restoration", () => {
  assert.equal(plan({ acquired_date: "2020-02-30" }).report.blockers.length, 1)
  assert.equal(plan({ price_bought: 10.123 }).report.blockers.length, 1)
  assert.equal(plan({ wine_id: "00000000-0000-4000-8000-000000000999" }).report.blockers.length, 1)
  assert.equal(normalizeLegacyHoldingPrices({
    holdings: [sample()], wines: [{ id: WINE }], acquisitions: 1, allocations: 0,
    householdId: HOUSEHOLD, sourceSha256: SOURCE_HASH,
  }).report.blockers.length, 1)
})

test("apply SQL requires the reviewed target fingerprint", () => {
  const result = plan()
  assert.throws(() => renderLegacyPricesSql({ plan: result, importedBy: OWNER, mode: "apply" }), /fingerprint/u)
  const sql = renderLegacyPricesSql({
    plan: result, importedBy: OWNER, mode: "rehearsal", expectedPreviewFingerprint: "b".repeat(32),
  })
  assert.match(sql, /Legacy price preview has changed/u)
  assert.match(sql, /rollback;\s*$/u)
})

test("the source SQLite file must match its approved hash", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "cellarmanager-prices-test-"))
  const sourceDb = path.join(folder, "source.db")
  try {
    const db = new DatabaseSync(sourceDb)
    db.exec(`create table wines(id text); create table acquisitions(id text);
      create table acquisition_allocations(id text);
      create table holdings(id text, wine_id text, cellar_id text, location text,
        quantity integer, state text, price_bought real, acquired_date text);`)
    db.prepare("insert into wines values (?)").run(WINE)
    db.prepare("insert into holdings values (?, ?, null, null, 1, 'in_cellar', 9.5, null)").run(HOLDING, WINE)
    db.close()
    await assert.rejects(buildLegacyPricesPlan({
      sourceDb, expectedSourceSha256: SOURCE_HASH, householdId: HOUSEHOLD,
    }), /SHA-256 mismatch/u)
    const hash = createHash("sha256").update(await readFile(sourceDb)).digest("hex")
    const result = await buildLegacyPricesPlan({ sourceDb, expectedSourceSha256: hash, householdId: HOUSEHOLD })
    assert.equal(result.report.evidence_rows, 1)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
