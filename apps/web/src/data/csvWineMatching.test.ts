import { describe, expect, it } from "vitest"

import type { CsvMappedSourceRow } from "./csvColumnMapping"
import { cleanCsvMappedRow } from "./csvCleaning"
import {
  matchCsvWine,
  matchCsvWines,
  summarizeCsvWineMatching,
} from "./csvWineMatching"
import type { WineCatalogEntry } from "./wineCatalog"

const wines: WineCatalogEntry[] = [
  {
    appellation: "Morgon",
    area: "Beaujolais",
    color: "red",
    cuvee: "Cuvée A",
    format_ml: 750,
    household_id: "household-1",
    id: "wine-1",
    producer: "Domaine Test",
    vintage: 2020,
  },
  {
    appellation: "Beaujolais",
    area: "Beaujolais",
    color: "red",
    cuvee: "Cuvée Ambiguë",
    format_ml: 750,
    household_id: "household-1",
    id: "wine-ambiguous-b",
    producer: "Domaine Test",
    vintage: null,
  },
  {
    appellation: "Morgon",
    area: "Beaujolais",
    color: "red",
    cuvee: "Cuvée Ambiguë",
    format_ml: 750,
    household_id: "household-1",
    id: "wine-ambiguous-a",
    producer: "Domaine Test",
    vintage: null,
  },
  {
    appellation: null,
    area: null,
    color: "red",
    cuvee: "Cuvée A",
    format_ml: 750,
    household_id: "household-2",
    id: "wine-private",
    producer: "Domaine Test",
    vintage: 2021,
  },
]

function cleanedRow(
  fields: CsvMappedSourceRow["fields"],
  recordNumber = 2,
) {
  return cleanCsvMappedRow({
    fields,
    recordNumber,
    sourceLineEnd: recordNumber,
    sourceLineStart: recordNumber,
    unmapped: [],
  })
}

function validFields(
  overrides: CsvMappedSourceRow["fields"] = {},
): CsvMappedSourceRow["fields"] {
  return {
    color: "red",
    cuvee: "Cuvée A",
    formatMl: "750",
    producer: "Domaine Test",
    quantity: "1",
    vintage: "2020",
    ...overrides,
  }
}

describe("CSV existing-wine matching", () => {
  it("classifies one conservative identity match as existing", () => {
    const result = matchCsvWine(
      cleanedRow(
        validFields({
          appellation: "A different supporting value",
          area: "Another area",
          color: " RED ",
          cuvee: " cuvée   a ",
          producer: " domaine   test ",
        }),
      ),
      wines,
      "household-1",
    )

    expect(result.classification).toBe("existing")
    expect(result.candidates.map((wine) => wine.id)).toEqual([
      "wine-1",
    ])
  })

  it("classifies a missing identity as a new wine", () => {
    const result = matchCsvWine(
      cleanedRow(validFields({ vintage: "2022" })),
      wines,
      "household-1",
    )

    expect(result.classification).toBe("new")
    expect(result.candidates).toEqual([])
  })

  it("keeps matches inside the active household", () => {
    const row = cleanedRow(
      validFields({ vintage: "2021" }),
    )

    expect(
      matchCsvWine(row, wines, "household-1")
        .classification,
    ).toBe("new")
    expect(
      matchCsvWine(row, wines, "household-2")
        .classification,
    ).toBe("existing")
  })

  it("surfaces every ambiguous catalog candidate", () => {
    const result = matchCsvWine(
      cleanedRow(
        validFields({
          cuvee: "Cuvée Ambiguë",
          vintage: "NV",
        }),
      ),
      wines,
      "household-1",
    )

    expect(result.classification).toBe("ambiguous")
    expect(result.candidates.map((wine) => wine.id)).toEqual([
      "wine-ambiguous-b",
      "wine-ambiguous-a",
    ])
  })

  it("does not attempt matching for an invalid cleaned row", () => {
    const result = matchCsvWine(
      cleanedRow(validFields({ quantity: "0" })),
      wines,
      "household-1",
    )

    expect(result.classification).toBe("invalid")
    expect(result.candidates).toEqual([])
  })

  it("summarizes every matching classification", () => {
    const rows = [
      cleanedRow(validFields(), 2),
      cleanedRow(validFields({ vintage: "2022" }), 3),
      cleanedRow(
        validFields({
          cuvee: "Cuvée Ambiguë",
          vintage: "NV",
        }),
        4,
      ),
      cleanedRow(validFields({ quantity: "0" }), 5),
    ]

    expect(
      summarizeCsvWineMatching(
        matchCsvWines(rows, wines, "household-1"),
      ),
    ).toEqual({
      ambiguousRowCount: 1,
      existingRowCount: 1,
      invalidRowCount: 1,
      newRowCount: 1,
      totalRowCount: 4,
    })
  })
})
