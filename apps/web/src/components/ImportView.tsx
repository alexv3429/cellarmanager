import { useQuery } from "@powersync/react"
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
import {
  matchCsvWines,
  summarizeCsvWineMatching,
  type CsvWineMatchClassification,
} from "../data/csvWineMatching"
import {
  formatWineVolume,
  type WineCatalogEntry,
} from "../data/wineCatalog"
import { Notice } from "./Notice"

const FILE_SIZE_LIMIT_BYTES = 20_000_000
const SAMPLE_ROW_COUNT = 3
const CLEANING_ROW_DISPLAY_LIMIT = 100
const MATCHING_ROW_DISPLAY_LIMIT = 100

const WINE_CATALOG_QUERY = `
  select
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    format_ml
  from wines
  where household_id = ?
  order by producer, cuvee, vintage, color, format_ml, id
`

interface ImportViewProps {
  householdId: string
}

interface ImportWorkspaceProps extends ImportViewProps {
  catalogError: unknown
  catalogIsLoading: boolean
  catalogWines: WineCatalogEntry[]
}

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

function matchingStatusLabel(
  classification: CsvWineMatchClassification,
): string {
  switch (classification) {
    case "ambiguous":
      return "Ambiguous"
    case "existing":
      return "Existing"
    case "invalid":
      return "Invalid"
    case "new":
      return "New"
  }
}

export function ImportView({
  householdId,
}: ImportViewProps) {
  const {
    data: catalogWines,
    error: catalogError,
    isLoading: catalogIsLoading,
  } = useQuery<WineCatalogEntry>(
    WINE_CATALOG_QUERY,
    [householdId],
  )

  return (
    <ImportWorkspace
      catalogError={catalogError}
      catalogIsLoading={catalogIsLoading}
      catalogWines={catalogWines}
      householdId={householdId}
    />
  )
}

export function ImportWorkspace({
  catalogError,
  catalogIsLoading,
  catalogWines,
  householdId,
}: ImportWorkspaceProps) {
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

  const matchingResults = useMemo(
    () =>
      matchCsvWines(
        cleanedRows,
        catalogWines,
        householdId,
      ),
    [catalogWines, cleanedRows, householdId],
  )

  const matchingSummary = useMemo(
    () => summarizeCsvWineMatching(matchingResults),
    [matchingResults],
  )

  const displayedMatchingResults = useMemo(() => {
    const classifications: CsvWineMatchClassification[] = [
      "ambiguous",
      "existing",
      "new",
      "invalid",
    ]

    return classifications
      .flatMap((classification) =>
        matchingResults.filter(
          (result) =>
            result.classification === classification,
        ),
      )
      .slice(0, MATCHING_ROW_DISPLAY_LIMIT)
  }, [matchingResults])

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
  const showMatching =
    mappingIsReady && cleaningSummary.issueCount === 0

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

      {showMatching ? (
        <section
          aria-busy={catalogIsLoading}
          aria-labelledby="matching-heading"
          className="import-matching-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="matching-heading">
                5. Match catalog wines
              </h2>
              <p>
                Producer, cuvée, vintage, color, and bottle
                format form the conservative wine identity.
                Appellation and area are supporting metadata.
              </p>
            </div>
            <span className="import-section-heading__status">
              {catalogIsLoading
                ? "Checking catalog"
                : catalogError
                  ? "Catalog unavailable"
                  : matchingSummary.ambiguousRowCount > 0
                    ? `${matchingSummary.ambiguousRowCount} ambiguous ${matchingSummary.ambiguousRowCount === 1 ? "row" : "rows"}`
                    : `${matchingSummary.totalRowCount} rows classified`}
            </span>
          </div>

          {catalogIsLoading ? (
            <Notice role="status">
              Checking the synchronized catalog for the active
              household…
            </Notice>
          ) : catalogError ? (
            <Notice role="alert" tone="error">
              <strong>Unable to check the wine catalog</strong>
              <p>{String(catalogError)}</p>
            </Notice>
          ) : (
            <>
              <div
                aria-label="Wine matching summary"
                className="import-matching-summary"
              >
                <div>
                  <strong>{matchingSummary.totalRowCount}</strong>
                  <span>Total rows</span>
                </div>
                <div>
                  <strong>{matchingSummary.existingRowCount}</strong>
                  <span>Existing matches</span>
                </div>
                <div>
                  <strong>{matchingSummary.newRowCount}</strong>
                  <span>New rows</span>
                </div>
                <div>
                  <strong>{matchingSummary.ambiguousRowCount}</strong>
                  <span>Ambiguous rows</span>
                </div>
              </div>

              <p className="import-matching-display-note">
                Showing {displayedMatchingResults.length} of {matchingSummary.totalRowCount} rows. Ambiguous rows appear first; matching is read-only.
              </p>

              {matchingSummary.ambiguousRowCount > 0 ? (
                <Notice role="alert" tone="warning">
                  <strong>
                    Resolve {matchingSummary.ambiguousRowCount} ambiguous {matchingSummary.ambiguousRowCount === 1 ? "row" : "rows"} before import
                  </strong>
                  <p>
                    Every exact catalog candidate is shown below.
                    Explicit candidate selection will be added in
                    the issue-resolution step.
                  </p>
                </Notice>
              ) : (
                <Notice role="status" tone="success">
                  Every source row is classified as an existing or
                  new wine.
                </Notice>
              )}

              <div className="import-matching-list">
                {displayedMatchingResults.map((result) => {
                  const { row } = result

                  return (
                    <article
                      className={`import-matching-card import-matching-card--${result.classification}`}
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
                          className={`import-row-status import-row-status--${result.classification}`}
                        >
                          {matchingStatusLabel(
                            result.classification,
                          )}
                        </span>
                      </header>

                      <dl className="import-matching-card__identity">
                        <div>
                          <dt>Producer</dt>
                          <dd>{row.fields.producer}</dd>
                        </div>
                        <div>
                          <dt>Cuvée</dt>
                          <dd>{row.fields.cuvee}</dd>
                        </div>
                        <div>
                          <dt>Vintage</dt>
                          <dd>{row.fields.vintage ?? "NV"}</dd>
                        </div>
                        <div>
                          <dt>Color</dt>
                          <dd>{row.fields.color}</dd>
                        </div>
                        <div>
                          <dt>Bottle format</dt>
                          <dd>
                            {formatWineVolume(
                              row.fields.formatMl ?? 0,
                            )}
                          </dd>
                        </div>
                      </dl>

                      <div className="import-matching-card__outcome">
                        <strong>
                          {result.classification === "ambiguous"
                            ? `${result.candidates.length} catalog references share this identity`
                            : result.classification === "existing"
                              ? "One existing catalog reference matched"
                              : "No existing catalog reference matched"}
                        </strong>
                        <p>
                          {result.classification === "ambiguous"
                            ? "No reference is selected automatically."
                            : result.classification === "existing"
                              ? "This source row will reuse the matched reference."
                              : "This source row is classified as a new wine."}
                        </p>
                        <dl className="import-matching-card__metadata">
                          <div>
                            <dt>Source appellation</dt>
                            <dd>
                              {row.fields.appellation ?? "Empty"}
                            </dd>
                          </div>
                          <div>
                            <dt>Source area</dt>
                            <dd>
                              {row.fields.area ?? "Empty"}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      {result.candidates.length > 0 ? (
                        <ol className="import-match-candidates">
                          {result.candidates.map(
                            (candidate, index) => (
                              <li key={candidate.id}>
                                <strong>
                                  {result.classification === "existing"
                                    ? "Matched catalog reference"
                                    : `Candidate ${index + 1}`}
                                </strong>
                                <dl>
                                  <div>
                                    <dt>Appellation</dt>
                                    <dd>
                                      {candidate.appellation ??
                                        "Empty"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Area</dt>
                                    <dd>
                                      {candidate.area ?? "Empty"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Reference ID</dt>
                                    <dd>{candidate.id}</dd>
                                  </div>
                                </dl>
                              </li>
                            ),
                          )}
                        </ol>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </>
          )}
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
                  : catalogIsLoading
                    ? "Cleaning is complete. The synchronized catalog is being checked; no data has been written."
                    : catalogError
                      ? "Resolve the catalog loading error before matching wines. No data has been written."
                      : matchingSummary.ambiguousRowCount > 0
                        ? "Wine matching found ambiguous rows. They require explicit resolution before import; no data has been written."
                        : "Wine matching is complete. Storage and quantity reconciliation will be added in the next step; no data has been written."}
            </p>
          </div>
          <button disabled type="button">
            Continue to storage matching
          </button>
        </section>
      ) : null}
    </main>
  )
}
