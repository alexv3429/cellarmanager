import { useQuery } from "@powersync/react"
import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { ImportStorageGroups } from "./ImportStorageGroups"

import {
  CSV_IMPORT_FIELD_DEFINITIONS,
  mapCsvSourceRow,
  suggestCsvColumnMapping,
  validateCsvColumnMapping,
  type CsvColumnMapping,
  type CsvImportField,
  type CsvImportFieldDefaults,
} from "../data/csvColumnMapping"
import { summarizeCsvCleaning, type CsvCuveeFallback } from "../data/csvCleaning"
import { prepareCsvImportRows, type CsvRowCorrections } from "../data/csvImportPreparation"
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
import { ImportRowEditor } from "./ImportRowEditor"
import { ImportColumnSplit } from "./ImportColumnSplit"
import { isCsvSplitConfigured, type CsvColumnSplit } from "../data/csvColumnSplit"
import { Notice } from "./Notice"
import { useLanguage } from "../i18n/useLanguage"

const FILE_SIZE_LIMIT_BYTES = 20_000_000
type CuveePreparationMode = CsvCuveeFallback["mode"]
const SAMPLE_ROW_COUNT = 3
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
  if (result.quantity === 0) return "Catalog only · no storage needed"

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
  const { t } = useLanguage()
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
          <span>{t("Source record")}{row.recordNumber}
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
          <span>{t("Wine")}</span>
          <strong>
            {row.fields.vintage ?? t("NV")} · {row.fields.color} · {formatWineVolume(row.fields.formatMl ?? 0)}
          </strong>
          <span
            className={`import-plan-action import-plan-action--${result.wineAction}`}
          >
            {result.wineAction === "reuse"
              ? t("Reuse catalog wine")
              : result.wineAction === "create"
                ? t("Create catalog wine")
                : t("Unresolved")}
          </span>
        </section>

        <span aria-hidden="true">→</span>

        <section>
          <span>{t("Destination")}</span>
          <strong>
            {storage?.cellar && storage.location
              ? t("{value1} / {value2}", { value1: String(storage.cellar.name), value2: String(storage.location.code) })
              : row.fields.quantity === 0 ? t("Catalog only · no storage needed") : t("Unresolved")}
          </strong>
        </section>

        <span aria-hidden="true">→</span>

        <section>
          <span>{t("Quantity")}</span>
          <strong>
            {row.fields.quantity ?? t("Invalid")} {row.fields.quantity === 1 ? t("bottle") : t("bottles")}
          </strong>
        </section>
      </div>

      <details>
        <summary>{t("Details and source values")}</summary>
        <dl className="import-final-preview-card__details">
          <div>
            <dt>{t("Catalog reference")}</dt>
            <dd>{result.existingWine?.id ?? t("New or unresolved")}</dd>
          </div>
          <div>
            <dt>{t("Source storage")}</dt>
            <dd>
              {row.fields.cellar ?? t("Empty")} / {row.fields.location ?? t("Empty")}
            </dd>
          </div>
          <div>
            <dt>{t("Projected occupancy")}</dt>
            <dd>
              {storage?.location
                ? t("{value1} + {value2} = {value3}", { value1: String(storage.currentBottleCount), value2: String(storage.importBottleCount), value3: String(storage.projectedBottleCount) })
                : row.fields.quantity === 0 ? t("No stock change") : t("Unresolved")}
            </dd>
          </div>
          <div>
            <dt>{t("Capacity")}</dt>
            <dd>{storage?.location?.capacity ?? t("Not set")}</dd>
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
  canImportInventory,
  ...props
}: ImportViewProps & { canImportInventory: boolean }) {
  const { t } = useLanguage()
  if (!canImportInventory) {
    return (
      <main className="import-view">
        <div className="import-view__intro">
          <h1>{t("Cellar data")}</h1>
          <p>{t("Download a portable copy of this shared cellar.")}</p>
        </div>
        <Notice role="status">{t("Spreadsheet imports are reserved for household Owners. As a Member, you can export the cellar and browse wines, quantities, and locations in Cellar.")}</Notice>
        <CsvExportPanel householdId={props.householdId} isOnline={props.isOnline} />
      </main>
    )
  }

  return <OwnerImportView {...props} />
}

function OwnerImportView({
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
  const { t } = useLanguage()
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
  const [rowCorrections, setRowCorrections] = useState<CsvRowCorrections>({})
  const [columnSplit, setColumnSplit] = useState<CsvColumnSplit | null>(null)
  const [excludedRecords, setExcludedRecords] = useState<Set<number>>(new Set())
  const [fieldDefaults, setFieldDefaults] =
    useState<CsvImportFieldDefaults>({})
  const [defaultField, setDefaultField] = useState<
    CsvImportField | ""
  >("")
  const [defaultValue, setDefaultValue] = useState("")
  const [cuveeFallbackMode, setCuveeFallbackMode] =
    useState<CuveePreparationMode>("none")
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

  const cuveeFallbackIsConfigured = cuveeFallbackMode !== "none" && (cuveeFallbackMode !== "fixed" || cuveeFallbackValue.trim().length > 0)
  const splitIsConfigured = isCsvSplitConfigured(columnSplit, mapping.length)
  const mappingIssues = useMemo(
    () =>
      validateCsvColumnMapping(mapping, cuveeFallbackIsConfigured
        ? { ...fieldDefaults, cuvee: fieldDefaults.cuvee || "Derived during cleaning" }
        : fieldDefaults, splitIsConfigured ? [columnSplit.firstField, columnSplit.secondField] : []),
    [fieldDefaults, mapping, cuveeFallbackIsConfigured, splitIsConfigured, columnSplit],
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

  const preparedRows = useMemo(() => {
    const cuveeFallback: CsvCuveeFallback =
      cuveeFallbackMode === "fixed"
        ? {
            mode: "fixed",
            value: cuveeFallbackValue,
          }
        : { mode: cuveeFallbackMode }

    return prepareCsvImportRows({ document, mapping, defaults: fieldDefaults,
      corrections: rowCorrections, excluded: excludedRecords, options: { cuveeFallback } })
  }, [
    cuveeFallbackMode,
    cuveeFallbackValue,
    document,
    fieldDefaults,
    mapping,
    rowCorrections,
    excludedRecords,
  ])
  const cleanedRows = preparedRows.includedRows

  const cleaningSummary = useMemo(
    () => summarizeCsvCleaning(cleanedRows),
    [cleanedRows],
  )

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

  const storageSummary = useMemo(() => summarizeCsvStorageReconciliation(resolvedImport.storageResults), [resolvedImport.storageResults])
  const catalogOnlyStorageRows = resolvedImport.storageResults.filter((result) => result.status === "ready" && result.quantity === 0).length
  const displayedStorageResults = useMemo(() => {
    const results = resolvedImport.storageResults
    return [
      ...results.filter((result) => result.status !== "ready"),
      ...results.filter((result) => result.status === "ready" && result.issues.length > 0),
      ...results.filter((result) => result.status === "ready" && result.issues.length === 0),
    ].slice(0, STORAGE_ROW_DISPLAY_LIMIT)
  }, [resolvedImport.storageResults])

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
  function applyDocument(
    nextDocument: CsvIngestionDocument,
  ) {
    if (commitAttempted || isCommitting || destinationIsCreating) {
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
    setColumnSplit(null)
    setRowCorrections({})
    setExcludedRecords(new Set())
    setMapping(nextMapping)
    setFieldDefaults({})
    setDefaultField(firstMissingRequiredField)
    setDefaultValue("")
    setCuveeFallbackMode("none")
    setCuveeFallbackValue("")
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
    if (commitAttempted || isCommitting || destinationIsCreating) {
      event.target.value = ""
      return
    }

    const file = event.target.files?.[0]
    const selectionId = latestFileSelection.current + 1
    latestFileSelection.current = selectionId

    setFileError(null)
    setSourceText(null)
    setDocument(null)
    setColumnSplit(null)
    setRowCorrections({})
    setExcludedRecords(new Set())
    setMapping([])
    setFieldDefaults({})
    setDefaultField("")
    setDefaultValue("")
    setCuveeFallbackMode("none")
    setCuveeFallbackValue("")
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
    if (commitAttempted || isCommitting || destinationIsCreating) {
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

  function updateColumnSplit(split: CsvColumnSplit | null) {
    if (commitAttempted || isCommitting || destinationIsCreating) return
    setColumnSplit(split)
    setPreparationExpanded(true)
    resetImportDecisions()
  }

  function correctRows(changes: CsvRowCorrections) {
    if (commitAttempted || isCommitting || destinationIsCreating) return
    setRowCorrections((current) => ({ ...current, ...changes }))
    resetImportDecisions()
  }

  function excludeRows(recordNumbers: number[], excluded: boolean) {
    if (commitAttempted || isCommitting || destinationIsCreating) return
    setExcludedRecords((current) => {
      const next = new Set(current)
      for (const number of recordNumbers) {
        if (excluded) next.add(number)
        else next.delete(number)
      }
      return next
    })
    resetImportDecisions()
  }

  function addFieldDefault() {
    if (
      !defaultField ||
      !defaultValue.trim() ||
      destinationIsCreating ||
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
    if (commitAttempted || isCommitting || destinationIsCreating) {
      return
    }

    setFieldDefaults((currentDefaults) => ({
      ...currentDefaults,
      [field]: value,
    }))
    resetImportDecisions()
  }

  function removeFieldDefault(field: CsvImportField) {
    if (commitAttempted || isCommitting || destinationIsCreating) {
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
    mode: CuveePreparationMode,
  ) {
    if (commitAttempted || isCommitting || destinationIsCreating) {
      return
    }

    setCuveeFallbackMode(mode)
    if (mode !== "none" && defaultField === "cuvee") {
      setDefaultField("")
      setDefaultValue("")
    }
    if (mode !== "fixed") {
      setCuveeFallbackValue("")
    }
    resetImportDecisions()
  }

  function updateCuveeFallbackValue(value: string) {
    if (commitAttempted || isCommitting || destinationIsCreating) {
      return
    }

    setCuveeFallbackValue(value)
    resetImportDecisions()
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
    if ((commitAttempted || isCommitting || destinationIsCreating) && !commitResult) {
      return
    }

    latestFileSelection.current += 1
    setFileInputKey((currentKey) => currentKey + 1)
    setFileName(null)
    setSourceText(null)
    setDocument(null)
    setColumnSplit(null)
    setRowCorrections({})
    setExcludedRecords(new Set())
    setMapping([])
    setFieldDefaults({})
    setDefaultField("")
    setDefaultValue("")
    setCuveeFallbackMode("none")
    setCuveeFallbackValue("")
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
      isCommitting ||
      destinationIsCreating
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
    mappingIsReady && cleanedRows.length > 0 && cleaningSummary.issueCount === 0
  const showStorage =
    showMatching && !catalogIsLoading && !catalogError
  const showImportPreview =
    showStorage && !storageIsLoading && !storageError
  const resolutionIsComplete =
    showImportPreview &&
    cleanedRows.length > 0 &&
    resolvedImportPreviewSummary.blockedRowCount === 0
  const preparationIsCollapsed =
    showImportPreview && !preparationExpanded
  const importIsLocked = isCommitting || commitAttempted || destinationIsCreating
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
        !(definition.field === "cuvee" && cuveeFallbackIsConfigured) &&
        fieldDefaults[definition.field] === undefined,
    )
  const hasMissingRequiredDefault =
    availableDefaultDefinitions.some(
      (definition) => definition.required && !mapping.includes(definition.field) &&
        !(splitIsConfigured && [columnSplit.firstField, columnSplit.secondField].includes(definition.field)),
    )
  const defaultAddControls =
    availableDefaultDefinitions.length > 0 ? (
      <div className="import-mapping-default-add">
        <label>
          <span>{t("CellarManager field")}</span>
          <select
            disabled={importIsLocked}
            onChange={(event) =>
              setDefaultField(
                event.target.value as CsvImportField | "",
              )
            }
            value={defaultField}
          >
            <option value="">{t("Choose a field")}</option>
            {availableDefaultDefinitions.map((definition) => (
              <option
                key={definition.field}
                value={definition.field}
              >
                {t(definition.label)}
                {definition.required ? ` ${t("(required)")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("Default for empty cells")}</span>
          <input
            disabled={importIsLocked}
            onChange={(event) =>
              setDefaultValue(event.target.value)
            }
            placeholder={
              defaultField === "formatMl" ? t("750 ml") : undefined
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
        >{t("Set default")}</button>
      </div>
    ) : null
  const importConfirmationBlocker = destinationIsCreating
    ? { buttonLabel: "Saving cellar setup…", message: "Wait for cellar setup to finish before confirming the import. No bottles are being imported." }
    : !mappingIsReady
    ? {
        buttonLabel: "Complete column mapping first",
        message:
          "Resolve every file-structure and required mapping issue before cleaning.",
      }
    : cleanedRows.length === 0
      ? { buttonLabel: "Include at least one row", message: "All source rows are excluded. Include at least one row to continue." }
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
        <h1>{t("Cellar data")}</h1>
        <p>{t("Import bottles from a spreadsheet or download a portable copy of this cellar.")}</p>
      </div>

      <div
        aria-label={t("Cellar data action")}
        className="import-view__mode-switch"
        role="group"
      >
        <button
          aria-pressed={dataMode === "import"}
          onClick={() => setDataMode("import")}
          type="button"
        >{t("Import file")}</button>
        <button
          aria-pressed={dataMode === "export"}
          disabled={destinationIsCreating}
          onClick={() => setDataMode("export")}
          type="button"
        >{t("Export cellar")}</button>
      </div>

      {dataMode === "export" ? (
        <CsvExportPanel
          householdId={householdId}
          isOnline={isOnline}
        />
      ) : (
        <>

      <div className="import-view__intro import-view__intro--workflow">
        <h2>{t("Import bottles")}</h2>
        <p>{t("Mapping and preparation do not change the cellar. Creating a destination in stage 8 is the only explicit setup write before final confirmation.")}</p>
      </div>

      {hasRecoveredPendingImport ? (
        <section className="import-result-panel">
          <div>
            <h2>{t("Previous import awaiting verification")}</h2>
            <p>{t("This device retained the exact receipt and row IDs from an interrupted import. Do not upload the file again until this receipt is resolved.")}</p>
          </div>

          <dl className="import-complete-panel__receipt">
            <div>
              <dt>{t("Import receipt")}</dt>
              <dd>{commitPlan.importId}</dd>
            </div>
            <div>
              <dt>{t("Pending plan")}</dt>
              <dd>
                {commitPlan.rows.reduce(
                  (total, row) => total + row.quantity,
                  0,
                )}{t(" ")}{t("bottles ·")}{t(" ")}{commitPlan.rows.length}{t(" ")}{t("source")}{t(" ")}{commitPlan.rows.length === 1 ? "row" : "rows"}
              </dd>
            </div>
          </dl>

          {commitError ? (
            <Notice role="alert" tone="warning">
              {commitError}
            </Notice>
          ) : (
            <Notice role="status">{t("Checking whether the import committed…")}</Notice>
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
            <h2>{t("Preparation complete")}</h2>
            <p>
              {fileName} · {cleaningSummary.totalRowCount} {cleaningSummary.totalRowCount === 1 ? "row" : "rows"} · {matchingSummary.existingRowCount}{t(" ")}{t("existing ·")}{t(" ")}{matchingSummary.newRowCount}{t(" ")}{t("new ·")}{t(" ")}{storageSummary.readyRowCount - catalogOnlyStorageRows}{t(" ")}{t("stocked rows assigned ·")}{t(" ")}{catalogOnlyStorageRows}{t("catalog only")}{` · ${excludedRecords.size} excluded · ${Object.values(rowCorrections).filter((row) => Object.keys(row).length > 0).length} corrected`}
            </p>
          </div>
          <button
            disabled={importIsLocked}
            onClick={() => setPreparationExpanded(true)}
            type="button"
          >{t("Review or edit stages 1–6")}</button>
        </section>
      ) : (
        <>
      <section
        aria-labelledby="import-file-heading"
        className="import-file-panel"
      >
        <div>
          <h2 id="import-file-heading">{t("1. Choose a file")}</h2>
          <p>{t("Excel (.xlsx) or UTF-8 CSV up to 20 MB. CSV files may use comma, semicolon, or tab delimiters.")}</p>
        </div>

        {!fileName ? (
          <div className="import-file-picker">
            <span>{t("Spreadsheet file")}</span>
            <input
              accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values"
              aria-label={t("Spreadsheet file")}
              hidden
              key={fileInputKey}
              onChange={(event) => void selectFile(event)}
              ref={fileInput}
              type="file"
            />
            <button
              onClick={() => fileInput.current?.click()}
              type="button"
            >{t("Choose file")}</button>
          </div>
        ) : null}

        {fileName ? (
          <div className="import-file-summary">
            <div>
              <strong>{fileName}</strong>
              {document ? (
                <span>
                  {document.rows.length}{t(" ")}{t("source")}{t(" ")}{document.rows.length === 1 ? "row" : "rows"}
                  <span aria-hidden="true"> · </span>
                  {document.worksheetName ? `Worksheet: ${document.worksheetName}` : `${delimiterLabel(document.delimiter)} delimiter`}
                  {excludedRecords.size > 0 ? ` · ${excludedRecords.size} rows excluded` : ""}
                </span>
              ) : null}
            </div>
            <button disabled={importIsLocked} onClick={resetImport} type="button">{t("Choose another file")}</button>
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
            <h2 id="delimiter-heading">{t("Select the delimiter")}</h2>
            <p>{t("Automatic detection was inconclusive. Choose the character that separates columns in this file.")}</p>
          </div>
          <div className="import-delimiter-actions">
            <button
              onClick={() => selectDelimiter(",")}
              type="button"
            >{t("Comma")}</button>
            <button
              onClick={() => selectDelimiter(";")}
              type="button"
            >{t("Semicolon")}</button>
            <button
              onClick={() => selectDelimiter("\t")}
              type="button"
            >{t("Tab")}</button>
          </div>
        </section>
      ) : null}

      {document && document.issues.length > 0 ? (
        <Notice role="alert" tone="error">
          <strong>{t("File structure needs attention")}</strong>
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
              <h2 id="mapping-heading">{t("2. Map columns")}</h2>
              <p>{t("Suggestions use header names only. Review every assignment; values remain unchanged.")}</p>
            </div>
            <span className="import-section-heading__status">
              {mapping.filter(Boolean).length}{t(" ")}{t("of")}{t(" ")}{mapping.length}{t("columns mapped")}{defaultDefinitions.length > 0
                ? ` · ${defaultDefinitions.length} shared ${defaultDefinitions.length === 1 ? "value" : "values"}`
                : ""}
            </span>
          </div>

          <section
            aria-labelledby="mapping-defaults-heading"
            className="import-mapping-defaults"
          >
            <div>
              <h3 id="mapping-defaults-heading">{t("Defaults for missing values")}</h3>
              <p>{t("Fill empty cells or missing columns without replacing existing values. For example, use 750 ml for a blank Bottle format; an explicit 1500 ml stays unchanged. Zero is a value, not an empty cell.")}</p>
            </div>

            {defaultDefinitions.length > 0 ? (
              <div className="import-mapping-default-applied">
                <div>
                  <strong>{t("Fill blanks only")}</strong>
                  <span>{t("Explicit source values and your row corrections take priority.")}</span>
                </div>
                <div className="import-mapping-default-list">
                  {defaultDefinitions.map((definition) => (
                    <div
                      className="import-mapping-default"
                      key={definition.field}
                    >
                      <label>
                        <span>{t(definition.label)}</span>
                        <input
                          aria-label={`${t(definition.label)} ${t("default for empty cells")}`}
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
                      <small>{preparedRows.allRows.filter((row) => !row.excluded && row.defaultsApplied.includes(definition.field)).length}{t(" ")}{t("included rows use this default")}</small>
                      <button
                        disabled={importIsLocked}
                        onClick={() =>
                          removeFieldDefault(definition.field)
                        }
                        type="button"
                      >{t("Remove")}</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {hasMissingRequiredDefault ? (
              <div className="import-mapping-default-required">
                <div>
                  <strong>{t("Complete the missing required field")}</strong>
                  <span>{t("Map a source column, set a default, or configure a column split below.")}</span>
                </div>
                {defaultAddControls}
              </div>
            ) : availableDefaultDefinitions.length > 0 ? (
              <details className="import-mapping-default-more">
                <summary>{t("Set another default for empty cells")}</summary>
                <p>{t("Use a default for a missing column or blanks in a mapped column.")}</p>
                {defaultAddControls}
              </details>
            ) : null}
          </section>

          {mapping.includes("cuvee") || fieldDefaults.cuvee === undefined ? (
            <section
              aria-labelledby="cuvee-fallback-heading"
              className="import-cuvee-fallback"
            >
              <div>
                <h3 id="cuvee-fallback-heading">{t("Missing Cuvée / wine name")}</h3>
                <p>{t("If the file has no Cuvée column, or some cells are empty, choose how to name those wines. Existing names and your row corrections remain unchanged.")}</p>
              </div>
              <div className="import-cuvee-fallback__controls">
                <label>
                  <span>{t("How should missing cuvées be filled?")}</span>
                  <select
                    disabled={importIsLocked}
                    onChange={(event) =>
                      updateCuveeFallbackMode(
                        event.target.value as CuveePreparationMode,
                      )
                    }
                    value={cuveeFallbackMode}
                  >
                    <option value="none">{t("Keep the row blocked")}</option>
                    <option value="fixed">{t("One fixed value")}</option>
                    <option value="color">{t("Copy Color")}</option>
                    <option value="appellation">{t("Copy Appellation")}</option>
                  </select>
                </label>
                {cuveeFallbackMode === "fixed" ? (
                  <label>
                    <span>{t("Fixed Cuvée value")}</span>
                    <input
                      disabled={importIsLocked}
                      onChange={(event) =>
                        updateCuveeFallbackValue(
                          event.target.value,
                        )
                      }
                      placeholder={t("Generic")}
                      value={cuveeFallbackValue}
                    />
                  </label>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="import-column-split-settings" aria-label={t("Split a column")}>
            <h3>{t("Split a column")}</h3>
            <p>{t("One source column can contain two values, such as producer / cuvée or cellar / location. Choose their fields, then review and apply each split in step 4. Nothing is applied automatically.")}</p>
            {!columnSplit ? <button type="button" disabled={importIsLocked} onClick={() => updateColumnSplit({ sourceColumnIndex: 0, firstField: mapping[0] ?? "producer", secondField: mapping[0] === "cellar" ? "location" : mapping[0] === "cuvee" ? "producer" : "cuvee", separator: " - " })}>{t("Split a column")}</button> : <>
              <div className="import-row-editor__fields">
                <label><span>{t("Source column to split")}</span><select disabled={importIsLocked} value={columnSplit.sourceColumnIndex} onChange={(event) => updateColumnSplit({ ...columnSplit, sourceColumnIndex: Number(event.target.value) })}>
                  {document.header.values.map((header, index) => <option key={index} value={index}>{index + 1}. {header || "Untitled column"}</option>)}
                </select></label>
                <label><span>{t("First part goes to")}</span><select disabled={importIsLocked} value={columnSplit.firstField} onChange={(event) => updateColumnSplit({ ...columnSplit, firstField: event.target.value as CsvImportField })}>
                  {CSV_IMPORT_FIELD_DEFINITIONS.map(({ field, label }) => <option key={field} value={field}>{t(label)}</option>)}
                </select></label>
                <label><span>{t("Second part goes to")}</span><select disabled={importIsLocked} value={columnSplit.secondField} onChange={(event) => updateColumnSplit({ ...columnSplit, secondField: event.target.value as CsvImportField })}>
                  {CSV_IMPORT_FIELD_DEFINITIONS.map(({ field, label }) => <option key={field} value={field}>{t(label)}</option>)}
                </select></label>
                <label><span>{t("Separator")}</span><input disabled={importIsLocked} value={columnSplit.separator} onChange={(event) => updateColumnSplit({ ...columnSplit, separator: event.target.value })} maxLength={30} placeholder={t("e.g. / or -")} /><small>{t("Use the exact separator, including spaces. Leave blank for manual separation.")}</small></label>
              </div>
              {!splitIsConfigured ? <Notice tone="error">{t("Choose two different destination fields.")}</Notice> : null}
              <button type="button" disabled={importIsLocked} onClick={() => updateColumnSplit(null)}>{t("Stop splitting this column")}</button>
              <small>{t("Confirmed row corrections stay in place. Use Reset all row corrections in step 4 to remove them.")}</small>
            </>}
          </section>

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
                      <span>{t("Source column")}{sourceColumnIndex + 1}
                      </span>
                      <strong>
                        {sourceHeader || "Untitled column"}
                      </strong>
                    </div>

                    <label>
                      <span>{t("CellarManager field")}</span>
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
                        <option value="">{t("Do not map")}</option>
                        {CSV_IMPORT_FIELD_DEFINITIONS.map(
                          (definition) => (
                            <option
                              key={definition.field}
                              value={definition.field}
                            >
                              {t(definition.label)}
                              {definition.required
                                ? ` ${t("(required)")}`
                                : ""}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    <div className="import-mapping-card__samples">
                      <span>{t("Sample values")}</span>
                      {sampleValues.length > 0 ? (
                        <ul>
                          {sampleValues.map((value, index) => (
                            <li key={`${value}:${index}`}>
                              {value}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <em>{t("No non-empty sample values")}</em>
                      )}
                    </div>
                  </article>
                )
              },
            )}
          </div>

          {mappingIssues.length > 0 ? (
            <Notice role="status" tone="warning">
              <strong>{t("Complete the mapping")}</strong>
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
              <h2 id="preview-heading">{t("3. Check the sample")}</h2>
              <p>{t("First")}{sampleRows.length}{t(" ")}{t("source")}{t(" ")}{sampleRows.length === 1 ? "row" : "rows"}{t(", shown with the current mapping.")}</p>
            </div>
          </div>

          <div className="import-preview-list">
            {sampleRows.map((row) => (
              <article
                className="import-preview-card"
                key={row.recordNumber}
              >
                <header>
                  <strong>{t("Source record")}{row.recordNumber}
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
                              <dt>{t(definition.label)}</dt>
                              <dd>{value || t("Empty")}</dd>
                            </div>,
                          ]
                    },
                  )}
                </dl>

                {row.unmapped.length > 0 ? (
                  <details>
                    <summary>{t("Preserved unmapped values (")}{row.unmapped.length})
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
              <h2 id="cleaning-heading">{t("4. Clean and validate")}</h2>
              <p>{t("Whitespace, color casing, vintage, metric bottle formats, and quantities are normalized. NM is treated as NV. Source values remain available for comparison.")}</p>
            </div>
            <span className="import-section-heading__status">
              {cleaningSummary.invalidRowCount === 0
                ? `${cleaningSummary.readyRowCount} rows ready`
                : `${cleaningSummary.invalidRowCount} rows need attention`}
            </span>
          </div>

          <div
            aria-label={t("Cleaning summary")}
            className="import-cleaning-summary"
          >
            <div>
              <strong>{cleaningSummary.totalRowCount}</strong>
              <span>{t("Included rows")}</span>
            </div>
            <div>
              <strong>{cleaningSummary.readyRowCount}</strong>
              <span>{t("Ready rows")}</span>
            </div>
            <div>
              <strong>{cleaningSummary.invalidRowCount}</strong>
              <span>{t("Invalid rows")}</span>
            </div>
            <div>
              <strong>{cleaningSummary.changedValueCount}</strong>
              <span>{t("Normalized values")}</span>
            </div>
          </div>

          {cleaningSummary.issueCount > 0 ? (
            <Notice role="alert" tone="error">
              <strong>{t("Correct")}{cleaningSummary.issueCount}{t(" ")}{t("source")}{t(" ")}{cleaningSummary.issueCount === 1 ? "issue" : "issues"}
              </strong>
              <p>{t("Edit the affected rows below, replace a value in several rows, or exclude entries you do not want to import. Your changes are validated before you can continue.")}</p>
            </Notice>
          ) : (
            <Notice role="status" tone="success">
              {cleanedRows.length ? "All included rows passed cleaning and value validation." : "No rows are included. Include at least one row to continue."}
            </Notice>
          )}

          <ImportRowEditor rows={preparedRows.allRows} corrections={rowCorrections}
            splitReview={splitIsConfigured ? <ImportColumnSplit key={JSON.stringify(columnSplit)} rows={preparedRows.allRows} mapping={mapping} split={columnSplit}
              corrections={rowCorrections} disabled={importIsLocked} onCorrect={correctRows} /> : null}
            disabled={importIsLocked} onCorrect={correctRows} onExclude={excludeRows}
            onReset={() => {
              if (importIsLocked) return
              setRowCorrections({})
              resetImportDecisions()
            }} />
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
              <h2 id="matching-heading">{t("5. Match catalog wines")}</h2>
              <p>{t("Producer, cuvée, vintage, color, and bottle format form the conservative wine identity. Appellation and area are supporting metadata.")}</p>
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
            <Notice role="status">{t("Checking the synchronized catalog for the active household…")}</Notice>
          ) : catalogError ? (
            <Notice role="alert" tone="error">
              <strong>{t("Unable to check the wine catalog")}</strong>
              <p>{String(catalogError)}</p>
            </Notice>
          ) : (
            <>
              <div
                aria-label={t("Wine matching summary")}
                className="import-matching-summary"
              >
                <div>
                  <strong>{matchingSummary.totalRowCount}</strong>
                  <span>{t("Total rows")}</span>
                </div>
                <div>
                  <strong>{matchingSummary.existingRowCount}</strong>
                  <span>{t("Existing matches")}</span>
                </div>
                <div>
                  <strong>{matchingSummary.newRowCount}</strong>
                  <span>{t("New rows")}</span>
                </div>
                <div>
                  <strong>{matchingSummary.ambiguousRowCount}</strong>
                  <span>{t("Ambiguous rows")}</span>
                </div>
              </div>

              <p className="import-matching-display-note">{t("Showing")}{displayedMatchingResults.length}{t(" ")}{t("of")}{t(" ")}{matchingSummary.totalRowCount}{t("rows. Ambiguous rows appear first; matching is read-only.")}</p>

              {matchingSummary.ambiguousRowCount > 0 ? (
                <Notice role="alert" tone="warning">
                  <strong>{t("Resolve")}{matchingSummary.ambiguousRowCount}{t(" ")}{t("ambiguous")}{t(" ")}{matchingSummary.ambiguousRowCount === 1 ? "row" : "rows"}{t("before import")}</strong>
                  <p>{t("Every exact catalog candidate is shown below. Explicit candidate selection will be added in the issue-resolution step.")}</p>
                </Notice>
              ) : (
                <Notice role="status" tone="success">{t("Every source row is classified as an existing or new wine.")}</Notice>
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
                          <strong>{t("Source record")}{row.recordNumber}
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
                          <dt>{t("Producer")}</dt>
                          <dd>{row.fields.producer}</dd>
                        </div>
                        <div>
                          <dt>{t("Cuvée")}</dt>
                          <dd>{row.fields.cuvee}</dd>
                        </div>
                        <div>
                          <dt>{t("Vintage")}</dt>
                          <dd>{row.fields.vintage ?? "NV"}</dd>
                        </div>
                        <div>
                          <dt>{t("Color")}</dt>
                          <dd>{row.fields.color}</dd>
                        </div>
                        <div>
                          <dt>{t("Bottle format")}</dt>
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
                            <dt>{t("Source appellation")}</dt>
                            <dd>
                              {row.fields.appellation ?? "Empty"}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("Source area")}</dt>
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
                                    <dt>{t("Appellation")}</dt>
                                    <dd>
                                      {candidate.appellation ??
                                        "Empty"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>{t("Area")}</dt>
                                    <dd>
                                      {candidate.area ?? "Empty"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>{t("Reference ID")}</dt>
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
              <h2 id="storage-heading">{t("6. Reconcile storage and quantity")}</h2>
              <p>{t("Cellar and location names are matched inside the active household. Quantities are aggregated by location and compared with current occupancy and optional configured capacity.")}</p>
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
            <Notice role="status">{t("Checking synchronized cellars, locations, holdings, and capacities…")}</Notice>
          ) : storageError ? (
            <Notice role="alert" tone="error">
              <strong>{t("Unable to check cellar storage")}</strong>
              <p>{String(storageError)}</p>
            </Notice>
          ) : (
            <>
              <div
                aria-label={t("Storage reconciliation summary")}
                className="import-storage-summary"
              >
                <div>
                  <strong>{storageSummary.totalBottleCount}</strong>
                  <span>{t("Total bottles")}</span>
                </div>
                <div>
                  <strong>
                    {storageSummary.assignedBottleCount}
                  </strong>
                  <span>{t("Assigned bottles")}</span>
                </div>
                <div>
                  <strong>{storageSummary.readyRowCount - catalogOnlyStorageRows}</strong>
                  <span>{t("Stocked rows assigned")}</span>
                </div>
                <div>
                  <strong>
                    {storageSummary.unresolvedRowCount}
                  </strong>
                  <span>{t("Unresolved rows")}</span>
                </div>
              </div>

              {catalogOnlyStorageRows > 0 ? <p>{catalogOnlyStorageRows}{t(" ")}{t("catalog-only rows need no storage and add no bottles.")}</p> : null}
              <p className="import-storage-display-note">{t("Showing")}{displayedStorageResults.length}{t(" ")}{t("of")}{t(" ")}{storageSummary.totalRowCount}{t("rows. Unresolved storage and capacity warnings appear first; source context is unchanged.")}</p>

              {storageSummary.unresolvedRowCount > 0 ? (
                <Notice role="alert" tone="warning">
                  <strong>{t("Assign storage for")}{storageSummary.unresolvedRowCount} {storageSummary.unresolvedRowCount === 1 ? "row" : "rows"}{t("before import")}</strong>
                  <p>{t("You do not need to leave the import or create every cellar beforehand. In step 8, review the grouped destinations and confirm which cellars and locations to create or reuse.")}</p>
                  <button type="button" onClick={() => window.document.getElementById("import-storage-groups")?.scrollIntoView?.({ behavior: "smooth", block: "start" })}>{t("Review storage groups")}</button>
                </Notice>
              ) : (
                <Notice role="status" tone="success">{t("Every stocked row has an active cellar and location. Catalog-only rows need no storage.")}</Notice>
              )}

              {storageSummary.capacityWarningLocationCount > 0 ? (
                <Notice role="status" tone="warning">
                  <strong>{t("Review")}{storageSummary.capacityWarningLocationCount}{t(" ")}{t("capacity")}{t(" ")}{storageSummary.capacityWarningLocationCount === 1 ? "warning" : "warnings"}
                  </strong>
                  <p>{t("Capacity is an advisory setup value. The projected totals include current bottles plus every matched row in this file.")}</p>
                </Notice>
              ) : null}

              <details className="import-storage-details">
                <summary>{t("Inspect row-level storage details (")}{displayedStorageResults.length}{t(" ")}{t("of")}{t(" ")}{storageSummary.totalRowCount})</summary>
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
                          <strong>{t("Source record")}{result.row.recordNumber}
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
                          <dt>{t("Source cellar")}</dt>
                          <dd>
                            {result.row.fields.cellar ?? "Empty"}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("Source location")}</dt>
                          <dd>
                            {result.row.fields.location ?? "Empty"}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("Matched storage")}</dt>
                          <dd>
                            {result.cellar && result.location
                              ? `${result.cellar.name} / ${result.location.code}`
                              : result.quantity === 0 ? "Not needed (catalog only)" : "Unresolved"}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("Row quantity")}</dt>
                          <dd>{result.quantity ?? "Invalid"}</dd>
                        </div>
                      </dl>

                      {result.location ? (
                        <dl className="import-storage-card__occupancy">
                          <div>
                            <dt>{t("Current")}</dt>
                            <dd>{result.currentBottleCount}</dd>
                          </div>
                          <span aria-hidden="true">+</span>
                          <div>
                            <dt>{t("This file")}</dt>
                            <dd>{result.importBottleCount}</dd>
                          </div>
                          <span aria-hidden="true">=</span>
                          <div>
                            <dt>{t("Projected")}</dt>
                            <dd>{result.projectedBottleCount}</dd>
                          </div>
                          <span aria-hidden="true">/</span>
                          <div>
                            <dt>{t("Capacity")}</dt>
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
              </details>
            </>
          )}
        </section>
      ) : null}

      {showImportPreview ? (
        <div className="import-preparation-collapse-action">
          <button
            onClick={() => setPreparationExpanded(false)}
            type="button"
          >{t("Collapse preparation stages")}</button>
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
              <h2 id="final-preview-heading">{t("7. Review detected issues")}</h2>
              <p>{t("This first preview preserves the decisions found from the source file. Blocking rows are shown here and resolved explicitly in the next stage.")}</p>
            </div>
            <span className="import-section-heading__status">
              {initialImportPreviewSummary.blockedRowCount > 0
                ? `${initialImportPreviewSummary.blockedRowCount} ${initialImportPreviewSummary.blockedRowCount === 1 ? "row needs" : "rows need"} resolution`
                : "No blocking issues"}
            </span>
          </div>

          <div
            aria-label={t("Initial import preview summary")}
            className="import-checkpoint-summary"
          >
            <span>
              <strong>{initialImportPreviewSummary.totalBottleCount}</strong>{t("bottles")}</span>
            <span>
              <strong>{initialImportPreviewSummary.newWineCount}</strong>{t("new wines")}</span>
            <span>
              <strong>{initialImportPreviewSummary.existingWineCount}</strong>{t("existing wines")}</span>
            <span>
              <strong>{initialImportPreviewSummary.destinationCount}</strong>{t("destinations")}</span>
            <span>
              <strong>{initialImportPreviewSummary.blockedRowCount}</strong>{t("blocked rows")}</span>
          </div>

          {initialImportPreviewSummary.blockedRowCount > 0 ? (
            <Notice role="alert" tone="warning">
              <strong>{t("Resolve")}{initialImportPreviewSummary.blockedRowCount} {initialImportPreviewSummary.blockedRowCount === 1 ? "row" : "rows"}{t("before import")}</strong>
              <p>{t("No catalog candidate or destination is selected silently. Every blocker has a decision control in stage 8 below.")}</p>
            </Notice>
          ) : (
            <Notice role="status" tone="success">{t("All rows were resolved directly from the source file and synchronized cellar data.")}</Notice>
          )}

          <details className="import-all-preview-rows">
            <summary>{t("Review the complete first preview (")}{displayedInitialPreviewRows.length} {displayedInitialPreviewRows.length === 1 ? "row" : "rows"})
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
              <h2 id="resolution-heading">{t("8. Resolve import issues")}</h2>
              <p>{t("Choose only the decisions the source file could not make safely. Selections update the second preview without writing bottles. Creating a destination explicitly saves only its cellar setup.")}</p>
            </div>
            <span className="import-section-heading__status">
              {resolutionIsComplete
                ? "All issues resolved"
                : `${resolvedImportPreviewSummary.blockedRowCount} ${resolvedImportPreviewSummary.blockedRowCount === 1 ? "row remains" : "rows remain"}`}
            </span>
          </div>

          <ImportStorageGroups
            key={fileInputKey}
            results={resolvedImport.storageResults}
            snapshot={{ cellars: storageCellars, locations: storageLocations }}
            householdId={householdId}
            disabled={importIsLocked}
            isOnline={isOnline}
            onBusy={setDestinationIsCreating}
            onAssign={(assignments) => {
              resetCommitState()
              setResolutionSelections((current) => ({
                ...current, locationIdByRecord: { ...current.locationIdByRecord, ...assignments },
              }))
            }}
          />

          {rowsNeedingResolution.length === 0 ? (
            <Notice role="status" tone="success">{t("No manual decisions are required. The resolved preview is ready for review.")}</Notice>
          ) : (
            <details className="import-storage-details" open={rowsNeedingResolution.some((row) => row.wineMatch?.classification === "ambiguous")}>
              <summary>{t("Review individual rows and exceptions (")}{rowsNeedingResolution.length})</summary>
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
                        <span>{t("Source record")}{recordNumber}
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
                        <legend>{t("Catalog reference")}</legend>
                        <p>{t("Choose the existing wine represented by this source row.")}</p>
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
                                    {candidate.area ?? "No area"}{t(" ")}{t("· Reference")}{t(" ")}{candidate.id}
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
                        <span>{t("Destination")}</span>
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
                          <option value="">{t("Choose an active location")}</option>
                          {storageOptions.map(
                            ({ cellar, location }) => (
                              <option
                                key={location.id}
                                value={location.id}
                              >
                                {cellar.name} / {location.code} · {location.bottle_count}{t(" ")}{t("current · capacity")}{t(" ")}{location.capacity ?? "not set"}
                              </option>
                            ),
                          )}
                        </select>
                        <small>{t("Source value:")}{result.row.fields.cellar ?? "Empty"} / {result.row.fields.location ?? "Empty"}
                        </small>
                      </label>
                    ) : null}
                  </article>
                )
              })}
            </div>
            </details>
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
              <h2 id="resolved-preview-heading">{t("9. Review the resolved preview")}</h2>
              <p>{t("Confirm the final wine, destination, and quantity plan produced after issue resolution. The next stage writes this complete plan as one transaction.")}</p>
            </div>
            <span className="import-section-heading__status">
              {resolutionIsComplete
                ? `${resolvedImportPreviewSummary.readyBottleCount} bottles ready`
                : `${resolvedImportPreviewSummary.blockedRowCount} blocked`}
            </span>
          </div>

          <div
            aria-label={t("Resolved import preview summary")}
            className="import-final-preview-summary"
          >
            <div>
              <strong>{resolvedImportPreviewSummary.totalBottleCount}</strong>
              <span>{t("Total bottles")}</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.readyBottleCount}</strong>
              <span>{t("Ready bottles")}</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.newWineCount}</strong>
              <span>{t("New wines")}</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.existingWineCount}</strong>
              <span>{t("Existing wines")}</span>
            </div>
            <div>
              <strong>{resolvedImportPreviewSummary.destinationCount}</strong>
              <span>{t("Destinations")}</span>
            </div>
            {resolvedImportPreviewSummary.catalogOnlyRowCount > 0 ? <div>
              <strong>{resolvedImportPreviewSummary.catalogOnlyRowCount}</strong>
              <span>{t("Catalog-only rows · no stock change")}</span>
            </div> : null}
            <div>
              <strong>{resolvedImportPreviewSummary.blockedRowCount}</strong>
              <span>{t("Blocked rows")}</span>
            </div>
          </div>

          {resolutionIsComplete ? (
            <Notice role="status" tone="success">
              <strong>{t("The resolved import plan is complete")}</strong>
              <p>{t("Review the compact rows below. No bottles have been imported.")}</p>
            </Notice>
          ) : (
            <Notice role="alert" tone="warning">{t("Complete every decision in stage 8 before import can proceed.")}</Notice>
          )}

          {resolvedImportPreviewSummary.warningLocationCount > 0 ? (
            <Notice role="status" tone="warning">
              {resolvedImportPreviewSummary.warningLocationCount}{t(" ")}{t("destination")}{t(" ")}{resolvedImportPreviewSummary.warningLocationCount === 1 ? "has" : "have"}{t("an advisory capacity warning. These rows remain ready.")}</Notice>
          ) : null}

          <p className="import-final-preview-display-note">{t("Showing")}{displayedResolvedPreviewRows.length}{t(" ")}{t("of")}{t(" ")}{resolvedImportPreviewSummary.totalRowCount}{t("rows. Blockers and warnings appear first; details stay collapsed by default.")}</p>

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
            <h2 id="import-result-heading">{t("10. Confirm and import")}</h2>
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
              <strong>{t("Import cannot continue yet")}</strong>
              <p>{commitError}</p>
              {commitPlan ? (
                <p>{t("The original receipt is locked. Retry this same plan so a lost response cannot add the import twice.")}</p>
              ) : null}
            </Notice>
          ) : null}

          {confirmationIsOpen && commitPlan ? (
            <div className="import-confirmation">
              <div>
                <h3>{t("Final confirmation")}</h3>
                <p>{t("This will add")} {commitPlan.rows.reduce((total, row) => total + row.quantity, 0)} {commitPlan.rows.reduce((total, row) => total + row.quantity, 0) === 1 ? t("bottle") : t("bottles")} {t("across")} {commitPlan.rows.length} {t("source")} {commitPlan.rows.length === 1 ? t("row") : t("rows")}{t(". It may create")} {new Set(commitPlan.rows.filter((row) => row.wineAction === "create").map((row) => row.requestedWineId)).size} {t("catalog")} {new Set(commitPlan.rows.filter((row) => row.wineAction === "create").map((row) => row.requestedWineId)).size === 1 ? t("wine") : t("wines")}.
                </p>
                {commitPlan.rows.some((row) => row.quantity === 0) ? <p>{commitPlan.rows.filter((row) => row.quantity === 0).length}{t(" ")}{t("catalog-only rows add or match wines without adding bottles or changing existing stock.")}</p> : null}
                <p>
                  {excludedRecords.size} {t("source rows are excluded. The included batch succeeds or rolls back. It does not replace or remove existing bottles.")}</p>
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
                <span>{t("I reviewed the wines, destinations, quantities, and any capacity warnings above.")}</span>
              </label>

              <div className="import-confirmation__actions">
                <button
                  disabled={isCommitting}
                  onClick={() => {
                    setConfirmationIsOpen(false)
                    setConfirmationAccepted(false)
                  }}
                  type="button"
                >{t("Back to preview")}</button>
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
                      : commitPlan.rows.every((row) => row.quantity === 0) ? "Import catalog wines"
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
            <h2 id="import-complete-heading">{t("Import complete")}</h2>
            <p>{t("The complete spreadsheet batch was committed. Inventory and catalog views will update as synchronization arrives.")}</p>
          </div>

          <Notice role="status" tone="success">
            <strong>
              {commitResult.importedBottleCount} {commitResult.importedBottleCount === 1 ? "bottle" : "bottles"}{t("imported")}</strong>
            <p>
              {commitResult.importedRowCount}{t(" ")}{t("source")}{t(" ")}{commitResult.importedRowCount === 1 ? "row" : "rows"} · {commitResult.createdWineCount}{t(" ")}{t("new")}{t(" ")}{commitResult.createdWineCount === 1 ? "wine" : "wines"} · {commitResult.reusedWineCount}{t(" ")}{t("reused")}{t(" ")}{commitResult.reusedWineCount === 1 ? "wine" : "wines"}
            </p>
          </Notice>

          <dl className="import-complete-panel__receipt">
            <div>
              <dt>{t("Import receipt")}</dt>
              <dd>{commitResult.importId}</dd>
            </div>
            <div>
              <dt>{t("File")}</dt>
              <dd>{fileName ?? "Spreadsheet import"}</dd>
            </div>
          </dl>

          <button onClick={resetImport} type="button">{t("Import another file")}</button>
        </section>
      ) : null}
        </>
      )}
    </main>
  )
}
