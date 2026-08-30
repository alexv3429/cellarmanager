import { useQuery } from "@powersync/react"
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { createInitialImportDestination } from "../data/cellarSetup"

import {
  CSV_IMPORT_FIELD_DEFINITIONS,
  mapCsvSourceRow,
  suggestCsvColumnMapping,
  validateCsvColumnMapping,
  type CsvColumnMapping,
  type CsvImportField,
  type CsvImportFieldDefaults,
} from "../data/csvColumnMapping"
import {
  cleanCsvMappedRow,
  summarizeCsvCleaning,
  type CsvCuveeFallback,
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
  clearPendingCsvImportPlan,
  commitCsvImport,
  createCsvImportCommitPlan,
  getCsvImportReceipt,
  getCsvImportCommitSourceKey,
  readPendingCsvImportPlan,
  savePendingCsvImportPlan,
  type CsvImportCommitPlan,
  type CsvImportCommitResult,
} from "../data/csvImportCommit"
import {
  getCsvImportStorageOptions,
  resolveCsvImportIssues,
  type CsvImportResolutionSelections,
} from "../data/csvImportResolution"
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
import { inspectCellarManagerCsvVersion } from "../data/csvExport"
import { CsvExportPanel } from "./CsvExportPanel"
import { Notice } from "./Notice"

const FILE_SIZE_LIMIT_BYTES = 20_000_000
const SAMPLE_ROW_COUNT = 3
const CLEANING_ROW_DISPLAY_LIMIT = 100
const MATCHING_ROW_DISPLAY_LIMIT = 100
const STORAGE_ROW_DISPLAY_LIMIT = 100
const IMPORT_PREVIEW_ROW_DISPLAY_LIMIT = 100
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function isXlsxFile(file: File): boolean {
  return (
    file.type === XLSX_MIME_TYPE ||
    file.name.toLocaleLowerCase().endsWith(".xlsx")
  )
}

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
    and merged_into_wine_id is null
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
  deviceId: string | null
  householdId: string
  isOnline: boolean
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

function CompactImportPreviewCard({
  result,
}: {
  result: CsvImportPreviewRow
}) {
  const { row, storage } = result

  return (
    <article
      className={`import-final-preview-card import-final-preview-card--${result.status}`}
    >
      <header>
        <div>
          <strong>
            {row.fields.producer} — {row.fields.cuvee}
          </strong>
          <span>
            Source record {row.recordNumber}
            <span aria-hidden="true"> · </span>
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
            <li
              key={`${previewIssue.category}:${previewIssue.code}`}
            >
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
            {row.fields.vintage ?? "NV"} · {row.fields.color} · {formatWineVolume(row.fields.formatMl ?? 0)}
          </strong>
          <span
            className={`import-plan-action import-plan-action--${result.wineAction}`}
          >
            {result.wineAction === "reuse"
              ? "Reuse catalog wine"
              : result.wineAction === "create"
                ? "Create catalog wine"
                : "Unresolved"}
          </span>
        </section>

        <span aria-hidden="true">→</span>

        <section>
          <span>Destination</span>
          <strong>
            {storage?.cellar && storage.location
              ? `${storage.cellar.name} / ${storage.location.code}`
              : "Unresolved"}
          </strong>
        </section>

        <span aria-hidden="true">→</span>

        <section>
          <span>Quantity</span>
          <strong>
            {row.fields.quantity ?? "Invalid"} {row.fields.quantity === 1 ? "bottle" : "bottles"}
          </strong>
        </section>
      </div>

      <details>
        <summary>Details and source values</summary>
        <dl className="import-final-preview-card__details">
          <div>
            <dt>Catalog reference</dt>
            <dd>{result.existingWine?.id ?? "New or unresolved"}</dd>
          </div>
          <div>
            <dt>Source storage</dt>
            <dd>
              {row.fields.cellar ?? "Empty"} / {row.fields.location ?? "Empty"}
            </dd>
          </div>
          <div>
            <dt>Projected occupancy</dt>
            <dd>
              {storage?.location
                ? `${storage.currentBottleCount} + ${storage.importBottleCount} = ${storage.projectedBottleCount}`
                : "Unresolved"}
            </dd>
          </div>
          <div>
            <dt>Capacity</dt>
            <dd>{storage?.location?.capacity ?? "Not set"}</dd>
          </div>
        </dl>

        {row.sourceRow.unmapped.length > 0 ? (
          <dl className="import-final-preview-card__unmapped">
            {row.sourceRow.unmapped.map((sourceValue) => (
              <div key={sourceValue.sourceColumnIndex}>
                <dt>
                  {sourceValue.sourceHeader ||
                    `Column ${sourceValue.sourceColumnIndex + 1}`}
                </dt>
                <dd>{sourceValue.value || "Empty"}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </details>
    </article>
  )
}

export function ImportView({
  deviceId,
  householdId,
  isOnline,
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
      deviceId={deviceId}
      householdId={householdId}
      isOnline={isOnline}
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
  deviceId,
  householdId,
  isOnline,
  storageCellars,
  storageError,
  storageIsLoading,
  storageLocations,
}: ImportWorkspaceProps) {
  const [dataMode, setDataMode] = useState<
    "export" | "import"
  >("import")
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
  const [fieldDefaults, setFieldDefaults] =
    useState<CsvImportFieldDefaults>({})
  const [defaultField, setDefaultField] = useState<
    CsvImportField | ""
  >("")
  const [defaultValue, setDefaultValue] = useState("")
  const [cuveeFallbackMode, setCuveeFallbackMode] =
    useState<CsvCuveeFallback["mode"]>("none")
  const [cuveeFallbackValue, setCuveeFallbackValue] =
    useState("")
  const [fileError, setFileError] = useState<
    string | null
  >(null)
  const [preparationExpanded, setPreparationExpanded] =
    useState(false)
  const [resolutionSelections, setResolutionSelections] =
    useState<CsvImportResolutionSelections>({
      locationIdByRecord: {},
      wineIdByRecord: {},
    })
  const [confirmationIsOpen, setConfirmationIsOpen] =
    useState(false)
  const [confirmationAccepted, setConfirmationAccepted] =
    useState(false)
  const [commitPlan, setCommitPlan] = useState<
    CsvImportCommitPlan | null
  >(() =>
    readPendingCsvImportPlan(
      window.localStorage,
      householdId,
    ),
  )
  const [commitResult, setCommitResult] =
    useState<CsvImportCommitResult | null>(null)
  const [commitError, setCommitError] = useState<
    string | null
  >(null)
  const [commitAttempted, setCommitAttempted] =
    useState(
      () =>
        readPendingCsvImportPlan(
          window.localStorage,
          householdId,
        ) !== null,
    )
  const [isCommitting, setIsCommitting] = useState(false)
  const [destinationIsCreating, setDestinationIsCreating] =
    useState(false)
  const [destinationCreationError, setDestinationCreationError] =
    useState<string | null>(null)
  const [destinationCreationMessage, setDestinationCreationMessage] =
    useState<string | null>(null)
  const recoveredCommitChecked = useRef(false)

  useEffect(() => {
    if (
      !commitPlan ||
      !commitAttempted ||
      recoveredCommitChecked.current ||
      !isOnline
    ) {
      return
    }

    let active = true
    recoveredCommitChecked.current = true
    setIsCommitting(true)
    setCommitError("Checking the previous import receipt…")

    void getCsvImportReceipt({
      householdId,
      importId: commitPlan.importId,
    })
      .then((receipt) => {
        if (!active) {
          return
        }

        clearPendingCsvImportPlan(
          window.localStorage,
          householdId,
        )

        if (receipt) {
          setCommitResult(receipt)
          setCommitError(null)
          return
        }

        setCommitPlan(null)
        setCommitAttempted(false)
        setCommitError(
          "The previous import did not commit. Nothing was added, so you can upload and review it again.",
        )
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }

        setCommitError(
          `${error instanceof Error ? error.message : "The previous receipt could not be checked."} Keep this page open and retry the same import after reconnecting.`,
        )
      })
      .finally(() => {
        if (active) {
          setIsCommitting(false)
        }
      })

    return () => {
      active = false
    }
  }, [commitAttempted, commitPlan, householdId, isOnline])

  const mappingIssues = useMemo(
    () =>
      validateCsvColumnMapping(mapping, fieldDefaults),
    [fieldDefaults, mapping],
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
          fieldDefaults,
        ),
      )
  }, [document, fieldDefaults, mapping])

  const cleanedRows = useMemo(() => {
    if (!document?.header) {
      return []
    }

    const cuveeFallback: CsvCuveeFallback =
      cuveeFallbackMode === "fixed"
        ? {
            mode: "fixed",
            value: cuveeFallbackValue,
          }
        : { mode: cuveeFallbackMode }

    return document.rows.map((row) =>
      cleanCsvMappedRow(
        mapCsvSourceRow(
          document.header?.values ?? [],
          row,
          mapping,
          fieldDefaults,
        ),
        { cuveeFallback },
      ),
    )
  }, [
    cuveeFallbackMode,
    cuveeFallbackValue,
    document,
    fieldDefaults,
    mapping,
  ])

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

  const initialImportPreviewRows = useMemo(
    () =>
      buildCsvImportPreview(
        matchingResults,
        storageResults,
      ),
    [matchingResults, storageResults],
  )

  const initialImportPreviewSummary = useMemo(
    () =>
      summarizeCsvImportPreview(initialImportPreviewRows),
    [initialImportPreviewRows],
  )

  const resolvedImport = useMemo(
    () =>
      resolveCsvImportIssues({
        cellars: storageCellars,
        householdId,
        locations: storageLocations,
        rows: cleanedRows,
        selections: resolutionSelections,
        wineMatches: matchingResults,
      }),
    [
      cleanedRows,
      householdId,
      matchingResults,
      resolutionSelections,
      storageCellars,
      storageLocations,
    ],
  )

  const resolvedImportPreviewRows = useMemo(
    () =>
      buildCsvImportPreview(
        resolvedImport.wineMatches,
        resolvedImport.storageResults,
      ),
    [resolvedImport],
  )

  const resolvedImportPreviewSummary = useMemo(
    () =>
      summarizeCsvImportPreview(resolvedImportPreviewRows),
    [resolvedImportPreviewRows],
  )

  const displayedInitialPreviewRows = useMemo(() => {
    const statuses: CsvImportPreviewRow["status"][] = [
      "blocked",
      "warning",
      "ready",
    ]

    return statuses
      .flatMap((status) =>
        initialImportPreviewRows.filter(
          (result) => result.status === status,
        ),
      )
      .slice(0, IMPORT_PREVIEW_ROW_DISPLAY_LIMIT)
  }, [initialImportPreviewRows])

  const displayedResolvedPreviewRows = useMemo(() => {
    const statuses: CsvImportPreviewRow["status"][] = [
      "blocked",
      "warning",
      "ready",
    ]

    return statuses
      .flatMap((status) =>
        resolvedImportPreviewRows.filter(
          (result) => result.status === status,
        ),
      )
      .slice(0, IMPORT_PREVIEW_ROW_DISPLAY_LIMIT)
  }, [resolvedImportPreviewRows])

  const storageOptions = useMemo(
    () =>
      getCsvImportStorageOptions(
        storageCellars,
        storageLocations,
        householdId,
      ),
    [householdId, storageCellars, storageLocations],
  )

  const resolvedImportSourceKey = useMemo(
    () =>
      getCsvImportCommitSourceKey(
        resolvedImportPreviewRows,
      ),
    [resolvedImportPreviewRows],
  )

  const rowsNeedingResolution = useMemo(
    () =>
      initialImportPreviewRows.filter(
        (result) => result.status === "blocked",
      ),
    [initialImportPreviewRows],
  )
  const rowsNeedingStorage = useMemo(
    () =>
      resolvedImportPreviewRows.filter(
        (result) => result.storage?.status !== "ready",
      ),
    [resolvedImportPreviewRows],
  )
  const suggestedDestinationCellar = useMemo(() => {
    const names = new Set(
      cleanedRows.flatMap((row) =>
        row.fields.cellar ? [row.fields.cellar] : [],
      ),
    )

    return names.size === 1 ? [...names][0] : ""
  }, [cleanedRows])
  const suggestedDestinationLocation = useMemo(() => {
    const codes = new Set(
      cleanedRows.flatMap((row) =>
        row.fields.location ? [row.fields.location] : [],
      ),
    )

    return codes.size === 1 ? [...codes][0] : "Unsorted"
  }, [cleanedRows])

  function applyDocument(
    nextDocument: CsvIngestionDocument,
  ) {
    if (commitAttempted || isCommitting) {
      return
    }

    const versionInspection =
      inspectCellarManagerCsvVersion(nextDocument)

    if (versionInspection.issue) {
      setDocument(null)
      setMapping([])
      setFileError(versionInspection.issue)
      return
    }

    const nextMapping = nextDocument.header
      ? suggestCsvColumnMapping(
          nextDocument.header.values,
        )
      : []
    const firstMissingRequiredField =
      CSV_IMPORT_FIELD_DEFINITIONS.find(
        (definition) =>
          definition.required &&
          !nextMapping.includes(definition.field),
      )?.field ?? ""

    setFileError(null)
    setDocument(nextDocument)
    setMapping(nextMapping)
    setFieldDefaults({})
    setDefaultField(firstMissingRequiredField)
    setDefaultValue("")
    setCuveeFallbackMode("none")
    setCuveeFallbackValue("")
    setDestinationCreationError(null)
    setDestinationCreationMessage(null)
    setPreparationExpanded(false)
    setResolutionSelections({
      locationIdByRecord: {},
      wineIdByRecord: {},
    })
    resetCommitState()
  }

  async function selectFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    if (commitAttempted || isCommitting) {
      event.target.value = ""
      return
    }

    const file = event.target.files?.[0]
    const selectionId = latestFileSelection.current + 1
    latestFileSelection.current = selectionId

    setFileError(null)
    setSourceText(null)
    setDocument(null)
    setMapping([])
    setFieldDefaults({})
    setDefaultField("")
    setDefaultValue("")
    setCuveeFallbackMode("none")
    setCuveeFallbackValue("")
    setDestinationCreationError(null)
    setDestinationCreationMessage(null)
    setFileName(file?.name ?? null)

    if (!file) {
      return
    }

    if (file.size > FILE_SIZE_LIMIT_BYTES) {
      setFileError(
        "Choose a spreadsheet file smaller than 20 MB.",
      )
      return
    }

    const fileIsXlsx = isXlsxFile(file)

    try {
      const bytes = await file.arrayBuffer()

      if (latestFileSelection.current !== selectionId) {
        return
      }

      if (fileIsXlsx) {
        const { parseXlsxWorkbook } = await import(
          "../data/xlsxTransfer"
        )
        const nextDocument = await parseXlsxWorkbook(bytes)

        if (latestFileSelection.current !== selectionId) {
          return
        }

        setSourceText(null)
        applyDocument(nextDocument)
        return
      }

      const text = new TextDecoder("utf-8", {
        fatal: true,
      }).decode(bytes)
      setSourceText(text)
      applyDocument(parseCsvText(text))
    } catch (caughtError: unknown) {
      if (latestFileSelection.current !== selectionId) {
        return
      }

      setFileError(
        fileIsXlsx && caughtError instanceof Error
          ? caughtError.message
          : "Unable to read this file as UTF-8 CSV.",
      )
    }
  }

  function selectDelimiter(delimiter: CsvDelimiter) {
    if (
      sourceText === null ||
      commitAttempted ||
      isCommitting
    ) {
      return
    }

    applyDocument(parseCsvText(sourceText, { delimiter }))
  }

  function mapColumn(
    sourceColumnIndex: number,
    value: string,
  ) {
    if (commitAttempted || isCommitting) {
      return
    }

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

    if (field) {
      setFieldDefaults((currentDefaults) => {
        const nextDefaults = { ...currentDefaults }
        delete nextDefaults[field]
        return nextDefaults
      })

      if (defaultField === field) {
        setDefaultField("")
        setDefaultValue("")
      }
    }

    setResolutionSelections({
      locationIdByRecord: {},
      wineIdByRecord: {},
    })
    resetCommitState()
  }

  function resetImportDecisions() {
    setResolutionSelections({
      locationIdByRecord: {},
      wineIdByRecord: {},
    })
    resetCommitState()
  }

  function addFieldDefault() {
    if (
      !defaultField ||
      !defaultValue.trim() ||
      mapping.includes(defaultField) ||
      commitAttempted ||
      isCommitting
    ) {
      return
    }

    setFieldDefaults((currentDefaults) => ({
      ...currentDefaults,
      [defaultField]: defaultValue,
    }))
    setDefaultField("")
    setDefaultValue("")
    resetImportDecisions()
  }

  function updateFieldDefault(
    field: CsvImportField,
    value: string,
  ) {
    if (commitAttempted || isCommitting) {
      return
    }

    setFieldDefaults((currentDefaults) => ({
      ...currentDefaults,
      [field]: value,
    }))
    resetImportDecisions()
  }

  function removeFieldDefault(field: CsvImportField) {
    if (commitAttempted || isCommitting) {
      return
    }

    setFieldDefaults((currentDefaults) => {
      const nextDefaults = { ...currentDefaults }
      delete nextDefaults[field]
      return nextDefaults
    })
    resetImportDecisions()
  }

  function updateCuveeFallbackMode(
    mode: CsvCuveeFallback["mode"],
  ) {
    if (commitAttempted || isCommitting) {
      return
    }

    setCuveeFallbackMode(mode)
    if (mode !== "fixed") {
      setCuveeFallbackValue("")
    }
    resetImportDecisions()
  }

  function updateCuveeFallbackValue(value: string) {
    if (commitAttempted || isCommitting) {
      return
    }

    setCuveeFallbackValue(value)
    resetImportDecisions()
  }

  async function createDestinationForImport(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (
      destinationIsCreating ||
      importIsLocked ||
      rowsNeedingStorage.length === 0
    ) {
      return
    }

    if (!isOnline) {
      setDestinationCreationError(
        "Reconnect before creating cellar setup.",
      )
      return
    }

    const form = new FormData(event.currentTarget)
    const cellarName = String(form.get("cellarName") ?? "")
    const locationCode = String(
      form.get("locationCode") ?? "",
    )
    const capacity = String(form.get("capacity") ?? "")
    const recordNumbers = rowsNeedingStorage.map(
      (result) => result.row.recordNumber,
    )

    setDestinationIsCreating(true)
    setDestinationCreationError(null)
    setDestinationCreationMessage(null)

    try {
      const { locationId } =
        await createInitialImportDestination(
          householdId,
          cellarName,
          locationCode,
          capacity,
        )

      setResolutionSelections((current) => {
        const locationIdByRecord = {
          ...current.locationIdByRecord,
        }

        for (const recordNumber of recordNumbers) {
          locationIdByRecord[recordNumber] = locationId
        }

        return {
          ...current,
          locationIdByRecord,
        }
      })
      resetCommitState()
      setDestinationCreationMessage(
        `Created ${cellarName.trim()} / ${locationCode.trim()} and selected it for ${recordNumbers.length} ${recordNumbers.length === 1 ? "row" : "rows"}. Waiting for synchronization; no bottles have been imported yet.`,
      )
    } catch (error: unknown) {
      setDestinationCreationError(
        error instanceof Error
          ? error.message
          : "Unable to create the import destination",
      )
    } finally {
      setDestinationIsCreating(false)
    }
  }

  function resetCommitState() {
    setConfirmationIsOpen(false)
    setConfirmationAccepted(false)
    setCommitPlan(null)
    setCommitResult(null)
    setCommitError(null)
    setCommitAttempted(false)
    setIsCommitting(false)
  }

  function resetImport() {
    if ((commitAttempted || isCommitting) && !commitResult) {
      return
    }

    latestFileSelection.current += 1
    setFileInputKey((currentKey) => currentKey + 1)
    setFileName(null)
    setSourceText(null)
    setDocument(null)
    setMapping([])
    setFieldDefaults({})
    setDefaultField("")
    setDefaultValue("")
    setCuveeFallbackMode("none")
    setCuveeFallbackValue("")
    setDestinationCreationError(null)
    setDestinationCreationMessage(null)
    setFileError(null)
    setPreparationExpanded(false)
    setResolutionSelections({
      locationIdByRecord: {},
      wineIdByRecord: {},
    })
    resetCommitState()
  }

  function openImportConfirmation() {
    setCommitError(null)

    if (commitPlan && commitAttempted) {
      setConfirmationAccepted(false)
      setConfirmationIsOpen(true)
      return
    }

    if (importConfirmationBlocker) {
      setCommitError(importConfirmationBlocker.message)
      return
    }

    if (!deviceId) {
      setCommitError(
        "Wait for this device to finish registering before import.",
      )
      return
    }

    try {
      setCommitPlan(
        createCsvImportCommitPlan({
          deviceId,
          householdId,
          previewRows: resolvedImportPreviewRows,
        }),
      )
      setConfirmationAccepted(false)
      setConfirmationIsOpen(true)
    } catch (error: unknown) {
      setCommitError(
        error instanceof Error
          ? error.message
          : "Unable to prepare the import confirmation",
      )
    }
  }

  async function confirmImport() {
    if (
      !commitPlan ||
      (!confirmationAccepted && !commitAttempted) ||
      isCommitting
    ) {
      return
    }

    if (!isOnline) {
      setCommitError(
        "The connection was lost. Reconnect, then retry the same import.",
      )
      return
    }

    if (
      !commitAttempted &&
      commitPlan.sourceKey !== resolvedImportSourceKey
    ) {
      setCommitPlan(null)
      setConfirmationAccepted(false)
      setConfirmationIsOpen(false)
      setCommitError(
        "The catalog or cellar changed after confirmation opened. Review the updated preview and confirm again.",
      )
      return
    }

    if (!commitAttempted) {
      try {
        savePendingCsvImportPlan(
          window.localStorage,
          commitPlan,
        )
      } catch {
        setCommitError(
          "Unable to save the retry receipt on this device. The import was not started.",
        )
        return
      }
    }

    recoveredCommitChecked.current = true
    setCommitAttempted(true)
    setIsCommitting(true)
    setCommitError(null)

    try {
      const result = await commitCsvImport(commitPlan)
      clearPendingCsvImportPlan(
        window.localStorage,
        householdId,
      )
      setCommitResult(result)
      setConfirmationIsOpen(false)
    } catch (error: unknown) {
      const commitErrorMessage =
        error instanceof Error
          ? error.message
          : "Unable to commit the spreadsheet import"

      try {
        const receipt = await getCsvImportReceipt({
          householdId,
          importId: commitPlan.importId,
        })

        if (receipt) {
          clearPendingCsvImportPlan(
            window.localStorage,
            householdId,
          )
          setCommitResult(receipt)
          setConfirmationIsOpen(false)
        } else {
          clearPendingCsvImportPlan(
            window.localStorage,
            householdId,
          )
          setCommitAttempted(false)
          setCommitPlan(null)
          setConfirmationAccepted(false)
          setConfirmationIsOpen(false)
          setCommitError(
            `${commitErrorMessage} Nothing was imported. Review the current preview before trying again.`,
          )
        }
      } catch (receiptError: unknown) {
        setCommitError(
          `${commitErrorMessage} ${receiptError instanceof Error ? receiptError.message : "The receipt could not be verified."} Keep this page open and retry the same import after reconnecting.`,
        )
      }
    } finally {
      setIsCommitting(false)
    }
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
  const resolutionIsComplete =
    showImportPreview &&
    resolvedImportPreviewSummary.blockedRowCount === 0
  const preparationIsCollapsed =
    showImportPreview && !preparationExpanded
  const importIsLocked = isCommitting || commitAttempted
  const hasRecoveredPendingImport =
    commitAttempted && commitPlan !== null && !document?.header
  const defaultDefinitions =
    CSV_IMPORT_FIELD_DEFINITIONS.filter(
      (definition) =>
        fieldDefaults[definition.field] !== undefined,
    )
  const availableDefaultDefinitions =
    CSV_IMPORT_FIELD_DEFINITIONS.filter(
      (definition) =>
        !mapping.includes(definition.field) &&
        fieldDefaults[definition.field] === undefined,
    )
  const hasMissingRequiredDefault =
    availableDefaultDefinitions.some(
      (definition) => definition.required,
    )
  const defaultAddControls =
    availableDefaultDefinitions.length > 0 ? (
      <div className="import-mapping-default-add">
        <label>
          <span>CellarManager field</span>
          <select
            disabled={importIsLocked}
            onChange={(event) =>
              setDefaultField(
                event.target.value as CsvImportField | "",
              )
            }
            value={defaultField}
          >
            <option value="">Choose a field</option>
            {availableDefaultDefinitions.map((definition) => (
              <option
                key={definition.field}
                value={definition.field}
              >
                {definition.label}
                {definition.required ? " (required)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Value applied to every row</span>
          <input
            disabled={importIsLocked}
            onChange={(event) =>
              setDefaultValue(event.target.value)
            }
            placeholder={
              defaultField === "formatMl" ? "750 ml" : undefined
            }
            value={defaultValue}
          />
        </label>
        <button
          disabled={
            importIsLocked ||
            !defaultField ||
            !defaultValue.trim()
          }
          onClick={addFieldDefault}
          type="button"
        >
          Apply to every row
        </button>
      </div>
    ) : null
  const importConfirmationBlocker = !mappingIsReady
    ? {
        buttonLabel: "Complete column mapping first",
        message:
          "Resolve every file-structure and required mapping issue before cleaning.",
      }
    : cleaningSummary.issueCount > 0
      ? {
          buttonLabel: `Resolve ${cleaningSummary.issueCount} cleaning ${cleaningSummary.issueCount === 1 ? "issue" : "issues"} first`,
          message:
            "Resolve every cleaning issue before matching wines. No bottles have been imported.",
        }
      : catalogIsLoading
        ? {
            buttonLabel: "Waiting for the catalog",
            message:
              "Cleaning is complete. The synchronized catalog is being checked; no bottles have been imported.",
          }
        : catalogError
          ? {
              buttonLabel: "Resolve the catalog error first",
              message:
                "Resolve the catalog loading error before matching wines. No bottles have been imported.",
            }
          : storageIsLoading
            ? {
                buttonLabel: "Waiting for cellar storage",
                message:
                  "Wine matching is complete. Synchronized storage is being checked; no bottles have been imported.",
              }
            : storageError
              ? {
                  buttonLabel: "Resolve the storage error first",
                  message:
                    "Resolve the storage loading error before continuing. No bottles have been imported.",
                }
              : !resolutionIsComplete
                ? {
                    buttonLabel: `Resolve ${resolvedImportPreviewSummary.blockedRowCount} blocked ${resolvedImportPreviewSummary.blockedRowCount === 1 ? "row" : "rows"} first`,
                    message: `Resolve ${resolvedImportPreviewSummary.blockedRowCount} ${resolvedImportPreviewSummary.blockedRowCount === 1 ? "row" : "rows"} before import. No bottles have been imported.`,
                  }
                : !isOnline
                  ? {
                      buttonLabel: "Reconnect to continue",
                      message:
                        "Reconnect to import. Spreadsheet import requires an online transaction; no bottles have been imported.",
                    }
                  : !deviceId
                    ? {
                        buttonLabel:
                          "Waiting for device registration",
                        message:
                          "Waiting for this device to finish registering; no bottles have been imported.",
                      }
                    : null

  return (
    <main className="import-view">
      <div className="import-view__intro">
        <h1>Cellar data</h1>
        <p>
          Import bottles from a spreadsheet or download a portable copy
          of this cellar.
        </p>
      </div>

      <div
        aria-label="Cellar data action"
        className="import-view__mode-switch"
        role="group"
      >
        <button
          aria-pressed={dataMode === "import"}
          onClick={() => setDataMode("import")}
          type="button"
        >
          Import file
        </button>
        <button
          aria-pressed={dataMode === "export"}
          onClick={() => setDataMode("export")}
          type="button"
        >
          Export cellar
        </button>
      </div>

      {dataMode === "export" ? (
        <CsvExportPanel
          householdId={householdId}
          isOnline={isOnline}
        />
      ) : (
        <>

      <div className="import-view__intro import-view__intro--workflow">
        <h2>Import bottles</h2>
        <p>
          Mapping and preparation do not change the cellar.
          Creating a destination in stage 8 is the only explicit
          setup write before final confirmation.
        </p>
      </div>

      {hasRecoveredPendingImport ? (
        <section className="import-result-panel">
          <div>
            <h2>Previous import awaiting verification</h2>
            <p>
              This device retained the exact receipt and row IDs
              from an interrupted import. Do not upload the file
              again until this receipt is resolved.
            </p>
          </div>

          <dl className="import-complete-panel__receipt">
            <div>
              <dt>Import receipt</dt>
              <dd>{commitPlan.importId}</dd>
            </div>
            <div>
              <dt>Pending plan</dt>
              <dd>
                {commitPlan.rows.reduce(
                  (total, row) => total + row.quantity,
                  0,
                )} bottles · {commitPlan.rows.length} source {commitPlan.rows.length === 1 ? "row" : "rows"}
              </dd>
            </div>
          </dl>

          {commitError ? (
            <Notice role="alert" tone="warning">
              {commitError}
            </Notice>
          ) : (
            <Notice role="status">
              Checking whether the import committed…
            </Notice>
          )}

          <button
            disabled={!isOnline || isCommitting}
            onClick={() => void confirmImport()}
            type="button"
          >
            {isCommitting
              ? "Checking receipt…"
              : "Retry the same import"}
          </button>
        </section>
      ) : null}

      {hasRecoveredPendingImport ? null : preparationIsCollapsed ? (
        <section className="import-preparation-summary-panel">
          <div>
            <h2>Preparation complete</h2>
            <p>
              {fileName} · {cleaningSummary.totalRowCount} {cleaningSummary.totalRowCount === 1 ? "row" : "rows"} · {matchingSummary.existingRowCount} existing · {matchingSummary.newRowCount} new · {storageSummary.readyRowCount} assigned
            </p>
          </div>
          <button
            disabled={importIsLocked}
            onClick={() => setPreparationExpanded(true)}
            type="button"
          >
            Review or edit stages 1–6
          </button>
        </section>
      ) : (
        <>
      <section
        aria-labelledby="import-file-heading"
        className="import-file-panel"
      >
        <div>
          <h2 id="import-file-heading">1. Choose a file</h2>
          <p>
            Excel (.xlsx) or UTF-8 CSV up to 20 MB. CSV files may use
            comma, semicolon, or tab delimiters.
          </p>
        </div>

        {!fileName ? (
          <div className="import-file-picker">
            <span>Spreadsheet file</span>
            <input
              accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values"
              aria-label="Spreadsheet file"
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
              Choose file
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
          <strong>File structure needs attention</strong>
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
              {defaultDefinitions.length > 0
                ? ` · ${defaultDefinitions.length} shared ${defaultDefinitions.length === 1 ? "value" : "values"}`
                : ""}
            </span>
          </div>

          <section
            aria-labelledby="mapping-defaults-heading"
            className="import-mapping-defaults"
          >
            <div>
              <h3 id="mapping-defaults-heading">
                Values missing from the source file
              </h3>
              <p>
                When every imported row has the same missing value,
                enter it once instead of editing every row. For
                example, Bottle format can be 750 ml for the whole
                file.
              </p>
            </div>

            {defaultDefinitions.length > 0 ? (
              <div className="import-mapping-default-applied">
                <div>
                  <strong>
                    Applied to all {document.rows.length}{" "}
                    {document.rows.length === 1 ? "row" : "rows"}
                  </strong>
                  <span>
                    These values will be used wherever the source file has
                    no mapped column.
                  </span>
                </div>
                <div className="import-mapping-default-list">
                  {defaultDefinitions.map((definition) => (
                    <div
                      className="import-mapping-default"
                      key={definition.field}
                    >
                      <label>
                        <span>{definition.label}</span>
                        <input
                          aria-label={`${definition.label} applied to every row`}
                          disabled={importIsLocked}
                          onChange={(event) =>
                            updateFieldDefault(
                              definition.field,
                              event.target.value,
                            )
                          }
                          value={
                            fieldDefaults[definition.field] ?? ""
                          }
                        />
                      </label>
                      <button
                        disabled={importIsLocked}
                        onClick={() =>
                          removeFieldDefault(definition.field)
                        }
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {hasMissingRequiredDefault ? (
              <div className="import-mapping-default-required">
                <div>
                  <strong>Complete the missing required field</strong>
                  <span>
                    Choose the field and enter the value shared by
                    every imported row.
                  </span>
                </div>
                {defaultAddControls}
              </div>
            ) : availableDefaultDefinitions.length > 0 ? (
              <details className="import-mapping-default-more">
                <summary>Apply another value to every row</summary>
                <p>
                  Optional: use this when another value is also
                  absent from every row in the source file.
                </p>
                {defaultAddControls}
              </details>
            ) : null}
          </section>

          {mapping.includes("cuvee") ? (
            <section
              aria-labelledby="cuvee-fallback-heading"
              className="import-cuvee-fallback"
            >
              <div>
                <h3 id="cuvee-fallback-heading">
                  Empty Cuvée cells
                </h3>
                <p>
                  Optional: choose how to name only the rows whose
                  mapped Cuvée cell is empty. Existing Cuvée values
                  remain unchanged.
                </p>
              </div>
              <div className="import-cuvee-fallback__controls">
                <label>
                  <span>For an empty Cuvée, use</span>
                  <select
                    disabled={importIsLocked}
                    onChange={(event) =>
                      updateCuveeFallbackMode(
                        event.target.value as
                          CsvCuveeFallback["mode"],
                      )
                    }
                    value={cuveeFallbackMode}
                  >
                    <option value="none">
                      Keep the row blocked
                    </option>
                    <option value="fixed">
                      One fixed value
                    </option>
                    <option value="color">Copy Color</option>
                    <option value="appellation">
                      Copy Appellation
                    </option>
                  </select>
                </label>
                {cuveeFallbackMode === "fixed" ? (
                  <label>
                    <span>Fixed Cuvée value</span>
                    <input
                      disabled={importIsLocked}
                      onChange={(event) =>
                        updateCuveeFallbackValue(
                          event.target.value,
                        )
                      }
                      placeholder="Generic"
                      value={cuveeFallbackValue}
                    />
                  </label>
                ) : null}
              </div>
            </section>
          ) : null}

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
                bottle formats, and quantities are normalized. NM
                is treated as NV. Source values remain available
                for comparison.
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
                Safe equivalents are normalized automatically in
                the import preview without changing the original
                file. Use the controls above for supported
                fallbacks; only the remaining values listed below
                still need correction in the source file.
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
                    every matched row in this file.
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
                          <dt>Source cellar</dt>
                          <dd>
                            {result.row.fields.cellar ?? "Empty"}
                          </dd>
                        </div>
                        <div>
                          <dt>Source location</dt>
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
                            <dt>This file</dt>
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
        <div className="import-preparation-collapse-action">
          <button
            onClick={() => setPreparationExpanded(false)}
            type="button"
          >
            Collapse preparation stages
          </button>
        </div>
      ) : null}
        </>
      )}

      {showImportPreview ? (
        <section
          aria-labelledby="final-preview-heading"
          className="import-final-preview-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="final-preview-heading">
                7. Review detected issues
              </h2>
              <p>
                This first preview preserves the decisions found
                from the source file. Blocking rows are shown here and
                resolved explicitly in the next stage.
              </p>
            </div>
            <span className="import-section-heading__status">
              {initialImportPreviewSummary.blockedRowCount > 0
                ? `${initialImportPreviewSummary.blockedRowCount} ${initialImportPreviewSummary.blockedRowCount === 1 ? "row needs" : "rows need"} resolution`
                : "No blocking issues"}
            </span>
          </div>

          <div
            aria-label="Initial import preview summary"
            className="import-checkpoint-summary"
          >
            <span>
              <strong>{initialImportPreviewSummary.totalBottleCount}</strong> bottles
            </span>
            <span>
              <strong>{initialImportPreviewSummary.newWineCount}</strong> new wines
            </span>
            <span>
              <strong>{initialImportPreviewSummary.existingWineCount}</strong> existing wines
            </span>
            <span>
              <strong>{initialImportPreviewSummary.destinationCount}</strong> destinations
            </span>
            <span>
              <strong>{initialImportPreviewSummary.blockedRowCount}</strong> blocked rows
            </span>
          </div>

          {initialImportPreviewSummary.blockedRowCount > 0 ? (
            <Notice role="alert" tone="warning">
              <strong>
                Resolve {initialImportPreviewSummary.blockedRowCount} {initialImportPreviewSummary.blockedRowCount === 1 ? "row" : "rows"} before import
              </strong>
              <p>
                No catalog candidate or destination is selected
                silently. Every blocker has a decision control in
                stage 8 below.
              </p>
            </Notice>
          ) : (
            <Notice role="status" tone="success">
              All rows were resolved directly from the source file and
              synchronized cellar data.
            </Notice>
          )}

          <details className="import-all-preview-rows">
            <summary>
              Review the complete first preview ({displayedInitialPreviewRows.length} {displayedInitialPreviewRows.length === 1 ? "row" : "rows"})
            </summary>
            <div className="import-final-preview-list">
              {displayedInitialPreviewRows.map((result) => (
                <CompactImportPreviewCard
                  key={result.row.recordNumber}
                  result={result}
                />
              ))}
            </div>
          </details>
        </section>
      ) : null}

      {showImportPreview ? (
        <section
          aria-labelledby="resolution-heading"
          className="import-resolution-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="resolution-heading">
                8. Resolve import issues
              </h2>
              <p>
                Choose only the decisions the source file could not make
                safely. Selections update the second preview
                without writing bottles. Creating a destination
                explicitly saves only its cellar setup.
              </p>
            </div>
            <span className="import-section-heading__status">
              {resolutionIsComplete
                ? "All issues resolved"
                : `${resolvedImportPreviewSummary.blockedRowCount} ${resolvedImportPreviewSummary.blockedRowCount === 1 ? "row remains" : "rows remain"}`}
            </span>
          </div>

          {rowsNeedingStorage.length > 0 ? (
            <details
              className="import-create-destination"
              open={storageOptions.length === 0}
            >
              <summary>Create a destination for this import</summary>
              <div>
                <p>
                  Create a real cellar and its first location, then
                  assign all {rowsNeedingStorage.length} storage-unresolved {rowsNeedingStorage.length === 1 ? "row" : "rows"} there. The setup is saved immediately even if you later cancel the import; bottles are added only after final confirmation.
                </p>
                <form onSubmit={(event) => void createDestinationForImport(event)}>
                  <label>
                    <span>New cellar name</span>
                    <input
                      autoComplete="off"
                      defaultValue={suggestedDestinationCellar}
                      name="cellarName"
                      placeholder="Stock A"
                      required
                    />
                  </label>
                  <label>
                    <span>Initial location</span>
                    <input
                      autoComplete="off"
                      defaultValue={suggestedDestinationLocation}
                      name="locationCode"
                      placeholder="Unsorted"
                      required
                    />
                  </label>
                  <label>
                    <span>Capacity (optional)</span>
                    <input
                      inputMode="numeric"
                      min="1"
                      name="capacity"
                      step="1"
                      type="number"
                    />
                  </label>
                  <button
                    disabled={
                      !isOnline ||
                      destinationIsCreating ||
                      importIsLocked
                    }
                    type="submit"
                  >
                    {destinationIsCreating
                      ? "Creating destination…"
                      : "Create and assign destination"}
                  </button>
                </form>
                {destinationCreationError ? (
                  <Notice role="alert" tone="error">
                    {destinationCreationError}
                  </Notice>
                ) : null}
                {destinationCreationMessage ? (
                  <Notice role="status" tone="success">
                    {destinationCreationMessage}
                  </Notice>
                ) : null}
              </div>
            </details>
          ) : null}

          {rowsNeedingResolution.length === 0 ? (
            <Notice role="status" tone="success">
              No manual decisions are required. The resolved
              preview is ready for review.
            </Notice>
          ) : (
            <div className="import-resolution-list">
              {rowsNeedingResolution.map((result) => {
                const recordNumber = result.row.recordNumber
                const resolvedRow =
                  resolvedImportPreviewRows.find(
                    (row) =>
                      row.row.recordNumber === recordNumber,
                  )
                const needsWine =
                  result.wineMatch?.classification === "ambiguous"
                const needsStorage =
                  result.storage?.status !== "ready"

                return (
                  <article
                    className="import-resolution-card"
                    key={recordNumber}
                  >
                    <header>
                      <div>
                        <strong>
                          {result.row.fields.producer} — {result.row.fields.cuvee}
                        </strong>
                        <span>
                          Source record {recordNumber}
                          <span aria-hidden="true"> · </span>
                          {result.row.fields.quantity} {result.row.fields.quantity === 1 ? "bottle" : "bottles"}
                        </span>
                      </div>
                      <span
                        className={`import-row-status import-row-status--preview-${resolvedRow?.status ?? "blocked"}`}
                      >
                        {resolvedRow?.status === "blocked"
                          ? "Needs resolution"
                          : "Resolved"}
                      </span>
                    </header>

                    {resolvedRow?.status === "blocked" ? (
                      <ul className="import-resolution-card__issues">
                        {resolvedRow.issues
                          .filter(
                            (previewIssue) =>
                              previewIssue.severity === "error",
                          )
                          .map((previewIssue) => (
                            <li
                              key={`${previewIssue.category}:${previewIssue.code}`}
                            >
                              {previewIssue.message}
                            </li>
                          ))}
                      </ul>
                    ) : null}

                    {needsWine ? (
                      <fieldset>
                        <legend>Catalog reference</legend>
                        <p>
                          Choose the existing wine represented by
                          this source row.
                        </p>
                        <div className="import-resolution-candidates">
                          {result.wineMatch?.candidates.map(
                            (candidate) => (
                              <label key={candidate.id}>
                                <input
                                  checked={
                                    resolutionSelections.wineIdByRecord[recordNumber] === candidate.id
                                  }
                                  name={`wine-resolution-${recordNumber}`}
                                  disabled={importIsLocked}
                                  onChange={() => {
                                    if (importIsLocked) {
                                      return
                                    }

                                    resetCommitState()
                                    setResolutionSelections(
                                      (current) => ({
                                        ...current,
                                        wineIdByRecord: {
                                          ...current.wineIdByRecord,
                                          [recordNumber]: candidate.id,
                                        },
                                      }),
                                    )
                                  }}
                                  type="radio"
                                  value={candidate.id}
                                />
                                <span>
                                  <strong>
                                    {candidate.appellation ?? "No appellation"}
                                  </strong>
                                  <small>
                                    {candidate.area ?? "No area"} · Reference {candidate.id}
                                  </small>
                                </span>
                              </label>
                            ),
                          )}
                        </div>
                      </fieldset>
                    ) : null}

                    {needsStorage ? (
                      <label className="import-resolution-destination">
                        <span>Destination</span>
                        <select
                          disabled={importIsLocked}
                          onChange={(event) => {
                            if (importIsLocked) {
                              return
                            }

                            resetCommitState()
                            setResolutionSelections((current) => ({
                              ...current,
                              locationIdByRecord: {
                                ...current.locationIdByRecord,
                                [recordNumber]:
                                  event.target.value || undefined,
                              },
                            }))
                          }}
                          value={
                            resolutionSelections.locationIdByRecord[recordNumber] ?? ""
                          }
                        >
                          <option value="">
                            Choose an active location
                          </option>
                          {storageOptions.map(
                            ({ cellar, location }) => (
                              <option
                                key={location.id}
                                value={location.id}
                              >
                                {cellar.name} / {location.code} · {location.bottle_count} current · capacity {location.capacity ?? "not set"}
                              </option>
                            ),
                          )}
                        </select>
                        <small>
                          Source value: {result.row.fields.cellar ?? "Empty"} / {result.row.fields.location ?? "Empty"}
                        </small>
                      </label>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {showImportPreview ? (
        <section
          aria-labelledby="resolved-preview-heading"
          className="import-final-preview-panel"
        >
          <div className="import-section-heading">
            <div>
              <h2 id="resolved-preview-heading">
                9. Review the resolved preview
              </h2>
              <p>
                Confirm the final wine, destination, and quantity
                plan produced after issue resolution. The next
                stage writes this complete plan as one transaction.
              </p>
            </div>
            <span className="import-section-heading__status">
              {resolutionIsComplete
                ? `${resolvedImportPreviewSummary.readyBottleCount} bottles ready`
                : `${resolvedImportPreviewSummary.blockedRowCount} blocked`}
            </span>
          </div>

          <div
            aria-label="Resolved import preview summary"
            className="import-final-preview-summary"
          >
            <div>
              <strong>{resolvedImportPreviewSummary.totalBottleCount}</strong>
              <span>Total bottles</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.readyBottleCount}</strong>
              <span>Ready bottles</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.newWineCount}</strong>
              <span>New wines</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.existingWineCount}</strong>
              <span>Existing wines</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.destinationCount}</strong>
              <span>Destinations</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.blockedRowCount}</strong>
              <span>Blocked rows</span>
            </div>
          </div>

          {resolutionIsComplete ? (
            <Notice role="status" tone="success">
              <strong>The resolved import plan is complete</strong>
              <p>
                Review the compact rows below. No bottles have been
                imported.
              </p>
            </Notice>
          ) : (
            <Notice role="alert" tone="warning">
              Complete every decision in stage 8 before import can
              proceed.
            </Notice>
          )}

          {resolvedImportPreviewSummary.warningLocationCount > 0 ? (
            <Notice role="status" tone="warning">
              {resolvedImportPreviewSummary.warningLocationCount} destination {resolvedImportPreviewSummary.warningLocationCount === 1 ? "has" : "have"} an advisory capacity warning. These rows remain ready.
            </Notice>
          ) : null}

          <p className="import-final-preview-display-note">
            Showing {displayedResolvedPreviewRows.length} of {resolvedImportPreviewSummary.totalRowCount} rows. Blockers and warnings appear first; details stay collapsed by default.
          </p>

          <div className="import-final-preview-list">
            {displayedResolvedPreviewRows.map((result) => (
              <CompactImportPreviewCard
                key={result.row.recordNumber}
                result={result}
              />
            ))}
          </div>
        </section>
      ) : null}

      {document?.header && !commitResult ? (
        <section
          aria-labelledby="import-result-heading"
          className="import-result-panel"
        >
          <div>
            <h2 id="import-result-heading">
              10. Confirm and import
            </h2>
            <p id="import-confirmation-readiness">
              {importConfirmationBlocker?.message ??
                (resolvedImportPreviewSummary.warningLocationCount > 0
                  ? "The resolved preview is complete. Review the advisory capacity warnings before confirming; no bottles have been imported."
                  : "The resolved preview is complete. Continue to the final confirmation when ready; no bottles have been imported.")}
            </p>
          </div>
          <button
            aria-describedby="import-confirmation-readiness"
            disabled={isCommitting}
            onClick={openImportConfirmation}
            type="button"
          >
            {importConfirmationBlocker?.buttonLabel ??
              "Continue to import confirmation"}
          </button>

          {commitError ? (
            <Notice role="alert" tone="error">
              <strong>Import cannot continue yet</strong>
              <p>{commitError}</p>
              {commitPlan ? (
                <p>
                  The original receipt is locked. Retry this same
                  plan so a lost response cannot add the import
                  twice.
                </p>
              ) : null}
            </Notice>
          ) : null}

          {confirmationIsOpen && commitPlan ? (
            <div className="import-confirmation">
              <div>
                <h3>Final confirmation</h3>
                <p>
                  This will add {commitPlan.rows.reduce((total, row) => total + row.quantity, 0)} {commitPlan.rows.reduce((total, row) => total + row.quantity, 0) === 1 ? "bottle" : "bottles"} across {commitPlan.rows.length} source {commitPlan.rows.length === 1 ? "row" : "rows"}. It may create {new Set(commitPlan.rows.filter((row) => row.wineAction === "create").map((row) => row.requestedWineId)).size} catalog {new Set(commitPlan.rows.filter((row) => row.wineAction === "create").map((row) => row.requestedWineId)).size === 1 ? "wine" : "wines"}.
                </p>
                <p>
                  The complete batch succeeds or rolls back. It
                  does not replace or remove existing bottles.
                </p>
              </div>

              <label className="import-confirmation__acknowledgement">
                <input
                  checked={confirmationAccepted}
                  disabled={isCommitting}
                  onChange={(event) =>
                    setConfirmationAccepted(
                      event.target.checked,
                    )
                  }
                  type="checkbox"
                />
                <span>
                  I reviewed the wines, destinations, quantities,
                  and any capacity warnings above.
                </span>
              </label>

              <div className="import-confirmation__actions">
                <button
                  disabled={isCommitting}
                  onClick={() => {
                    setConfirmationIsOpen(false)
                    setConfirmationAccepted(false)
                  }}
                  type="button"
                >
                  Back to preview
                </button>
                <button
                  disabled={
                    !confirmationAccepted || isCommitting
                  }
                  onClick={() => void confirmImport()}
                  type="button"
                >
                  {isCommitting
                    ? "Importing…"
                    : commitAttempted
                      ? "Retry the same import"
                      : `Import ${commitPlan.rows.reduce((total, row) => total + row.quantity, 0)} ${commitPlan.rows.reduce((total, row) => total + row.quantity, 0) === 1 ? "bottle" : "bottles"}`}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {commitResult ? (
        <section
          aria-labelledby="import-complete-heading"
          className="import-complete-panel"
        >
          <div>
            <h2 id="import-complete-heading">
              Import complete
            </h2>
            <p>
              The complete spreadsheet batch was committed. Inventory and
              catalog views will update as synchronization arrives.
            </p>
          </div>

          <Notice role="status" tone="success">
            <strong>
              {commitResult.importedBottleCount} {commitResult.importedBottleCount === 1 ? "bottle" : "bottles"} imported
            </strong>
            <p>
              {commitResult.importedRowCount} source {commitResult.importedRowCount === 1 ? "row" : "rows"} · {commitResult.createdWineCount} new {commitResult.createdWineCount === 1 ? "wine" : "wines"} · {commitResult.reusedWineCount} reused {commitResult.reusedWineCount === 1 ? "wine" : "wines"}
            </p>
          </Notice>

          <dl className="import-complete-panel__receipt">
            <div>
              <dt>Import receipt</dt>
              <dd>{commitResult.importId}</dd>
            </div>
            <div>
              <dt>File</dt>
              <dd>{fileName ?? "Spreadsheet import"}</dd>
            </div>
          </dl>

          <button onClick={resetImport} type="button">
            Import another file
          </button>
        </section>
      ) : null}
        </>
      )}
    </main>
  )
}
