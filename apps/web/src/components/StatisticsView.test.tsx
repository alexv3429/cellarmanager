// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { InsightsLegacyRow, InsightsOperationRow } from "../data/inventoryInsights"
import { LanguageContext } from "../i18n/LanguageContext"
import { translate } from "../i18n/messages"
import { StatisticsView } from "./StatisticsView"

const query = vi.hoisted(() => ({
  stock: 12,
  stockRows: [] as { household_id: string; quantity: number; color: string; area: string }[],
  operations: [] as InsightsOperationRow[],
  legacy: [] as InsightsLegacyRow[],
}))
vi.mock("@powersync/react", () => ({ useQuery: (sql: string) => ({
  data: sql.includes("from holdings") ? (query.stockRows.length > 0 ? query.stockRows
    : [{ household_id: "home", quantity: query.stock, color: "red", area: "Bourgogne" }])
    : sql.includes("from legacy_inventory_events") ? query.legacy : query.operations,
  error: null,
  isLoading: false,
}) }))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.setSystemTime(new Date("2026-10-02T15:00:00Z"))
  query.stock = 12
  query.stockRows = []
  query.operations = [{
    household_id: "home", operation_type: "ADD", quantity: 2, remove_reason: null,
    status: "ACCEPTED", created_at_client: "2026-09-30T12:00:00Z",
    received_at_server: "2026-09-30T12:00:10Z",
    color: "red", area: "Bourgogne",
  }]
  query.legacy = [{
    household_id: "home", archive_source_sha256: "archive", event_type: "OPENING_BALANCE",
    quantity: 10, remove_reason: null, occurred_at: "2025-01-01T10:00:00Z",
  }]
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("statistics screen", () => {
  it("shows confirmed movement totals and reconciled stock history in French", async () => {
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><StatisticsView householdId="home" onOpenWine={() => undefined} /></LanguageContext.Provider>))
    expect(container.textContent).toContain("Vue d’ensemble")
    expect(container.textContent).toContain("Bouteilles aujourd’hui12")
    expect(container.textContent).toContain("Ajoutées2")
    expect(container.querySelector(".statistics-stock-plot")).not.toBeNull()
    expect(container.querySelectorAll(".statistics-flow-row")).toHaveLength(12)
    expect(container.textContent).toContain("n’est pas forcément un achat")
    expect(container.textContent).toContain("Par couleur")
    expect(container.textContent).toContain("Par région / secteur")
    expect(container.querySelector('table[aria-label="Par couleur"]')?.textContent).toContain("rouge12+2−0")
    expect(container.querySelector('table[aria-label="Par région / secteur"]')?.textContent).toContain("Bourgogne12+2−0")
  })

  it("keeps the confirmed flow but hides an unreliable stock curve", async () => {
    query.stock = 20
    await act(async () => root.render(<StatisticsView householdId="home" onOpenWine={() => undefined} />))
    expect(container.textContent).toContain("Bottles today20")
    expect(container.textContent).toContain("Added2")
    expect(container.querySelector(".statistics-stock-plot")).toBeNull()
    expect(container.textContent).toContain("A reliable stock history is not available yet")
  })

  it("keeps the region list compact until the reader asks for all regions", async () => {
    query.operations = []
    query.stockRows = Array.from({ length: 9 }, (_, index) => ({
      household_id: "home", quantity: 1, color: "red", area: `Region ${index + 1}`,
    }))
    await act(async () => root.render(<StatisticsView householdId="home" onOpenWine={() => undefined} />))
    expect(container.querySelectorAll('table[aria-label="By region / area"] tbody tr')).toHaveLength(8)
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Show all regions")
    await act(async () => button?.click())
    expect(container.querySelectorAll('table[aria-label="By region / area"] tbody tr')).toHaveLength(9)
  })
})
