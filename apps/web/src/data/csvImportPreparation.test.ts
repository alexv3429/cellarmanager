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
