import { describe, expect, it } from "vitest"
import { createCsvCombinedNameCorrections, groupCsvCombinedNames, suggestCsvNameSplit } from "./csvCombinedNames"
import { prepareCsvImportRows } from "./csvImportPreparation"
import { parseCsvText } from "./csvIngestion"
import { suggestCsvColumnMapping } from "./csvColumnMapping"

const document = parseCsvText("Producer,Cuvée,Vintage,Color,Appellation,Area,Bottle format,Quantity\nEstate - Hill,,2020,red,Village,Region,75 cl,1\nEstate - Hill,,2021,red,Village,Region,75 cl,2\nEstate - Hill,,2021,white,Village,Region,75 cl,3\nEstate - Hill,,2021,red,Other village,Region,75 cl,4\nEstate - Hill,Existing,2022,red,Village,Region,75 cl,5\nEstate - Hill,,2022,red,Village,Region,75 cl,0\n")
const mapping = suggestCsvColumnMapping(document.header!.values)

describe("combined source names", () => {
  it("groups only exact names and wine context, without including excluded rows or populated cuvées", () => {
    const prepared = prepareCsvImportRows({ document, mapping, excluded: new Set([7]) })
    const groups = groupCsvCombinedNames(prepared.allRows)
    expect(groups.map((group) => group.rows.map((row) => row.cleaned.recordNumber))).toEqual([[2, 3], [4], [5]])
    expect(prepared.includedRows[0].fields.cuvee).toBeNull()
    expect(prepared.includedRows[0].issues.some((issue) => issue.field === "cuvee")).toBe(true)
  })
  it("suggests only a single spaced separator and does not guess producer identity or name order", () => {
    expect(suggestCsvNameSplit("Estate - Hill")).toEqual({ producer: "Estate", cuvee: "Hill", suggested: true })
    expect(suggestCsvNameSplit("Hill — Estate")).toEqual({ producer: "Hill", cuvee: "Estate", suggested: true })
    for (const name of ["Jean-Marc Hill", "Estate Hill", "Estate - Hill - Reserve", "Estate - "]) {
      expect(suggestCsvNameSplit(name)).toEqual({ producer: name.trim(), cuvee: "", suggested: false })
    }
  })
  it("does not group unnamed wines just because their surrounding details are identical", () => {
    const document = parseCsvText("Producer,Cuvée,Color,Appellation\n,,red,Village\n,,red,Village\n")
    const prepared = prepareCsvImportRows({ document, mapping: suggestCsvColumnMapping(document.header!.values) })
    expect(groupCsvCombinedNames(prepared.allRows).map((group) => group.rows.length)).toEqual([1, 1])
  })
  it("applies confirmed names while preserving other edits, individual cuvées, source cells and quantities", () => {
    const before = JSON.stringify(document)
    const corrections = { 2: { formatMl: "1500 ml", quantity: "6" }, 3: { cuvee: "Individual" } }
    const prepared = prepareCsvImportRows({ document, mapping, corrections, excluded: new Set([7]) })
    const group = groupCsvCombinedNames(prepared.allRows)[0]
    const changes = createCsvCombinedNameCorrections(group, corrections, " Estate ", " Hill ")
    expect(changes).toEqual({ 2: { formatMl: "1500 ml", quantity: "6", producer: "Estate", cuvee: "Hill" } })
    const after = prepareCsvImportRows({ document, mapping, corrections: { ...corrections, ...changes }, excluded: new Set([7]) })
    expect(after.allRows[0].cleaned).toMatchObject({ issues: [], fields: { producer: "Estate", cuvee: "Hill", vintage: 2020, quantity: 6, formatMl: 1500 } })
    expect(after.allRows[1].cleaned.fields.cuvee).toBe("Individual")
    expect(after.allRows[5].cleaned.fields.cuvee).toBeNull()
    expect(JSON.stringify(document)).toBe(before)
    expect(() => createCsvCombinedNameCorrections(group, corrections, " ", "Hill")).toThrow()
    expect(() => createCsvCombinedNameCorrections(group, corrections, "Estate", " ")).toThrow()
  })
})
