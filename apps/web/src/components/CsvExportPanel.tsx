import { useQuery } from "@powersync/react"
import { useMemo, useState } from "react"

import {
  buildPortableCsvExport,
  createCsvExportRecords,
  getCsvExportFilename,
  getPortableExportFilename,
  type CsvExportHolding,
  type CsvExportLocation,
  type CsvExportWine,
} from "../data/csvExport"
import {
  projectHoldings,
  type AuthoritativeHolding,
  type InventoryOperation,
} from "../data/inventoryProjection"
import { getHouseholdMaturityOverview } from "../data/wineMaturity"
import { Notice } from "./Notice"

const EXPORT_WINES_QUERY = `
  select
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    country,
    classification,
    vineyard,
    grape_composition,
    sweetness_category,
    alcohol_percent,
    certifications,
    format_ml,
    wine_reference_id,
    wine_reference_type
  from wines
  where household_id = ?
    and merged_into_wine_id is null
  order by producer, cuvee, vintage, color, format_ml, id
`

const EXPORT_HOLDINGS_QUERY = `
  select
    h.id,
    h.household_id,
    h.wine_id,
    h.location_id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    w.appellation,
    w.area,
    w.format_ml,
    l.code as location_code,
    h.quantity,
    h.revision
  from holdings h
  join wines w on w.id = h.wine_id
  join locations l on l.id = h.location_id
  where h.household_id = ?
    and w.merged_into_wine_id is null
  order by w.producer, w.cuvee, w.vintage, l.code
`

const EXPORT_LOCATIONS_QUERY = `
  select
    l.id,
    l.household_id,
    l.code,
    c.name as cellar_name
  from locations l
  join cellars c on c.id = l.cellar_id
  where l.household_id = ?
  order by c.name, coalesce(l.display_order, 2147483647), l.code
`

const EXPORT_PENDING_OPERATIONS_QUERY = `
  select
    id,
    household_id,
    operation_type,
    wine_id,
    wine_producer,
    wine_cuvee,
    wine_vintage,
    wine_color,
    wine_appellation,
    wine_area,
    wine_format_ml,
    source_location_id,
    destination_location_id,
    quantity,
    status
  from inventory_operations
  where household_id = ?
    and status = 'PENDING'
    and operation_type in ('ADD', 'MOVE', 'REMOVE')
`

interface ExportLocationRow extends CsvExportLocation {
  household_id: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function downloadFile(
  contents: BlobPart,
  filename: string,
  type: string,
): void {
  const blob = new Blob([contents], {
    type,
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = filename
  link.href = url
  link.style.display = "none"
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function CsvExportPanel({
  householdId,
  isOnline,
}: {
  householdId: string
  isOnline: boolean
}) {
  const {
    data: wines,
    error: winesError,
    isLoading: winesLoading,
  } = useQuery<CsvExportWine>(
    EXPORT_WINES_QUERY,
    [householdId],
  )
  const {
    data: holdings,
    error: holdingsError,
    isLoading: holdingsLoading,
  } = useQuery<AuthoritativeHolding>(
    EXPORT_HOLDINGS_QUERY,
    [householdId],
  )
  const {
    data: locations,
    error: locationsError,
    isLoading: locationsLoading,
  } = useQuery<ExportLocationRow>(
    EXPORT_LOCATIONS_QUERY,
    [householdId],
  )
  const {
    data: pendingOperations,
    error: pendingOperationsError,
    isLoading: pendingOperationsLoading,
  } = useQuery<InventoryOperation>(
    EXPORT_PENDING_OPERATIONS_QUERY,
    [householdId],
  )

  const [includeZeroStockWines, setIncludeZeroStockWines] =
    useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [isExportingXlsx, setIsExportingXlsx] = useState(false)

  const projectedHoldings = useMemo(
    () =>
      projectHoldings({
        holdings,
        locations,
        operations: pendingOperations,
        wines,
      }),
    [holdings, locations, pendingOperations, wines],
  )

  const records = useMemo(
    () =>
      createCsvExportRecords(
        wines,
        projectedHoldings as CsvExportHolding[],
        locations,
        includeZeroStockWines,
      ),
    [
      includeZeroStockWines,
      locations,
      projectedHoldings,
      wines,
    ],
  )

  const bottleCount = records.reduce(
    (total, record) => total + record.quantity,
    0,
  )
  const positionCount = records.filter(
    (record) => record.quantity > 0,
  ).length
  const wineCount = new Set(
    records.map((record) => record.wine.id),
  ).size
  const zeroStockWineCount = wines.filter(
    (wine) =>
      !projectedHoldings.some(
        (holding) =>
          holding.wine_id === wine.id && holding.quantity > 0,
      ),
  ).length
  const queryError =
    winesError ??
    holdingsError ??
    locationsError ??
    pendingOperationsError
  const isLoading =
    winesLoading ||
    holdingsLoading ||
    locationsLoading ||
    pendingOperationsLoading

  function exportCsv() {
    setExportError(null)
    setExportMessage(null)

    try {
      const snapshot = buildPortableCsvExport(records)
      const filename = getCsvExportFilename()
      downloadFile(
        snapshot.csv,
        filename,
        "text/csv;charset=utf-8",
      )
      setExportMessage(
        `${filename} downloaded · ${snapshot.wineCount} wines · ${snapshot.bottleCount} bottles`,
      )
    } catch (caughtError: unknown) {
      setExportError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to create the CSV export",
      )
    }
  }

  async function exportXlsx() {
    setExportError(null)
    setExportMessage(null)
    setIsExportingXlsx(true)

    try {
      const { buildPortableXlsxExport, XLSX_MIME_TYPE } =
        await import("../data/xlsxTransfer")
      const maturityOverview = isOnline
        ? await getHouseholdMaturityOverview(householdId)
        : null
      const contents = await buildPortableXlsxExport(
        records,
        maturityOverview,
      )
      const filename = getPortableExportFilename("xlsx")
      downloadFile(contents, filename, XLSX_MIME_TYPE)
      setExportMessage(
        `${filename} downloaded · ${wineCount} wines · ${bottleCount} bottles${maturityOverview ? " · drinking windows included" : " · drinking windows omitted offline"}`,
      )
    } catch (caughtError: unknown) {
      setExportError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to create the Excel export",
      )
    } finally {
      setIsExportingXlsx(false)
    }
  }

  return (
    <section
      aria-labelledby="csv-export-heading"
      className="csv-export-panel"
    >
      <div className="csv-export-panel__heading">
        <div>
          <h2 id="csv-export-heading">Export cellar</h2>
          <p>
            Download a readable Excel workbook of your wines, bottle
            quantities, and storage locations. CSV remains available
            when you need it.
          </p>
        </div>
      </div>

      {queryError ? (
        <Notice role="alert" tone="error">
          Unable to prepare the export: {errorMessage(queryError)}
        </Notice>
      ) : null}

      <dl className="csv-export-panel__summary">
        <div>
          <dt>Wines</dt>
          <dd>{isLoading ? "…" : wineCount}</dd>
        </div>
        <div>
          <dt>Bottles</dt>
          <dd>{isLoading ? "…" : bottleCount}</dd>
        </div>
        <div>
          <dt>Positions</dt>
          <dd>{isLoading ? "…" : positionCount}</dd>
        </div>
        <div>
          <dt>Queued changes</dt>
          <dd>{isLoading ? "…" : pendingOperations.length}</dd>
        </div>
      </dl>

      <div className="csv-export-panel__controls">
        <label>
          <input
            checked={includeZeroStockWines}
            disabled={isLoading || Boolean(queryError)}
            onChange={(event) => {
              setIncludeZeroStockWines(event.target.checked)
              setExportMessage(null)
              setExportError(null)
            }}
            type="checkbox"
          />
          <span>
            <strong>
              Include {zeroStockWineCount} {zeroStockWineCount === 1 ? "wine" : "wines"} with no bottles
            </strong>
            <small>
              Useful for a complete catalog copy. Leave this off if you
              plan to import the file again.
            </small>
          </span>
        </label>

        <div className="csv-export-panel__actions">
          <button
            disabled={
              isLoading ||
              isExportingXlsx ||
              Boolean(queryError) ||
              records.length === 0
            }
            onClick={() => void exportXlsx()}
            type="button"
          >
            {isLoading || isExportingXlsx
              ? "Preparing Excel file…"
              : "Download Excel file"}
          </button>
          <button
            disabled={
              isLoading ||
              isExportingXlsx ||
              Boolean(queryError) ||
              records.length === 0
            }
            onClick={exportCsv}
            type="button"
          >
            Download CSV instead
          </button>
        </div>
      </div>

      <p className="csv-export-panel__note">
        The file can be created offline from the latest synchronized
        cellar, including queued changes. When connected, the Excel
        workbook also includes a dated snapshot of your current drinking
        windows. Rich wine details and confirmed reference IDs are
        retained as well.
      </p>

      {includeZeroStockWines ? (
        <Notice tone="warning">
          Wines with no bottles are included for catalog reference. They
          cannot be added by the spreadsheet importer until they have a
          positive quantity.
        </Notice>
      ) : null}

      {exportMessage ? (
        <Notice role="status" tone="success">
          {exportMessage}
        </Notice>
      ) : null}

      {exportError ? (
        <Notice role="alert" tone="error">
          {exportError}
        </Notice>
      ) : null}
    </section>
  )
}
