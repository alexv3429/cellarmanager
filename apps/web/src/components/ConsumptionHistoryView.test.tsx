// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConsumptionLegacyRow, ConsumptionOperationRow } from "../data/consumptionHistory"
import { LanguageContext } from "../i18n/LanguageContext"
import { translate } from "../i18n/messages"
import { ConsumptionHistoryView } from "./ConsumptionHistoryView"

const query = vi.hoisted(() => ({
  operations: [] as ConsumptionOperationRow[],
  legacy: [] as ConsumptionLegacyRow[],
}))
vi.mock("@powersync/react", () => ({ useQuery: (sql: string) => ({
  data: sql.includes("legacy_inventory_events") ? query.legacy : query.operations,
  error: null,
  isLoading: false,
}) }))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.setSystemTime(new Date("2026-10-02T15:00:00Z"))
  query.operations = [{
    id: "drink-1", household_id: "home", wine_id: "wine-1", catalog_wine_id: "wine-1",
    producer: "Domaine Barraud", cuvee: "En France", vintage: 2019,
    operation_type: "REMOVE", quantity: 2, remove_reason: "DRANK", status: "ACCEPTED",
    created_at_client: "2026-09-30T12:00:00Z", received_at_server: "2026-09-30T12:00:10Z",
    source_cellar_name: "Service", source_code: "A1",
  }]
  query.legacy = []
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

describe("consumption history screen", () => {
  it("shows a French, read-only list and opens the selected wine", async () => {
    const onOpenWine = vi.fn()
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><ConsumptionHistoryView householdId="home" period="30d" onOpenWine={onOpenWine} /></LanguageContext.Provider>))
    expect(container.textContent).toContain("Historique de consommation")
    expect(container.textContent).toContain("2 bouteilles déclarées bues · 1 vin")
    expect(container.textContent).toContain("Domaine Barraud · En France · 2019")
    expect(container.textContent).toContain("Depuis Service / A1")
    const wine = container.querySelector<HTMLButtonElement>(".consumption-history__wine")
    expect(wine).not.toBeNull()
    await act(async () => wine?.click())
    expect(onOpenWine).toHaveBeenCalledWith("wine-1")
  })

  it("allows switching from the selected period to all recorded history", async () => {
    query.operations[0].created_at_client = "2025-07-01T12:00:00Z"
    await act(async () => root.render(<ConsumptionHistoryView householdId="home" period="30d" onOpenWine={() => undefined} />))
    expect(container.textContent).toContain("No bottles recorded as drunk in this period")
    const allTime = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "All recorded history")
    await act(async () => allTime?.click())
    expect(container.textContent).toContain("Domaine Barraud")
  })
})
