import { describe, expect, it } from "vitest"

import type { CsvMappedSourceRow } from "./csvColumnMapping"
import {
  cleanCsvMappedRow,
  parseCsvBottleFormat,
  parseCsvQuantity,
  summarizeCsvCleaning,
} from "./csvCleaning"

function mappedRow(
  fields: CsvMappedSourceRow["fields"],
  recordNumber = 2,
): CsvMappedSourceRow {
  return {
    fields,
    recordNumber,
    sourceLineEnd: recordNumber,
    sourceLineStart: recordNumber,
    unmapped: [],
  }
}

describe("CSV cleaning and normalization", () => {
  it("normalizes wine, storage, and quantity values", () => {
    const cleaned = cleanCsvMappedRow(
      mappedRow({
        appellation: "  Côte   du Rhône ",
        area: " Rhône   Sud ",
        cellar: " Armoire   principale ",
        color: " ROUGE ",
        cuvee: "  Vieilles   Vignes ",
        formatMl: "75 cl",
        location: " A0.7 ",
        producer: " Domaine   Test ",
        quantity: " 2 ",
        vintage: " 2021 ",
      }),
    )

    expect(cleaned.fields).toEqual({
      appellation: "Côte du Rhône",
      area: "Rhône Sud",
      cellar: "Armoire principale",
      color: "rouge",
      cuvee: "Vieilles Vignes",
      formatMl: 750,
      location: "A0.7",
      producer: "Domaine Test",
      quantity: 2,
      vintage: 2021,
    })
    expect(cleaned.issues).toEqual([])
    expect(cleaned.changes).toHaveLength(10)
  })

  it("recognizes blank, English, and French NV values", () => {
    for (const vintage of [
      "",
      "NV",
      "N.V.",
      "NM",
      "N.M.",
      "non-vintage",
      "Sans millésime",
    ]) {
      const cleaned = cleanCsvMappedRow(
        mappedRow({
          color: "red",
          cuvee: "Cuvée",
          formatMl: "750",
          producer: "Domaine",
          quantity: "1",
          vintage,
        }),
      )

      expect(cleaned.fields.vintage).toBeNull()
      expect(cleaned.issues).toEqual([])
    }
  })

  it("applies an explicit fallback only to empty cuvée cells", () => {
    const fields = {
      appellation: "Fitou",
      color: "RED",
      cuvee: "",
      formatMl: "750 ml",
      producer: "Domaine Test",
      quantity: "1",
      vintage: "NM",
    }

    const fromAppellation = cleanCsvMappedRow(
      mappedRow(fields),
      { cuveeFallback: { mode: "appellation" } },
    )
    const fromColor = cleanCsvMappedRow(mappedRow(fields), {
      cuveeFallback: { mode: "color" },
    })
    const fromFixedValue = cleanCsvMappedRow(
      mappedRow(fields),
      {
        cuveeFallback: {
          mode: "fixed",
          value: " Generic ",
        },
      },
    )
    const existingCuvee = cleanCsvMappedRow(
      mappedRow({ ...fields, cuvee: "Réserve" }),
      { cuveeFallback: { mode: "appellation" } },
    )

    expect(fromAppellation.fields.cuvee).toBe("Fitou")
    expect(fromColor.fields.cuvee).toBe("red")
    expect(fromFixedValue.fields.cuvee).toBe("Generic")
    expect(existingCuvee.fields.cuvee).toBe("Réserve")
    expect(fromAppellation.fields.vintage).toBeNull()
    expect(fromAppellation.issues).toEqual([])
    expect(fromAppellation.changes).toContainEqual({
      field: "vintage",
      normalizedValue: "NV",
      sourceValue: "NM",
    })
  })

  it("keeps an empty cuvée invalid when no usable fallback is selected", () => {
    const fields = {
      appellation: "",
      color: "red",
      cuvee: "",
      formatMl: "750 ml",
      producer: "Domaine Test",
      quantity: "1",
    }

    const withoutFallback = cleanCsvMappedRow(
      mappedRow(fields),
    )
    const emptyAppellationFallback = cleanCsvMappedRow(
      mappedRow(fields),
      { cuveeFallback: { mode: "appellation" } },
    )

    expect(withoutFallback.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_VALUE",
        field: "cuvee",
      }),
    )
    expect(emptyAppellationFallback.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_VALUE",
        field: "cuvee",
      }),
    )
  })

  it("rejects malformed and out-of-range vintages", () => {
    for (const vintage of ["202", "1799", "2201", "unknown"]) {
      const cleaned = cleanCsvMappedRow(
        mappedRow({
          color: "red",
          cuvee: "Cuvée",
          formatMl: "750",
          producer: "Domaine",
          quantity: "1",
          vintage,
        }),
      )

      expect(cleaned.fields.vintage).toBeNull()
      expect(cleaned.issues).toContainEqual(
        expect.objectContaining({
          code: "INVALID_VINTAGE",
          field: "vintage",
          sourceValue: vintage,
        }),
      )
    }
  })

  it("normalizes common metric bottle formats", () => {
    expect(parseCsvBottleFormat("750")).toBe(750)
    expect(parseCsvBottleFormat("750 ml")).toBe(750)
    expect(parseCsvBottleFormat("75cl")).toBe(750)
    expect(parseCsvBottleFormat("37.5 cl")).toBe(375)
    expect(parseCsvBottleFormat("0,75 L")).toBe(750)
    expect(parseCsvBottleFormat("1.5 litres")).toBe(1500)
  })

  it("rejects ambiguous or non-integral bottle formats", () => {
    expect(parseCsvBottleFormat("magnum")).toBeNull()
    expect(parseCsvBottleFormat("0.333 l")).toBe(333)
    expect(parseCsvBottleFormat("1.25 ml")).toBeNull()
    expect(parseCsvBottleFormat("0 ml")).toBeNull()
    expect(parseCsvBottleFormat("2147483648 ml")).toBeNull()
  })

  it("requires a positive whole-number quantity", () => {
    expect(parseCsvQuantity(" 12 ")).toBe(12)
    expect(parseCsvQuantity("0")).toBeNull()
    expect(parseCsvQuantity("1.5")).toBeNull()
    expect(parseCsvQuantity("2 bottles")).toBeNull()
    expect(parseCsvQuantity("2147483648")).toBeNull()
  })

  it("reports field-specific issues with source context", () => {
    const cleaned = cleanCsvMappedRow(
      mappedRow(
        {
          color: " ",
          cuvee: "Cuvée",
          formatMl: "magnum",
          producer: " ",
          quantity: "0",
          vintage: "202",
        },
        17,
      ),
    )

    expect(
      cleaned.issues.map((issue) => [
        issue.code,
        issue.field,
        issue.recordNumber,
        issue.sourceLineStart,
      ]),
    ).toEqual([
      ["MISSING_REQUIRED_VALUE", "producer", 17, 17],
      ["INVALID_VINTAGE", "vintage", 17, 17],
      ["MISSING_REQUIRED_VALUE", "color", 17, 17],
      ["INVALID_BOTTLE_FORMAT", "formatMl", 17, 17],
      ["INVALID_QUANTITY", "quantity", 17, 17],
    ])
  })

  it("keeps optional metadata and storage empty", () => {
    const sourceRow = mappedRow({
      color: "white",
      cuvee: "Cuvée",
      formatMl: "750",
      producer: "Domaine",
      quantity: "1",
    })
    const cleaned = cleanCsvMappedRow(sourceRow)

    expect(cleaned.fields).toMatchObject({
      appellation: null,
      area: null,
      cellar: null,
      location: null,
      vintage: null,
    })
    expect(cleaned.issues).toEqual([])
    expect(cleaned.sourceRow).toBe(sourceRow)
  })

  it("summarizes ready, invalid, changed, and issue counts", () => {
    const ready = cleanCsvMappedRow(
      mappedRow({
        color: " RED ",
        cuvee: "Cuvée",
        formatMl: "75 cl",
        producer: "Domaine",
        quantity: "1",
      }),
    )
    const invalid = cleanCsvMappedRow(
      mappedRow(
        {
          color: "",
          cuvee: "Cuvée",
          formatMl: "750",
          producer: "Domaine",
          quantity: "0",
        },
        3,
      ),
    )

    expect(summarizeCsvCleaning([ready, invalid])).toEqual({
      changedValueCount: 3,
      invalidRowCount: 1,
      issueCount: 2,
      readyRowCount: 1,
      totalRowCount: 2,
    })
  })
})
