import { describe, expect, it } from "vitest"

import {
  mapCsvSourceRow,
  normalizeCsvHeader,
  suggestCsvColumnMapping,
  validateCsvColumnMapping,
  type CsvColumnMapping,
  type CsvImportFieldDefaults,
} from "./csvColumnMapping"

describe("CSV column mapping", () => {
  it("normalizes accents, casing, whitespace, and separators", () => {
    expect(normalizeCsvHeader("  MILLÉSIME / Année  ")).toBe(
      "millesime annee",
    )
  })

  it("suggests common English and French headers", () => {
    expect(
      suggestCsvColumnMapping([
        "Domaine",
        "Cuvée",
        "Millésime",
        "Couleur",
        "Appellation",
        "Région",
        "Format ml",
        "Cave",
        "Emplacement",
        "Quantité",
      ]),
    ).toEqual([
      "producer",
      "cuvee",
      "vintage",
      "color",
      "appellation",
      "area",
      "formatMl",
      "cellar",
      "location",
      "quantity",
    ])
  })

  it("does not guess unknown or duplicate target fields", () => {
    expect(
      suggestCsvColumnMapping([
        "Producer",
        "Winery",
        "Personal note",
      ]),
    ).toEqual(["producer", null, null])
  })

  it("requires identity, format, and quantity mappings", () => {
    const issues = validateCsvColumnMapping([
      "producer",
      "cuvee",
      "color",
    ])

    expect(
      issues.map((mappingIssue) => mappingIssue.field),
    ).toEqual([
      "formatMl",
      "quantity",
    ])
  })

  it("allows vintage, storage, and supporting metadata to remain unmapped", () => {
    const completeMapping: CsvColumnMapping = [
      "producer",
      "cuvee",
      "color",
      "formatMl",
      "quantity",
    ]

    expect(
      validateCsvColumnMapping(completeMapping),
    ).toEqual([])
  })

  it("accepts an explicit all-row value instead of a required source column", () => {
    const mapping: CsvColumnMapping = [
      "producer",
      "cuvee",
      "color",
      "quantity",
    ]
    const fieldDefaults: CsvImportFieldDefaults = {
      formatMl: "750 ml",
    }

    expect(
      validateCsvColumnMapping(mapping, fieldDefaults),
    ).toEqual([])
  })

  it("reports duplicate assignments with source indexes", () => {
    const issues = validateCsvColumnMapping([
      "producer",
      "producer",
      "cuvee",
      "color",
      "formatMl",
      "cellar",
      "location",
      "quantity",
    ])

    expect(issues).toContainEqual({
      field: "producer",
      message:
        "Producer is assigned to more than one source column",
      sourceColumnIndexes: [0, 1],
      type: "DUPLICATE_FIELD",
    })
  })

  it("maps raw values and preserves every unmapped source value", () => {
    const mapped = mapCsvSourceRow(
      ["Producer", "Cuvée", "Private note"],
      {
        recordNumber: 3,
        sourceLineEnd: 4,
        sourceLineStart: 3,
        values: ["  Domaine Test ", "Réserve", "Gift"],
      },
      ["producer", "cuvee", null],
    )

    expect(mapped).toEqual({
      fields: {
        cuvee: "Réserve",
        producer: "  Domaine Test ",
      },
      recordNumber: 3,
      sourceLineEnd: 4,
      sourceLineStart: 3,
      unmapped: [
        {
          sourceColumnIndex: 2,
          sourceHeader: "Private note",
          value: "Gift",
        },
      ],
    })
  })

  it("applies explicit all-row values while preserving mapped source values", () => {
    const mapped = mapCsvSourceRow(
      ["Producer", "Cuvée", "Color", "Quantity"],
      {
        recordNumber: 2,
        sourceLineEnd: 2,
        sourceLineStart: 2,
        values: ["Domaine Test", "Réserve", "red", "6"],
      },
      ["producer", "cuvee", "color", "quantity"],
      {
        cellar: "Main Cellar",
        formatMl: "750 ml",
      },
    )

    expect(mapped.fields).toEqual({
      cellar: "Main Cellar",
      color: "red",
      cuvee: "Réserve",
      formatMl: "750 ml",
      producer: "Domaine Test",
      quantity: "6",
    })
  })
})
