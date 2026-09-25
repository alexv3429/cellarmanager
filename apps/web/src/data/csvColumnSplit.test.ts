import { describe, expect, it } from "vitest"
import { createCsvSplitCorrections, groupCsvColumnSplit, suggestCsvColumnSplit, isCsvSplitConfigured, type CsvColumnSplit } from "./csvColumnSplit"
import { prepareCsvImportRows } from "./csvImportPreparation"
import { parseCsvText } from "./csvIngestion"
import { suggestCsvColumnMapping } from "./csvColumnMapping"

const document = parseCsvText("Producer,Cuvée,Vintage,Color,Appellation,Area,Bottle format,Quantity\nEstate - Hill,,2020,red,Village,Region,75 cl,1\nEstate - Hill,,2021,red,Village,Region,75 cl,2\nEstate - Hill,,2021,white,Village,Region,75 cl,3\nEstate - Hill,,2021,red,Other village,Region,75 cl,4\nEstate - Hill,Existing,2022,red,Village,Region,75 cl,5\nEstate - Hill,,2022,red,Village,Region,75 cl,0\n")
const mapping = suggestCsvColumnMapping(document.header!.values)
const split: CsvColumnSplit = { sourceColumnIndex: 0, firstField: "producer", secondField: "cuvee", separator: " - " }

describe("reviewed source column splitting", () => {
  it("groups exact values and context, preserving separately supplied values and excluded rows", () => {
    const prepared = prepareCsvImportRows({ document, mapping, excluded: new Set([7]) })
    expect(groupCsvColumnSplit(prepared.allRows, mapping, split, {}).map((group) => group.rows.map((row) => row.cleaned.recordNumber)))
      .toEqual([[2, 3], [4], [5]])
    expect(prepared.includedRows[0].issues.some((issue) => issue.field === "cuvee")).toBe(true)
  })
  it("uses a literal separator and never guesses an ambiguous or absent split", () => {
    expect(suggestCsvColumnSplit("Estate - Hill", " - ")).toEqual({ first: "Estate", second: "Hill", suggested: true })
    expect(suggestCsvColumnSplit("Hill — Estate", " - ")).toEqual({ first: "Hill", second: "Estate", suggested: true })
    expect(suggestCsvColumnSplit("Main/A1", "/")).toEqual({ first: "Main", second: "A1", suggested: true })
    expect(suggestCsvColumnSplit("Main.*A1", ".*").suggested).toBe(true)
    for (const value of ["Jean-Marc Hill", "Estate Hill", "Estate - Hill - Reserve", "Estate - "]) {
      expect(suggestCsvColumnSplit(value, " - ")).toEqual({ first: value.trim(), second: "", suggested: false })
    }
    expect(suggestCsvColumnSplit("Estate - Hill", "").suggested).toBe(false)
  })
  it("keeps empty source values separate and validates source and destination fields", () => {
    const document = parseCsvText("Producer,Cuvée,Color,Appellation\n,,red,Village\n,,red,Village\n")
    const prepared = prepareCsvImportRows({ document, mapping: suggestCsvColumnMapping(document.header!.values) })
    expect(groupCsvColumnSplit(prepared.allRows, mapping, split, {}).map((group) => group.rows.length)).toEqual([1, 1])
    expect(isCsvSplitConfigured({ ...split, secondField: "producer" }, 4)).toBe(false)
    expect(isCsvSplitConfigured({ ...split, sourceColumnIndex: 4 }, 4)).toBe(false)
  })
  it("applies confirmed values, preserves other edits and source cells, and requires both values", () => {
    const before = JSON.stringify(document)
    const corrections = { 2: { formatMl: "1500 ml", quantity: "6" }, 3: { cuvee: "Individual" } }
    const prepared = prepareCsvImportRows({ document, mapping, corrections, excluded: new Set([7]) })
    const group = groupCsvColumnSplit(prepared.allRows, mapping, split, corrections)[0]
    const changes = createCsvSplitCorrections(group, mapping, split, corrections, " Estate ", " Hill ")
    expect(changes).toEqual({ 2: { formatMl: "1500 ml", quantity: "6", producer: "Estate", cuvee: "Hill" } })
    const after = prepareCsvImportRows({ document, mapping, corrections: { ...corrections, ...changes }, excluded: new Set([7]) })
    expect(after.allRows[0].cleaned).toMatchObject({ issues: [], fields: { producer: "Estate", cuvee: "Hill", vintage: 2020, quantity: 6, formatMl: 1500 } })
    expect(after.allRows[1].cleaned.fields.cuvee).toBe("Individual")
    expect(JSON.stringify(document)).toBe(before)
    expect(() => createCsvSplitCorrections(group, mapping, split, corrections, " ", "Hill")).toThrow()
  })
  it("supports any source column and field pair, including cellar/location from an unmapped column", () => {
    const document = parseCsvText("Producer,Cuvée,Storage,Cellar,Location\nEstate,Hill,Main/A1,,\nEstate,Hill,Main/A1,Other,B2\n")
    const mapping = suggestCsvColumnMapping(document.header!.values)
    mapping[2] = null
    const split: CsvColumnSplit = { sourceColumnIndex: 2, firstField: "cellar", secondField: "location", separator: "/" }
    const prepared = prepareCsvImportRows({ document, mapping, defaults: { cellar: "Fallback" } })
    const groups = groupCsvColumnSplit(prepared.allRows, mapping, split, {})
    expect(groups).toHaveLength(1)
    expect(groups[0].rows).toHaveLength(1)
    expect(createCsvSplitCorrections(groups[0], mapping, split, {}, "Main", "A1")).toEqual({ 2: { cellar: "Main", location: "A1" } })
  })
})
