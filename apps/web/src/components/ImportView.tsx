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
  buildCsvImportPreview,
  summarizeCsvImportPreview,
  type CsvImportPreviewRow,
} from "../data/csvImportPreview"
import {
  reconcileCsvStorage,
  summarizeCsvStorageReconciliation,
  type CsvStorageCellar,
  type CsvStorageLocation,
  type CsvStorageReconciliationResult,
} from "../data/csvStorageReconciliation"
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
const STORAGE_ROW_DISPLAY_LIMIT = 100
const IMPORT_PREVIEW_ROW_DISPLAY_LIMIT = 100

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

const STORAGE_CELLARS_QUERY = `
  select id, household_id, name, is_active
  from cellars
  where household_id = ?
  order by name, id
`

const STORAGE_LOCATIONS_QUERY = `
  select
    l.id,
    l.household_id,
    l.cellar_id,
    l.code,
    l.is_active,
    l.capacity,
    coalesce(sum(h.quantity), 0) as bottle_count
  from locations l
  left join holdings h on h.location_id = l.id
  where l.household_id = ?
  group by
    l.id,
    l.household_id,
    l.cellar_id,
    l.code,
    l.is_active,
    l.capacity
  order by l.cellar_id, l.code, l.id
`

interface ImportViewProps {
  householdId: string
}

interface ImportWorkspaceProps extends ImportViewProps {
  catalogError: unknown
  catalogIsLoading: boolean
  catalogWines: WineCatalogEntry[]
  storageCellars: CsvStorageCellar[]
  storageError: unknown
  storageIsLoading: boolean
  storageLocations: CsvStorageLocation[]
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

function storageStatusLabel(
  result: CsvStorageReconciliationResult,
): string {
  if (result.status !== "ready") {
    return "Needs storage"
  }

  return result.issues.some(
    (storageIssue) => storageIssue.severity === "warning",
  )
    ? "Assigned · warning"
    : "Assigned"
}

function importPreviewStatusLabel(
  result: CsvImportPreviewRow,
): string {
  switch (result.status) {
    case "blocked":
      return "Needs resolution"
    case "ready":
      return "Ready"
    case "warning":
      return "Ready · warning"
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

  const {
    data: storageCellars,
    error: storageCellarsError,
    isLoading: storageCellarsAreLoading,
  } = useQuery<CsvStorageCellar>(
    STORAGE_CELLARS_QUERY,
    [householdId],
  )

  const {
    data: storageLocations,
    error: storageLocationsError,
    isLoading: storageLocationsAreLoading,
  } = useQuery<CsvStorageLocation>(
    STORAGE_LOCATIONS_QUERY,
    [householdId],
  )

  return (
    <ImportWorkspace
      catalogError={catalogError}
      catalogIsLoading={catalogIsLoading}
      catalogWines={catalogWines}
      householdId={householdId}
      storageCellars={storageCellars}
      storageError={
        storageCellarsError ?? storageLocationsError
      }
      storageIsLoading={
        storageCellarsAreLoading || storageLocationsAreLoading
      }
      storageLocations={storageLocations}
    />
  )
}

export function ImportWorkspace({
  catalogError,
  catalogIsLoading,
  catalogWines,
  householdId,
  storageCellars,
  storageError,
  storageIsLoading,
  storageLocations,
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

  const storageResults = useMemo(
    () =>
      reconcileCsvStorage(
        cleanedRows,
        storageCellars,
        storageLocations,
        householdId,
      ),
    [
      cleanedRows,
      householdId,
      storageCellars,
      storageLocations,
    ],
  )

  const storageSummary = useMemo(
    () =>
      summarizeCsvStorageReconciliation(storageResults),
    [storageResults],
  )

  const displayedStorageResults = useMemo(() => {
    const unresolvedResults = storageResults.filter(
      (result) => result.status !== "ready",
    )
    const warningResults = storageResults.filter(
      (result) =>
        result.status === "ready" &&
        result.issues.some(
          (storageIssue) =>
            storageIssue.severity === "warning",
        ),
    )
    const readyResults = storageResults.filter(
      (result) =>
        result.status === "ready" &&
        result.issues.every(
          (storageIssue) =>
            storageIssue.severity !== "warning",
        ),
    )

    return [
      ...unresolvedResults,
      ...warningResults,
      ...readyResults,
    ].slice(0, STORAGE_ROW_DISPLAY_LIMIT)
  }, [storageResults])

  const importPreviewRows = useMemo(
    () =>
      buildCsvImportPreview(
        matchingResults,
        storageResults,
      ),
    [matchingResults, storageResults],
  )

  const importPreviewSummary = useMemo(
    () => summarizeCsvImportPreview(importPreviewRows),
    [importPreviewRows],
  )

  const displayedImportPreviewRows = useMemo(() => {
    const statuses: CsvImportPreviewRow["status"][] = [
      "blocked",
      "warning",
      "ready",
    ]

    return statuses
      .flatMap((status) =>
        importPreviewRows.filter(
          (result) => result.status === status,
        ),
      )
      .slice(0, IMPORT_PREVIEW_ROW_DISPLAY_LIMIT)
  }, [importPreviewRows])

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
  const showStorage =
    showMatching && !catalogIsLoading && !catalogError
  const showImportPreview =
    showStorage && !storageIsLoading && !storageError

  return (
    <main className="import-view">
      <div className="import-view__intro">
        <h1>Import CSV</h1>
        <p>
          Upload a CSV, map and normalize its values, then review
          the planned wine, storage, and quantity outcome. Nothing
          is written to your cellar during these preparation steps.
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

      {showStorage ? (
        <section
          aria-busy={storageIsLoading}
          aria-labelledby="storage-heading"
          className="import-storage-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="storage-heading">
                6. Reconcile storage and quantity
              </h2>
              <p>
                Cellar and location names are matched inside the
                active household. Quantities are aggregated by
                location and compared with current occupancy and
                optional configured capacity.
              </p>
            </div>
            <span className="import-section-heading__status">
              {storageIsLoading
                ? "Checking storage"
                : storageError
                  ? "Storage unavailable"
                  : storageSummary.unresolvedRowCount > 0
                    ? `${storageSummary.unresolvedRowCount} ${storageSummary.unresolvedRowCount === 1 ? "row needs" : "rows need"} storage`
                    : `${storageSummary.assignedBottleCount} bottles assigned`}
            </span>
          </div>

          {storageIsLoading ? (
            <Notice role="status">
              Checking synchronized cellars, locations, holdings,
              and capacities…
            </Notice>
          ) : storageError ? (
            <Notice role="alert" tone="error">
              <strong>Unable to check cellar storage</strong>
              <p>{String(storageError)}</p>
            </Notice>
          ) : (
            <>
              <div
                aria-label="Storage reconciliation summary"
                className="import-storage-summary"
              >
                <div>
                  <strong>{storageSummary.totalBottleCount}</strong>
                  <span>Total bottles</span>
                </div>
                <div>
                  <strong>
                    {storageSummary.assignedBottleCount}
                  </strong>
                  <span>Assigned bottles</span>
                </div>
                <div>
                  <strong>{storageSummary.readyRowCount}</strong>
                  <span>Assigned rows</span>
                </div>
                <div>
                  <strong>
                    {storageSummary.unresolvedRowCount}
                  </strong>
                  <span>Unresolved rows</span>
                </div>
              </div>

              <p className="import-storage-display-note">
                Showing {displayedStorageResults.length} of {storageSummary.totalRowCount} rows. Unresolved storage and capacity warnings appear first; source context is unchanged.
              </p>

              {storageSummary.unresolvedRowCount > 0 ? (
                <Notice role="alert" tone="warning">
                  <strong>
                    Assign storage for {storageSummary.unresolvedRowCount} {storageSummary.unresolvedRowCount === 1 ? "row" : "rows"} before import
                  </strong>
                  <p>
                    The importer never invents a cellar, chooses an
                    overflow location, or restores archived storage.
                    Assignment controls will be added in the
                    issue-resolution step.
                  </p>
                </Notice>
              ) : (
                <Notice role="status" tone="success">
                  Every source row has an active cellar and
                  location assignment.
                </Notice>
              )}

              {storageSummary.capacityWarningLocationCount > 0 ? (
                <Notice role="status" tone="warning">
                  <strong>
                    Review {storageSummary.capacityWarningLocationCount} capacity {storageSummary.capacityWarningLocationCount === 1 ? "warning" : "warnings"}
                  </strong>
                  <p>
                    Capacity is an advisory setup value. The
                    projected totals include current bottles plus
                    every matched row in this CSV.
                  </p>
                </Notice>
              ) : null}

              <div className="import-storage-list">
                {displayedStorageResults.map((result) => {
                  const hasWarning = result.issues.some(
                    (storageIssue) =>
                      storageIssue.severity === "warning",
                  )

                  return (
                    <article
                      className={
                        result.status !== "ready"
                          ? "import-storage-card import-storage-card--unresolved"
                          : hasWarning
                            ? "import-storage-card import-storage-card--warning"
                            : "import-storage-card"
                      }
                      key={result.row.recordNumber}
                    >
                      <header>
                        <div>
                          <strong>
                            Source record {result.row.recordNumber}
                          </strong>
                          <span>
                            {sourceLineLabel(
                              result.row.sourceLineStart,
                              result.row.sourceLineEnd,
                            )}
                            <span aria-hidden="true"> · </span>
                            {result.row.fields.producer} — {result.row.fields.cuvee}
                          </span>
                        </div>
                        <span
                          className={
                            result.status !== "ready"
                              ? "import-row-status import-row-status--unresolved"
                              : hasWarning
                                ? "import-row-status import-row-status--warning"
                                : "import-row-status import-row-status--assigned"
                          }
                        >
                          {storageStatusLabel(result)}
                        </span>
                      </header>

                      {result.issues.length > 0 ? (
                        <ul className="import-storage-card__issues">
                          {result.issues.map((storageIssue) => (
                            <li key={storageIssue.code}>
                              <strong>
                                {storageIssue.severity === "warning"
                                  ? "Capacity warning"
                                  : "Storage issue"}
                              </strong>
                              <span>{storageIssue.message}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <dl className="import-storage-card__values">
                        <div>
                          <dt>CSV cellar</dt>
                          <dd>
                            {result.row.fields.cellar ?? "Empty"}
                          </dd>
                        </div>
                        <div>
                          <dt>CSV location</dt>
                          <dd>
                            {result.row.fields.location ?? "Empty"}
                          </dd>
                        </div>
                        <div>
                          <dt>Matched storage</dt>
                          <dd>
                            {result.cellar && result.location
                              ? `${result.cellar.name} / ${result.location.code}`
                              : "Unresolved"}
                          </dd>
                        </div>
                        <div>
                          <dt>Row quantity</dt>
                          <dd>{result.quantity ?? "Invalid"}</dd>
                        </div>
                      </dl>

                      {result.location ? (
                        <dl className="import-storage-card__occupancy">
                          <div>
                            <dt>Current</dt>
                            <dd>{result.currentBottleCount}</dd>
                          </div>
                          <span aria-hidden="true">+</span>
                          <div>
                            <dt>This CSV</dt>
                            <dd>{result.importBottleCount}</dd>
                          </div>
                          <span aria-hidden="true">=</span>
                          <div>
                            <dt>Projected</dt>
                            <dd>{result.projectedBottleCount}</dd>
                          </div>
                          <span aria-hidden="true">/</span>
                          <div>
                            <dt>Capacity</dt>
                            <dd>
                              {result.location.capacity ?? "Not set"}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </section>
      ) : null}

      {showImportPreview ? (
        <section
          aria-labelledby="final-preview-heading"
          className="import-final-preview-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="final-preview-heading">
                7. Preview the import
              </h2>
              <p>
                Review the complete planned outcome for every
                source row: catalog action, destination, and
                bottle quantity. Nothing has been written.
              </p>
            </div>
            <span className="import-section-heading__status">
              {importPreviewSummary.blockedRowCount > 0
                ? `${importPreviewSummary.blockedRowCount} ${importPreviewSummary.blockedRowCount === 1 ? "row needs" : "rows need"} resolution`
                : `${importPreviewSummary.readyBottleCount} bottles ready`}
            </span>
          </div>

          <div
            aria-label="Complete import preview summary"
            className="import-final-preview-summary"
          >
            <div>
              <strong>{importPreviewSummary.totalBottleCount}</strong>
              <span>Total bottles</span>
            </div>
            <div>
              <strong>{importPreviewSummary.readyBottleCount}</strong>
              <span>Ready bottles</span>
            </div>
            <div>
              <strong>{importPreviewSummary.newWineCount}</strong>
              <span>New wines</span>
            </div>
            <div>
              <strong>{importPreviewSummary.existingWineCount}</strong>
              <span>Existing wines</span>
            </div>
            <div>
              <strong>{importPreviewSummary.destinationCount}</strong>
              <span>Destinations</span>
            </div>
            <div>
              <strong>{importPreviewSummary.blockedRowCount}</strong>
              <span>Blocked rows</span>
            </div>
          </div>

          <p className="import-final-preview-display-note">
            Showing {displayedImportPreviewRows.length} of {importPreviewSummary.totalRowCount} rows. Blocked rows and advisory warnings appear first; repeated wine identities and destinations are counted once above.
          </p>

          {importPreviewSummary.blockedRowCount > 0 ? (
            <Notice role="alert" tone="warning">
              <strong>
                Resolve {importPreviewSummary.blockedRowCount} {importPreviewSummary.blockedRowCount === 1 ? "row" : "rows"} before import
              </strong>
              <p>
                This first preview is intentionally blocked when
                a wine or destination is unresolved. Resolution
                controls arrive in the next roadmap step.
              </p>
            </Notice>
          ) : (
            <Notice role="status" tone="success">
              <strong>The complete import plan is resolved</strong>
              <p>
                Review every row below. The issue-resolution and
                commit steps are still disabled, and no data has
                been written.
              </p>
            </Notice>
          )}

          {importPreviewSummary.warningLocationCount > 0 ? (
            <Notice role="status" tone="warning">
              {importPreviewSummary.warningLocationCount} destination {importPreviewSummary.warningLocationCount === 1 ? "has" : "have"} an advisory capacity warning. These rows remain ready for later confirmation.
            </Notice>
          ) : null}

          <div className="import-final-preview-list">
            {displayedImportPreviewRows.map((result) => {
              const { row } = result
              const storage = result.storage

              return (
                <article
                  className={`import-final-preview-card import-final-preview-card--${result.status}`}
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
                      className={`import-row-status import-row-status--preview-${result.status}`}
                    >
                      {importPreviewStatusLabel(result)}
                    </span>
                  </header>

                  {result.issues.length > 0 ? (
                    <ul className="import-final-preview-card__issues">
                      {result.issues.map((previewIssue) => (
                        <li key={`${previewIssue.category}:${previewIssue.code}`}>
                          <strong>
                            {previewIssue.severity === "warning"
                              ? "Advisory warning"
                              : previewIssue.category === "wine"
                                ? "Wine decision needed"
                                : previewIssue.category === "storage"
                                  ? "Storage decision needed"
                                  : "Preview incomplete"}
                          </strong>
                          <span>{previewIssue.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="import-final-preview-card__plan">
                    <section>
                      <span>Wine</span>
                      <strong>
                        {row.fields.producer} — {row.fields.cuvee}
                      </strong>
                      <p>
                        {row.fields.vintage ?? "NV"} · {row.fields.color} · {formatWineVolume(row.fields.formatMl ?? 0)}
                      </p>
                      <span
                        className={`import-plan-action import-plan-action--${result.wineAction}`}
                      >
                        {result.wineAction === "reuse"
                          ? "Reuse existing catalog wine"
                          : result.wineAction === "create"
                            ? "Create new catalog wine"
                            : "Wine unresolved"}
                      </span>
                      {result.existingWine ? (
                        <small>
                          Reference {result.existingWine.id}
                        </small>
                      ) : null}
                    </section>

                    <span aria-hidden="true">→</span>

                    <section>
                      <span>Destination</span>
                      <strong>
                        {storage?.cellar && storage.location
                          ? `${storage.cellar.name} / ${storage.location.code}`
                          : "Unresolved storage"}
                      </strong>
                      <p>
                        {storage?.location
                          ? `Current ${storage.currentBottleCount} + CSV ${storage.importBottleCount} = projected ${storage.projectedBottleCount}`
                          : `CSV values: ${row.fields.cellar ?? "Empty"} / ${row.fields.location ?? "Empty"}`}
                      </p>
                      <small>
                        Capacity {storage?.location?.capacity ?? "not set"}
                      </small>
                    </section>

                    <span aria-hidden="true">→</span>

                    <section>
                      <span>Quantity</span>
                      <strong>
                        {row.fields.quantity ?? "Invalid"} {row.fields.quantity === 1 ? "bottle" : "bottles"}
                      </strong>
                      <p>
                        Planned inventory addition after explicit
                        resolution and final confirmation.
                      </p>
                    </section>
                  </div>

                  {row.sourceRow.unmapped.length > 0 ? (
                    <details>
                      <summary>
                        Preserved unmapped values ({row.sourceRow.unmapped.length})
                      </summary>
                      <dl className="import-final-preview-card__unmapped">
                        {row.sourceRow.unmapped.map(
                          (sourceValue) => (
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
                          ),
                        )}
                      </dl>
                    </details>
                  ) : null}
                </article>
              )
            })}
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
                  : catalogIsLoading
                    ? "Cleaning is complete. The synchronized catalog is being checked; no data has been written."
                  : catalogError
                    ? "Resolve the catalog loading error before matching wines. No data has been written."
                    : storageIsLoading
                      ? "Wine matching is complete. Synchronized storage is being checked; no data has been written."
                      : storageError
                        ? "Resolve the storage loading error before continuing. No data has been written."
                        : importPreviewSummary.blockedRowCount > 0
                          ? `The complete preview is available, but ${importPreviewSummary.blockedRowCount} ${importPreviewSummary.blockedRowCount === 1 ? "row requires" : "rows require"} the next issue-resolution step; no data has been written.`
                          : importPreviewSummary.warningLocationCount > 0
                            ? "The complete import preview is resolved. Review the advisory capacity warnings; no data has been written."
                            : "The complete import preview is resolved and ready for the issue-resolution checkpoint; no data has been written."}
            </p>
          </div>
          <button disabled type="button">
            Continue to issue resolution
          </button>
        </section>
      ) : null}
    </main>
  )
}
