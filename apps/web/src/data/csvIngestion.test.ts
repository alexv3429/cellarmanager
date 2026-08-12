import { describe, expect, it } from "vitest"

import {
  detectCsvDelimiter,
  parseCsvText,
} from "./csvIngestion"

describe("CSV ingestion parser", () => {
  it("parses a comma-delimited document without cleaning raw cells", () => {
    const document = parseCsvText(
      "Producer,Cuvée,Vintage\n  Domaine Test  ,Cuvée A,2020",
    )

    expect(document.delimiter).toBe(",")
    expect(document.delimiterSource).toBe("detected")
    expect(document.header?.values).toEqual([
      "Producer",
      "Cuvée",
      "Vintage",
    ])
    expect(document.rows[0]).toEqual({
      recordNumber: 2,
      sourceLineEnd: 2,
      sourceLineStart: 2,
      values: ["  Domaine Test  ", "Cuvée A", "2020"],
    })
    expect(document.issues).toEqual([])
  })

  it("detects semicolon and tab delimiters", () => {
    expect(
      parseCsvText(
        "\uFEFFProducer;Cuvée;Quantity\r\nDomaine;Réserve;2\r\n",
      ).delimiter,
    ).toBe(";")

    expect(
      parseCsvText(
        "Producer\tCuvée\tQuantity\nDomaine\tRéserve\t2",
      ).delimiter,
    ).toBe("\t")
  })

  it("honors an Excel sep directive and original source lines", () => {
    const document = parseCsvText(
      "sep=;\r\nProducer;Cuvée\r\nDomaine;Réserve",
    )

    expect(document.delimiter).toBe(";")
    expect(document.delimiterSource).toBe("directive")
    expect(document.header?.sourceLineStart).toBe(2)
    expect(document.rows[0]?.sourceLineStart).toBe(3)
  })

  it("supports quoted delimiters and escaped quotes", () => {
    const document = parseCsvText(
      'Producer,Cuvée,Notes\n"Domaine, Test","La ""Réserve""","Keep, exactly"',
    )

    expect(document.rows[0]?.values).toEqual([
      "Domaine, Test",
      'La "Réserve"',
      "Keep, exactly",
    ])
    expect(document.issues).toEqual([])
  })

  it("normalizes line endings inside multiline quoted cells", () => {
    const document = parseCsvText(
      'Producer,Notes\r\nDomaine,"first line\rsecond line\r\nthird line"\r\nOther,plain',
    )

    expect(document.rows[0]).toMatchObject({
      sourceLineEnd: 4,
      sourceLineStart: 2,
      values: [
        "Domaine",
        "first line\nsecond line\nthird line",
      ],
    })
    expect(document.rows[1]?.sourceLineStart).toBe(5)
  })

  it("ignores blank physical lines but preserves empty rows with columns", () => {
    const document = parseCsvText(
      "Producer,Cuvée\n\nDomaine,Réserve\n,\n",
    )

    expect(document.rows).toHaveLength(2)
    expect(document.rows[0]?.sourceLineStart).toBe(3)
    expect(document.rows[1]?.values).toEqual(["", ""])
  })

  it("reports rows whose column count differs from the header", () => {
    const document = parseCsvText(
      "Producer,Cuvée,Quantity\nDomaine,Réserve\nOther,Wine,2,extra",
    )

    expect(
      document.issues.map((parseIssue) => ({
        code: parseIssue.code,
        line: parseIssue.sourceLineNumber,
      })),
    ).toEqual([
      { code: "COLUMN_COUNT_MISMATCH", line: 2 },
      { code: "COLUMN_COUNT_MISMATCH", line: 3 },
    ])
  })

  it("reports malformed quoting while retaining inspectable rows", () => {
    const unexpectedQuote = parseCsvText(
      'Producer,Notes\nDomaine,unquoted"value',
    )
    const unterminated = parseCsvText(
      'Producer,Notes\nDomaine,"not closed',
    )
    const afterQuote = parseCsvText(
      'Producer,Notes\nDomaine,"closed"tail',
    )

    expect(
      unexpectedQuote.issues.map(
        (parseIssue) => parseIssue.code,
      ),
    ).toContain("UNEXPECTED_QUOTE")
    expect(
      unterminated.issues.map(
        (parseIssue) => parseIssue.code,
      ),
    ).toContain("UNTERMINATED_QUOTED_FIELD")
    expect(unterminated.rows[0]?.values).toEqual([
      "Domaine",
      "not closed",
    ])
    expect(
      afterQuote.issues.map(
        (parseIssue) => parseIssue.code,
      ),
    ).toContain("UNEXPECTED_CHARACTER_AFTER_QUOTE")
    expect(afterQuote.rows[0]?.values).toEqual([
      "Domaine",
      "closedtail",
    ])
  })

  it("requires explicit selection when delimiter detection is ambiguous", () => {
    const text = "a,b;c\n1,2;3"

    expect(detectCsvDelimiter(text)).toMatchObject({
      delimiter: null,
      issue: { code: "AMBIGUOUS_DELIMITER" },
    })

    expect(
      parseCsvText(text, { delimiter: ";" }).header?.values,
    ).toEqual(["a,b", "c"])
  })

  it("rejects empty, single-column, binary, and oversized input", () => {
    expect(parseCsvText("  \n").issues[0]?.code).toBe(
      "EMPTY_FILE",
    )
    expect(parseCsvText("Producer\nDomaine").issues[0]?.code).toBe(
      "DELIMITER_NOT_DETECTED",
    )
    expect(
      parseCsvText("Producer\nDomaine", {
        delimiter: ",",
      }).rows[0]?.values,
    ).toEqual(["Domaine"])
    expect(
      parseCsvText("Producer,Cuvée\nDomaine,\0Wine").issues[0]
        ?.code,
    ).toBe("NULL_BYTE")
    expect(
      parseCsvText("abcdef", {
        delimiter: ",",
        maxInputCharacters: 5,
      }).issues[0]?.code,
    ).toBe("INPUT_LIMIT_EXCEEDED")
  })

  it("reports record, column, and cell limits deterministically", () => {
    expect(
      parseCsvText("a,b\n1,2\n3,4", {
        maxRecords: 2,
      }).issues.map((parseIssue) => parseIssue.code),
    ).toContain("RECORD_LIMIT_EXCEEDED")

    expect(
      parseCsvText("a,b,c\n1,2,3", {
        maxColumns: 2,
      }).issues.map((parseIssue) => parseIssue.code),
    ).toContain("COLUMN_LIMIT_EXCEEDED")

    const cellLimited = parseCsvText("a,b\nlong,ok", {
      maxCellCharacters: 3,
    })

    expect(
      cellLimited.issues.map((parseIssue) => parseIssue.code),
    ).toContain("CELL_LIMIT_EXCEEDED")
    expect(cellLimited.rows[0]?.values).toEqual(["lon", "ok"])
    expect(cellLimited.truncated).toBe(true)
  })

  it("reports a delimiter conflict without parsing rows", () => {
    const document = parseCsvText(
      "sep=;\nProducer;Cuvée\nDomaine;Réserve",
      { delimiter: "," },
    )

    expect(document.issues[0]?.code).toBe(
      "DELIMITER_CONFLICT",
    )
    expect(document.header).toBeNull()
  })
})
