import { describe, expect, it } from "vitest"
import { parseCsvText } from "./csvIngestion"
import { suggestCsvColumnMapping } from "./csvColumnMapping"
import { isZeroStockRow, prepareCsvImportRows } from "./csvImportPreparation"
import { matchCsvWines } from "./csvWineMatching"
import { reconcileCsvStorage } from "./csvStorageReconciliation"
import { buildCsvImportPreview } from "./csvImportPreview"
import { createCsvImportCommitPlan, getCsvImportCommitSourceKey } from "./csvImportCommit"

const document = parseCsvText('Producer,Cuvée,Vintage,Color,Bottle format,Quantity,Cellar,Location\nTest,Old,2020,red,75 cl,0,Main,A1\nTest,Current,bad,white,,2,Main,A1\n,,,,,2,,\n')
const mapping = suggestCsvColumnMapping(document.header!.values)
const cellars = [{ id: "cellar", household_id: "h", name: "Main", is_active: 1 }]
const locations = [{ id: "location", cellar_id: "cellar", household_id: "h", code: "A1", is_active: 1, capacity: 10, bottle_count: 0 }]
function preview(corrections = { 3: { vintage: "NV", formatMl: "75 cl" } }, excluded = new Set([2, 4])) {
  const rows = prepareCsvImportRows({ document, mapping, corrections, excluded }).includedRows
  return buildCsvImportPreview(matchCsvWines(rows, [], "h"), reconcileCsvStorage(rows, cellars, locations, "h"))
}

describe("in-memory import preparation", () => {
  it("tracks blank-only defaults, preserves source and invalid nonblank values, and respects row overrides", () => {
    const document = parseCsvText("Producer,Cuvée,Color,Bottle format,Quantity\nTest,Hill,red,,0\nTest,Hill,red,1500 ml,2\nTest,Hill,red,bad,3\nTest,Hill,red, ,4\n")
    const mapping = suggestCsvColumnMapping(document.header!.values)
    const before = JSON.stringify(document)
    const prepared = prepareCsvImportRows({ document, mapping, defaults: { formatMl: "750 ml", quantity: "1" }, corrections: { 5: { formatMl: "375 ml" } } })
    expect(prepared.includedRows.map((row) => row.fields.formatMl)).toEqual([750, 1500, null, 375])
    expect(prepared.allRows.map((row) => row.defaultsApplied)).toEqual([["formatMl"], [], [], []])
    expect(prepared.allRows[0].original.fields.formatMl).toBe("")
    expect(prepared.includedRows[0].fields.quantity).toBe(0)
    expect(prepared.includedRows[2].issues[0].code).toBe("INVALID_BOTTLE_FORMAT")
    expect(JSON.stringify(document)).toBe(before)
  })
  it("imports zero-stock wines with no storage and only counts positive rows towards capacity", () => {
    const document = parseCsvText("Producer,Cuvée,Vintage,Color,Bottle format,Quantity,Cellar,Location\nTest,Hill,2020,red,750,0,Unknown,Missing\nTest,Hill,2020,red,750,2,Main,A1\n")
    const rows = prepareCsvImportRows({ document, mapping: suggestCsvColumnMapping(document.header!.values) }).includedRows
    const results = buildCsvImportPreview(matchCsvWines(rows, [], "h"), reconcileCsvStorage(rows, cellars, locations, "h", { 2: "foreign-location" }))
    expect(results.map((row) => row.status)).toEqual(["ready", "ready"])
    expect(results[0].storage).toMatchObject({ location: null, quantity: 0, issues: [] })
    expect(results[1].storage?.importBottleCount).toBe(2)
    const plan = createCsvImportCommitPlan({ householdId: "h", deviceId: "d", previewRows: results })
    expect(plan.rows[0].destinationLocationId).toBeNull()
    expect(plan.rows[0].requestedWineId).toBe(plan.rows[1].requestedWineId)
    expect(plan.rows.map((row) => row.quantity)).toEqual([0, 2])
    const catalogOnly = createCsvImportCommitPlan({ householdId: "h", deviceId: "d", previewRows: results.slice(0, 1) })
    expect(catalogOnly.rows[0].quantity).toBe(0)
  })
  it("keeps all rows until explicitly excluded, even zero-stock and total rows", () => {
    const prepared = prepareCsvImportRows({ document, mapping })
    expect(prepared.includedRows).toHaveLength(3)
    expect(prepared.allRows.filter(isZeroStockRow).map((row) => row.cleaned.recordNumber)).toEqual([2])
    expect(prepared.includedRows[2].issues.some((issue) => issue.field === "producer")).toBe(true)
  })
  it("applies corrections without changing source data or row identifiers", () => {
    const before = JSON.stringify(document)
    const prepared = prepareCsvImportRows({ document, mapping, corrections: { 3: { vintage: "NM", formatMl: "75 cl" } } })
    expect(prepared.allRows[1].original.fields).toMatchObject({ vintage: "bad", formatMl: "" })
    expect(prepared.includedRows[1]).toMatchObject({ recordNumber: 3, sourceLineStart: 3, issues: [], fields: { vintage: null, formatMl: 750 } })
    expect(JSON.stringify(document)).toBe(before)
  })
  it("does not silently turn blanks, negatives or bad quantities into zero-stock exclusions", () => {
    const data = parseCsvText("Quantity,Producer\n,Test\n-1,Test\ninvalid,Test\n0,Test\n00,Test\n")
    const rows = prepareCsvImportRows({ document: data, mapping: ["quantity", "producer"] }).allRows
    expect(rows.map(isZeroStockRow)).toEqual([false, false, false, true, true])
  })
  it("keeps invalid edits blocked and lets an explicit empty value override a default", () => {
    const row = prepareCsvImportRows({ document, mapping, defaults: { vintage: "2020" }, corrections: { 3: { vintage: "", formatMl: "bad", quantity: "-1" } } }).includedRows[1]
    expect(row.fields.vintage).toBeNull()
    expect(row.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["INVALID_BOTTLE_FORMAT", "INVALID_QUANTITY"]))
  })
  it("passes only included, corrected rows through capacity, matching and the commit plan", () => {
    const rows = preview()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "ready", row: { recordNumber: 3 }, storage: { importBottleCount: 2 } })
    const plan = createCsvImportCommitPlan({ householdId: "h", deviceId: "d", previewRows: rows })
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0]).toMatchObject({ quantity: 2, wineVintage: null, wineFormatMl: 750 })
    expect(getCsvImportCommitSourceKey(preview({ 3: { vintage: "2020", formatMl: "75 cl" } }))).not.toBe(plan.sourceKey)
    expect(() => createCsvImportCommitPlan({ householdId: "h", deviceId: "d", previewRows: preview(undefined, new Set()) })).toThrow()
  })
  it("restores validation on inclusion/reset and never builds an empty import", () => {
    expect(prepareCsvImportRows({ document, mapping }).includedRows[1].issues.length).toBeGreaterThan(0)
    const rows = prepareCsvImportRows({ document, mapping, excluded: new Set([2, 3, 4]) }).includedRows
    expect(rows).toEqual([])
    expect(() => createCsvImportCommitPlan({ householdId: "h", deviceId: "d", previewRows: [] })).toThrow()
  })
})
