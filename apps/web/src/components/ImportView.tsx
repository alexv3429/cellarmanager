import {
  type ChangeEvent,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  CSV_IMPORT_FIELD_DEFINITIONS,
  mapCsvSourceRow,
  suggestCsvColumnMapping,
  validateCsvColumnMapping,
  type CsvColumnMapping,
  type CsvImportField,
} from "../data/csvColumnMapping"
import {
  cleanCsvMappedRow,
  summarizeCsvCleaning,
} from "../data/csvCleaning"
import {
  parseCsvText,
  type CsvDelimiter,
  type CsvIngestionDocument,
} from "../data/csvIngestion"
import { Notice } from "./Notice"

const FILE_SIZE_LIMIT_BYTES = 20_000_000
const SAMPLE_ROW_COUNT = 3
const CLEANING_ROW_DISPLAY_LIMIT = 100

function delimiterLabel(
  delimiter: CsvDelimiter | null,
): string {
  switch (delimiter) {
    case ",":
      return "Comma"
    case ";":
      return "Semicolon"
    case "\t":
      return "Tab"
    default:
      return "Not resolved"
  }
}

function sourceLineLabel(
  start: number,
  end: number,
): string {
  return start === end
    ? `Line ${start}`
    : `Lines ${start}–${end}`
}

export function ImportView() {
  const latestFileSelection = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [fileName, setFileName] = useState<string | null>(
    null,
  )
  const [sourceText, setSourceText] = useState<
    string | null
  >(null)
  const [document, setDocument] =
    useState<CsvIngestionDocument | null>(null)
  const [mapping, setMapping] =
    useState<CsvColumnMapping>([])
  const [fileError, setFileError] = useState<
    string | null
  >(null)

  const mappingIssues = useMemo(
    () => validateCsvColumnMapping(mapping),
    [mapping],
  )

  const sampleRows = useMemo(() => {
    if (!document?.header) {
      return []
    }

    return document.rows
      .slice(0, SAMPLE_ROW_COUNT)
      .map((row) =>
        mapCsvSourceRow(
          document.header?.values ?? [],
          row,
          mapping,
        ),
      )
  }, [document, mapping])

  const cleanedRows = useMemo(() => {
    if (!document?.header) {
      return []
    }

    return document.rows.map((row) =>
      cleanCsvMappedRow(
        mapCsvSourceRow(
          document.header?.values ?? [],
          row,
          mapping,
        ),
      ),
    )
  }, [document, mapping])

  const cleaningSummary = useMemo(
    () => summarizeCsvCleaning(cleanedRows),
    [cleanedRows],
  )

  const displayedCleanedRows = useMemo(() => {
    const invalidRows = cleanedRows.filter(
      (row) => row.issues.length > 0,
    )
    const readyRows = cleanedRows.filter(
      (row) => row.issues.length === 0,
    )

    return [...invalidRows, ...readyRows].slice(
      0,
      CLEANING_ROW_DISPLAY_LIMIT,
    )
  }, [cleanedRows])

  function applyDocument(
    nextDocument: CsvIngestionDocument,
  ) {
    setDocument(nextDocument)
    setMapping(
      nextDocument.header
        ? suggestCsvColumnMapping(
            nextDocument.header.values,
          )
        : [],
    )
  }

  async function selectFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    const selectionId = latestFileSelection.current + 1
    latestFileSelection.current = selectionId

    setFileError(null)
    setSourceText(null)
    setDocument(null)
    setMapping([])
    setFileName(file?.name ?? null)

    if (!file) {
      return
    }

    if (file.size > FILE_SIZE_LIMIT_BYTES) {
      setFileError(
        "Choose a CSV file smaller than 20 MB.",
      )
      return
    }

    try {
      const bytes = await file.arrayBuffer()
      const text = new TextDecoder("utf-8", {
        fatal: true,
      }).decode(bytes)

      if (latestFileSelection.current !== selectionId) {
        return
      }

      setSourceText(text)
      applyDocument(parseCsvText(text))
    } catch {
      if (latestFileSelection.current !== selectionId) {
        return
      }

      setFileError(
        "Unable to read this file as UTF-8 CSV.",
      )
    }
  }

  function selectDelimiter(delimiter: CsvDelimiter) {
    if (sourceText === null) {
      return
    }

    applyDocument(parseCsvText(sourceText, { delimiter }))
  }

  function mapColumn(
    sourceColumnIndex: number,
    value: string,
  ) {
    const field =
      value.length > 0
        ? (value as CsvImportField)
        : null

    setMapping((currentMapping) =>
      currentMapping.map((currentField, index) =>
        index === sourceColumnIndex
          ? field
          : currentField,
      ),
    )
  }

  function resetImport() {
    latestFileSelection.current += 1
    setFileInputKey((currentKey) => currentKey + 1)
    setFileName(null)
    setSourceText(null)
    setDocument(null)
    setMapping([])
    setFileError(null)
  }

  const parserHasErrors =
    document?.issues.some(
      (parseIssue) => parseIssue.severity === "error",
    ) ?? false

  const mappingIsReady =
    document?.header != null &&
    !parserHasErrors &&
    mappingIssues.length === 0

  const showCleaning = mappingIsReady

  return (
    <main className="import-view">
      <div className="import-view__intro">
        <h1>Import CSV</h1>
        <p>
          Upload a CSV, map its columns, and validate normalized
          wine and quantity values. Nothing is written to your
          cellar during these preparation steps.
        </p>
      </div>

      <section
        aria-labelledby="import-file-heading"
        className="import-file-panel"
      >
        <div>
          <h2 id="import-file-heading">1. Choose a file</h2>
          <p>
            UTF-8 CSV up to 20 MB. Comma, semicolon, and tab
            delimiters are supported.
          </p>
        </div>

        {!fileName ? (
          <div className="import-file-picker">
            <span>CSV file</span>
            <input
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              aria-label="CSV file"
              hidden
              key={fileInputKey}
              onChange={(event) => void selectFile(event)}
              ref={fileInput}
              type="file"
            />
            <button
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              Choose CSV file
            </button>
          </div>
        ) : null}

        {fileName ? (
          <div className="import-file-summary">
            <div>
              <strong>{fileName}</strong>
              {document ? (
                <span>
                  {document.rows.length} source {document.rows.length === 1 ? "row" : "rows"}
                  <span aria-hidden="true"> · </span>
                  {delimiterLabel(document.delimiter)} delimiter
                </span>
              ) : null}
            </div>
            <button onClick={resetImport} type="button">
              Choose another file
            </button>
          </div>
        ) : null}
      </section>

      {fileError ? (
        <Notice role="alert" tone="error">
          {fileError}
        </Notice>
      ) : null}

      {document && document.delimiter === null ? (
        <section
          aria-labelledby="delimiter-heading"
          className="import-delimiter-panel"
        >
          <div>
            <h2 id="delimiter-heading">
              Select the delimiter
            </h2>
            <p>
              Automatic detection was inconclusive. Choose the
              character that separates columns in this file.
            </p>
          </div>
          <div className="import-delimiter-actions">
            <button
              onClick={() => selectDelimiter(",")}
              type="button"
            >
              Comma
            </button>
            <button
              onClick={() => selectDelimiter(";")}
              type="button"
            >
              Semicolon
            </button>
            <button
              onClick={() => selectDelimiter("\t")}
              type="button"
            >
              Tab
            </button>
          </div>
        </section>
      ) : null}

      {document && document.issues.length > 0 ? (
        <Notice role="alert" tone="error">
          <strong>CSV structure needs attention</strong>
          <ul className="import-issue-list">
            {document.issues.map((parseIssue, index) => (
              <li key={`${parseIssue.code}:${index}`}>
                {parseIssue.sourceLineNumber
                  ? `Line ${parseIssue.sourceLineNumber}: `
                  : ""}
                {parseIssue.message}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {document?.header ? (
        <section
          aria-labelledby="mapping-heading"
          className="import-mapping-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="mapping-heading">
                2. Map columns
              </h2>
              <p>
                Suggestions use header names only. Review every
                assignment; values remain unchanged.
              </p>
            </div>
            <span className="import-section-heading__status">
              {mapping.filter(Boolean).length} of {mapping.length} columns mapped
            </span>
          </div>

          <div className="import-mapping-list">
            {document.header.values.map(
              (sourceHeader, sourceColumnIndex) => {
                const sampleValues = document.rows
                  .map(
                    (row) =>
                      row.values[sourceColumnIndex] ?? "",
                  )
                  .filter((value) => value.length > 0)
                  .slice(0, SAMPLE_ROW_COUNT)

                return (
                  <article
                    className="import-mapping-card"
                    key={`${sourceHeader}:${sourceColumnIndex}`}
                  >
                    <div>
                      <span>
                        Source column {sourceColumnIndex + 1}
                      </span>
                      <strong>
                        {sourceHeader || "Untitled column"}
                      </strong>
                    </div>

                    <label>
                      <span>CellarManager field</span>
                      <select
                        onChange={(event) =>
                          mapColumn(
                            sourceColumnIndex,
                            event.target.value,
                          )
                        }
                        value={
                          mapping[sourceColumnIndex] ?? ""
                        }
                      >
                        <option value="">
                          Do not map
                        </option>
                        {CSV_IMPORT_FIELD_DEFINITIONS.map(
                          (definition) => (
                            <option
                              key={definition.field}
                              value={definition.field}
                            >
                              {definition.label}
                              {definition.required
                                ? " (required)"
                                : ""}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    <div className="import-mapping-card__samples">
                      <span>Sample values</span>
                      {sampleValues.length > 0 ? (
                        <ul>
                          {sampleValues.map((value, index) => (
                            <li key={`${value}:${index}`}>
                              {value}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <em>No non-empty sample values</em>
                      )}
                    </div>
                  </article>
                )
              },
            )}
          </div>

          {mappingIssues.length > 0 ? (
            <Notice role="status" tone="warning">
              <strong>Complete the mapping</strong>
              <ul className="import-issue-list">
                {mappingIssues.map((mappingIssue) => (
                  <li
                    key={`${mappingIssue.type}:${mappingIssue.field}`}
                  >
                    {mappingIssue.message}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </section>
      ) : null}

      {document?.header && sampleRows.length > 0 ? (
        <section
          aria-labelledby="preview-heading"
          className="import-preview-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="preview-heading">
                3. Check the sample
              </h2>
              <p>
                First {sampleRows.length} source {sampleRows.length === 1 ? "row" : "rows"}, shown with the current mapping.
              </p>
            </div>
          </div>

          <div className="import-preview-list">
            {sampleRows.map((row) => (
              <article
                className="import-preview-card"
                key={row.recordNumber}
              >
                <header>
                  <strong>
                    Source record {row.recordNumber}
                  </strong>
                  <span>
                    {sourceLineLabel(
                      row.sourceLineStart,
                      row.sourceLineEnd,
                    )}
                  </span>
                </header>

                <dl>
                  {CSV_IMPORT_FIELD_DEFINITIONS.flatMap(
                    (definition) => {
                      const value = row.fields[definition.field]

                      return value === undefined
                        ? []
                        : [
                            <div key={definition.field}>
                              <dt>{definition.label}</dt>
                              <dd>{value || "Empty"}</dd>
                            </div>,
                          ]
                    },
                  )}
                </dl>

                {row.unmapped.length > 0 ? (
                  <details>
                    <summary>
                      Preserved unmapped values ({row.unmapped.length})
                    </summary>
                    <dl>
                      {row.unmapped.map((sourceValue) => (
                        <div
                          key={sourceValue.sourceColumnIndex}
                        >
                          <dt>
                            {sourceValue.sourceHeader ||
                              `Column ${sourceValue.sourceColumnIndex + 1}`}
                          </dt>
                          <dd>
                            {sourceValue.value || "Empty"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {showCleaning ? (
        <section
          aria-labelledby="cleaning-heading"
          className="import-cleaning-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="cleaning-heading">
                4. Clean and validate
              </h2>
              <p>
                Whitespace, color casing, vintage, metric
                bottle formats, and quantities are normalized.
                Source values remain available for comparison.
              </p>
            </div>
            <span className="import-section-heading__status">
              {cleaningSummary.invalidRowCount === 0
                ? `${cleaningSummary.readyRowCount} rows ready`
                : `${cleaningSummary.invalidRowCount} rows need attention`}
            </span>
          </div>

          <div
            aria-label="Cleaning summary"
            className="import-cleaning-summary"
          >
            <div>
              <strong>{cleaningSummary.totalRowCount}</strong>
              <span>Total rows</span>
            </div>
            <div>
              <strong>{cleaningSummary.readyRowCount}</strong>
              <span>Ready rows</span>
            </div>
            <div>
              <strong>{cleaningSummary.invalidRowCount}</strong>
              <span>Invalid rows</span>
            </div>
            <div>
              <strong>{cleaningSummary.changedValueCount}</strong>
              <span>Normalized values</span>
            </div>
          </div>

          <p className="import-cleaning-display-note">
            Showing {displayedCleanedRows.length} of {cleaningSummary.totalRowCount} rows. Invalid rows appear first; source record and line numbers remain unchanged.
          </p>

          {cleaningSummary.issueCount > 0 ? (
            <Notice role="alert" tone="error">
              <strong>
                Correct {cleaningSummary.issueCount} source {cleaningSummary.issueCount === 1 ? "issue" : "issues"}
              </strong>
              <p>
                Cleaning is read-only. Update the CSV and upload
                it again to resolve these values.
              </p>
            </Notice>
          ) : (
            <Notice role="status" tone="success">
              All rows passed cleaning and value validation.
            </Notice>
          )}

          <div className="import-cleaning-list">
            {displayedCleanedRows.map((row) => (
              <article
                className={
                  row.issues.length > 0
                    ? "import-cleaning-card import-cleaning-card--invalid"
                    : "import-cleaning-card"
                }
                key={row.recordNumber}
              >
                <header>
                  <div>
                    <strong>
                      Source record {row.recordNumber}
                    </strong>
                    <span>
                      {sourceLineLabel(
                        row.sourceLineStart,
                        row.sourceLineEnd,
                      )}
                    </span>
                  </div>
                  <span
                    className={
                      row.issues.length > 0
                        ? "import-row-status import-row-status--invalid"
                        : "import-row-status import-row-status--ready"
                    }
                  >
                    {row.issues.length > 0
                      ? `${row.issues.length} ${row.issues.length === 1 ? "issue" : "issues"}`
                      : "Ready"}
                  </span>
                </header>

                {row.issues.length > 0 ? (
                  <ul className="import-cleaning-card__issues">
                    {row.issues.map((issue) => (
                      <li key={`${issue.code}:${issue.field}`}>
                        <strong>{issue.message}</strong>
                        <span>
                          Source value: {issue.sourceValue === null || issue.sourceValue.length === 0 ? "Empty" : issue.sourceValue}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <dl className="import-cleaning-card__values">
                  {CSV_IMPORT_FIELD_DEFINITIONS.map(
                    (definition) => {
                      const value =
                        row.fields[definition.field]
                      const fieldIsInvalid = row.issues.some(
                        (issue) =>
                          issue.field === definition.field,
                      )

                      return (
                        <div key={definition.field}>
                          <dt>{definition.label}</dt>
                          <dd
                            className={
                              fieldIsInvalid
                                ? "import-cleaned-value--invalid"
                                : undefined
                            }
                          >
                            {fieldIsInvalid
                              ? "Invalid"
                              : definition.field === "formatMl" && value !== null
                              ? `${value} ml`
                              : definition.field === "vintage" && value === null
                                ? "NV"
                                : value ?? "Empty"}
                          </dd>
                        </div>
                      )
                    },
                  )}
                </dl>

                {row.changes.length > 0 ? (
                  <details>
                    <summary>
                      Normalized values ({row.changes.length})
                    </summary>
                    <ul className="import-cleaning-card__changes">
                      {row.changes.map((change) => {
                        const label =
                          CSV_IMPORT_FIELD_DEFINITIONS.find(
                            (definition) =>
                              definition.field === change.field,
                          )?.label ?? change.field

                        return (
                          <li key={change.field}>
                            <strong>{label}</strong>
                            <span>{change.sourceValue || "Empty"}</span>
                            <span aria-hidden="true">→</span>
                            <span>{change.normalizedValue}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {document?.header ? (
        <section
          aria-labelledby="import-result-heading"
          className="import-result-panel"
        >
          <div>
            <h2 id="import-result-heading">
              Import preparation
            </h2>
            <p>
              {!mappingIsReady
                ? "Resolve every CSV structure and required mapping issue before cleaning."
                : cleaningSummary.issueCount > 0
                  ? "Resolve every cleaning issue before matching wines. No data has been written."
                  : "Cleaning is complete. Wine matching will be added in the next step; unresolved storage will be assigned before import."}
            </p>
          </div>
          <button disabled type="button">
            Continue to wine matching
          </button>
        </section>
      ) : null}
    </main>
  )
}
