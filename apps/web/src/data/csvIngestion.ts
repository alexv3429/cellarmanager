export const CSV_DELIMITERS = [",", ";", "\t"] as const

export type CsvDelimiter =
  (typeof CSV_DELIMITERS)[number]

export type CsvDelimiterSource =
  | "detected"
  | "directive"
  | "explicit"

export type CsvParseIssueCode =
  | "AMBIGUOUS_DELIMITER"
  | "CELL_LIMIT_EXCEEDED"
  | "COLUMN_COUNT_MISMATCH"
  | "COLUMN_LIMIT_EXCEEDED"
  | "DELIMITER_CONFLICT"
  | "DELIMITER_NOT_DETECTED"
  | "EMPTY_FILE"
  | "INPUT_LIMIT_EXCEEDED"
  | "NULL_BYTE"
  | "RECORD_LIMIT_EXCEEDED"
  | "UNEXPECTED_CHARACTER_AFTER_QUOTE"
  | "UNEXPECTED_QUOTE"
  | "UNTERMINATED_QUOTED_FIELD"

export interface CsvParseIssue {
  code: CsvParseIssueCode
  message: string
  recordNumber?: number
  severity: "error" | "warning"
  sourceLineNumber?: number
}

export interface CsvSourceRecord {
  recordNumber: number
  sourceLineEnd: number
  sourceLineStart: number
  values: string[]
}

export interface CsvIngestionDocument {
  delimiter: CsvDelimiter | null
  delimiterSource: CsvDelimiterSource | null
  header: CsvSourceRecord | null
  issues: CsvParseIssue[]
  rows: CsvSourceRecord[]
  truncated: boolean
}

export interface CsvParseOptions {
  delimiter?: CsvDelimiter
  maxCellCharacters?: number
  maxColumns?: number
  maxInputCharacters?: number
  maxRecords?: number
}

interface ResolvedCsvParseOptions {
  delimiter?: CsvDelimiter
  maxCellCharacters: number
  maxColumns: number
  maxInputCharacters: number
  maxRecords: number
}

interface ParsedRecords {
  issues: CsvParseIssue[]
  records: CsvSourceRecord[]
  truncated: boolean
}

interface SeparatorDirective {
  delimiter: CsvDelimiter
  text: string
}

const defaultOptions: ResolvedCsvParseOptions = {
  maxCellCharacters: 100_000,
  maxColumns: 256,
  maxInputCharacters: 20_000_000,
  maxRecords: 100_001,
}

const delimiterNames: Record<CsvDelimiter, string> = {
  "\t": "tab",
  ",": "comma",
  ";": "semicolon",
}

function issue(
  code: CsvParseIssueCode,
  message: string,
  details: Partial<
    Pick<
      CsvParseIssue,
      "recordNumber" | "sourceLineNumber"
    >
  > = {},
  severity: CsvParseIssue["severity"] = "error",
): CsvParseIssue {
  return { code, message, severity, ...details }
}

function resolveOptions(
  options: CsvParseOptions,
): ResolvedCsvParseOptions {
  return {
    delimiter: options.delimiter,
    maxCellCharacters:
      options.maxCellCharacters ??
      defaultOptions.maxCellCharacters,
    maxColumns:
      options.maxColumns ?? defaultOptions.maxColumns,
    maxInputCharacters:
      options.maxInputCharacters ??
      defaultOptions.maxInputCharacters,
    maxRecords:
      options.maxRecords ?? defaultOptions.maxRecords,
  }
}

function stripByteOrderMark(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text
}

function readSeparatorDirective(
  text: string,
): SeparatorDirective | null {
  const match = /^sep=([,;\t])(?:\r\n|\n|\r)/iu.exec(text)

  if (!match) {
    return null
  }

  const delimiter = match[1]

  if (
    delimiter !== "," &&
    delimiter !== ";" &&
    delimiter !== "\t"
  ) {
    return null
  }

  return {
    delimiter,
    text: text.slice(match[0].length),
  }
}

function newlineLength(
  text: string,
  index: number,
): number {
  if (text[index] === "\r") {
    return text[index + 1] === "\n" ? 2 : 1
  }

  return text[index] === "\n" ? 1 : 0
}

function delimiterWidths(
  text: string,
  delimiter: CsvDelimiter,
): number[] {
  const widths: number[] = []
  let delimiterCount = 0
  let fieldStart = true
  let inQuotes = false
  let recordHasContent = false

  for (
    let index = 0;
    index < text.length && widths.length < 25;
    index += 1
  ) {
    const character = text[index] ?? ""

    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1
        recordHasContent = true
        continue
      }

      if (inQuotes) {
        inQuotes = false
      } else if (fieldStart) {
        inQuotes = true
      }

      recordHasContent = true
      fieldStart = false
      continue
    }

    if (inQuotes) {
      recordHasContent = true
      continue
    }

    if (character === delimiter) {
      delimiterCount += 1
      recordHasContent = true
      fieldStart = true
      continue
    }

    const currentNewlineLength = newlineLength(
      text,
      index,
    )

    if (currentNewlineLength > 0) {
      if (recordHasContent || delimiterCount > 0) {
        widths.push(delimiterCount + 1)
      }

      delimiterCount = 0
      fieldStart = true
      recordHasContent = false
      index += currentNewlineLength - 1
      continue
    }

    if (!/\s/u.test(character)) {
      recordHasContent = true
    }

    fieldStart = false
  }

  if (
    widths.length < 25 &&
    (recordHasContent || delimiterCount > 0)
  ) {
    widths.push(delimiterCount + 1)
  }

  return widths
}

function delimiterScore(widths: number[]): number {
  const headerWidth = widths[0] ?? 1

  if (headerWidth <= 1) {
    return 0
  }

  const matchingWidths = widths.filter(
    (width) => width === headerWidth,
  ).length
  const mismatchingWidths =
    widths.length - matchingWidths

  return (
    matchingWidths * 1_000 -
    mismatchingWidths * 100 +
    headerWidth
  )
}

export function detectCsvDelimiter(
  text: string,
): {
  delimiter: CsvDelimiter | null
  issue: CsvParseIssue | null
} {
  const candidates = CSV_DELIMITERS.map((delimiter) => ({
    delimiter,
    score: delimiterScore(
      delimiterWidths(text, delimiter),
    ),
  })).sort((left, right) => right.score - left.score)

  const first = candidates[0]
  const second = candidates[1]

  if (!first || first.score === 0) {
    return {
      delimiter: null,
      issue: issue(
        "DELIMITER_NOT_DETECTED",
        "Could not detect a comma, semicolon, or tab delimiter",
      ),
    }
  }

  if (second && second.score === first.score) {
    return {
      delimiter: null,
      issue: issue(
        "AMBIGUOUS_DELIMITER",
        "More than one delimiter fits this file; choose one explicitly",
      ),
    }
  }

  return { delimiter: first.delimiter, issue: null }
}

function parseRecords(
  text: string,
  delimiter: CsvDelimiter,
  startingLineNumber: number,
  options: ResolvedCsvParseOptions,
): ParsedRecords {
  const issues: CsvParseIssue[] = []
  const records: CsvSourceRecord[] = []
  let cell = ""
  let cellLimitReported = false
  let columnLimitReported = false
  let fieldCount = 0
  let fields: string[] = []
  let lineNumber = startingLineNumber
  let recordStarted = false
  let recordStartLine = startingLineNumber
  let state:
    | "after-quote"
    | "field-start"
    | "quoted"
    | "unquoted" = "field-start"
  let stopped = false
  let truncated = false

  function appendToCell(character: string) {
    if (cell.length < options.maxCellCharacters) {
      cell += character
      return
    }

    if (!cellLimitReported) {
      issues.push(
        issue(
          "CELL_LIMIT_EXCEEDED",
          `A cell exceeds the ${options.maxCellCharacters} character limit`,
          {
            recordNumber: records.length + 1,
            sourceLineNumber: lineNumber,
          },
        ),
      )
      cellLimitReported = true
      truncated = true
    }
  }

  function finishField() {
    fieldCount += 1

    if (fieldCount <= options.maxColumns) {
      fields.push(cell)
    } else if (!columnLimitReported) {
      issues.push(
        issue(
          "COLUMN_LIMIT_EXCEEDED",
          `Record ${records.length + 1} exceeds the ${options.maxColumns} column limit`,
          {
            recordNumber: records.length + 1,
            sourceLineNumber: recordStartLine,
          },
        ),
      )
      columnLimitReported = true
      truncated = true
    }

    cell = ""
    cellLimitReported = false
    state = "field-start"
  }

  function finishRecord(sourceLineEnd: number): boolean {
    finishField()

    const isBlankPhysicalRecord =
      fields.length === 1 &&
      (fields[0] ?? "").trim().length === 0

    if (!isBlankPhysicalRecord) {
      if (records.length >= options.maxRecords) {
        issues.push(
          issue(
            "RECORD_LIMIT_EXCEEDED",
            `The file exceeds the ${options.maxRecords} record limit`,
            { sourceLineNumber: recordStartLine },
          ),
        )
        truncated = true
        stopped = true
        return false
      }

      const recordNumber = records.length + 1

      records.push({
        recordNumber,
        sourceLineEnd,
        sourceLineStart: recordStartLine,
        values: fields,
      })
    }

    fields = []
    columnLimitReported = false
    fieldCount = 0
    recordStarted = false
    return true
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? ""

    if (state === "quoted") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          appendToCell('"')
          index += 1
        } else {
          state = "after-quote"
        }

        continue
      }

      const currentNewlineLength = newlineLength(
        text,
        index,
      )

      if (currentNewlineLength > 0) {
        appendToCell("\n")
        lineNumber += 1
        index += currentNewlineLength - 1
      } else {
        appendToCell(character)
      }

      continue
    }

    if (character === delimiter) {
      finishField()
      recordStarted = true
      continue
    }

    const currentNewlineLength = newlineLength(
      text,
      index,
    )

    if (currentNewlineLength > 0) {
      if (!finishRecord(lineNumber)) {
        break
      }

      lineNumber += 1
      recordStartLine = lineNumber
      index += currentNewlineLength - 1
      continue
    }

    if (state === "field-start" && character === '"') {
      state = "quoted"
      recordStarted = true
      continue
    }

    if (state === "after-quote") {
      if (/[^\S\r\n]/u.test(character)) {
        appendToCell(character)
        recordStarted = true
        continue
      }

      issues.push(
        issue(
          "UNEXPECTED_CHARACTER_AFTER_QUOTE",
          "Unexpected character after a closing quote",
          {
            recordNumber: records.length + 1,
            sourceLineNumber: lineNumber,
          },
        ),
      )
      appendToCell(character)
      state = "unquoted"
      recordStarted = true
      continue
    }

    if (state === "unquoted" && character === '"') {
      issues.push(
        issue(
          "UNEXPECTED_QUOTE",
          "Unexpected quote in an unquoted field",
          {
            recordNumber: records.length + 1,
            sourceLineNumber: lineNumber,
          },
        ),
      )
    }

    appendToCell(character)
    state = "unquoted"
    recordStarted = true
  }

  if (state === "quoted") {
    issues.push(
      issue(
        "UNTERMINATED_QUOTED_FIELD",
        "Quoted field is not closed before the end of the file",
        {
          recordNumber: records.length + 1,
          sourceLineNumber: recordStartLine,
        },
      ),
    )
  }

  if (
    !stopped &&
    (recordStarted || fields.length > 0 || cell.length > 0)
  ) {
    finishRecord(lineNumber)
  }

  return { issues, records, truncated }
}

function addColumnCountIssues(
  header: CsvSourceRecord,
  rows: CsvSourceRecord[],
): CsvParseIssue[] {
  return rows.flatMap((row) => {
    if (row.values.length === header.values.length) {
      return []
    }

    return [
      issue(
        "COLUMN_COUNT_MISMATCH",
        `Record ${row.recordNumber} has ${row.values.length} columns; expected ${header.values.length}`,
        {
          recordNumber: row.recordNumber,
          sourceLineNumber: row.sourceLineStart,
        },
      ),
    ]
  })
}

export function parseCsvText(
  input: string,
  options: CsvParseOptions = {},
): CsvIngestionDocument {
  const resolvedOptions = resolveOptions(options)
  const emptyDocument: CsvIngestionDocument = {
    delimiter: null,
    delimiterSource: null,
    header: null,
    issues: [],
    rows: [],
    truncated: false,
  }

  if (input.length > resolvedOptions.maxInputCharacters) {
    return {
      ...emptyDocument,
      issues: [
        issue(
          "INPUT_LIMIT_EXCEEDED",
          `The file exceeds the ${resolvedOptions.maxInputCharacters} character limit`,
        ),
      ],
      truncated: true,
    }
  }

  if (input.includes("\0")) {
    return {
      ...emptyDocument,
      issues: [
        issue(
          "NULL_BYTE",
          "The file contains a null byte and is not valid text CSV",
        ),
      ],
    }
  }

  let text = stripByteOrderMark(input)
  const directive = readSeparatorDirective(text)
  let startingLineNumber = 1

  if (directive) {
    text = directive.text
    startingLineNumber = 2
  }

  if (text.trim().length === 0) {
    return {
      ...emptyDocument,
      delimiter:
        resolvedOptions.delimiter ??
        directive?.delimiter ??
        null,
      delimiterSource: resolvedOptions.delimiter
        ? "explicit"
        : directive
          ? "directive"
          : null,
      issues: [
        issue("EMPTY_FILE", "The CSV file contains no records"),
      ],
    }
  }

  if (
    resolvedOptions.delimiter &&
    directive &&
    resolvedOptions.delimiter !== directive.delimiter
  ) {
    return {
      ...emptyDocument,
      issues: [
        issue(
          "DELIMITER_CONFLICT",
          `The explicit ${delimiterNames[resolvedOptions.delimiter]} delimiter conflicts with the sep= directive`,
          { sourceLineNumber: 1 },
        ),
      ],
    }
  }

  let delimiter =
    resolvedOptions.delimiter ?? directive?.delimiter ?? null
  let delimiterSource: CsvDelimiterSource | null =
    resolvedOptions.delimiter
      ? "explicit"
      : directive
        ? "directive"
        : null

  if (!delimiter) {
    const detected = detectCsvDelimiter(text)

    if (!detected.delimiter) {
      return {
        ...emptyDocument,
        issues: detected.issue ? [detected.issue] : [],
      }
    }

    delimiter = detected.delimiter
    delimiterSource = "detected"
  }

  const parsed = parseRecords(
    text,
    delimiter,
    startingLineNumber,
    resolvedOptions,
  )
  const header = parsed.records[0] ?? null
  const rows = parsed.records.slice(1)
  const issues = [...parsed.issues]

  if (!header) {
    issues.push(
      issue("EMPTY_FILE", "The CSV file contains no records"),
    )
  } else {
    issues.push(...addColumnCountIssues(header, rows))
  }

  return {
    delimiter,
    delimiterSource,
    header,
    issues,
    rows,
    truncated: parsed.truncated,
  }
}
