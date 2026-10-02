// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageContext } from "../i18n/LanguageContext"
import { translate } from "../i18n/messages"
import { WineAcquisitionsPanel } from "./WineAcquisitionsPanel"

const service = vi.hoisted(() => ({ list: vi.fn(), legacy: vi.fn(), save: vi.fn(), remove: vi.fn() }))
vi.mock("../data/wineAcquisitions", async (importOriginal) => ({
  ...await importOriginal<typeof import("../data/wineAcquisitions")>(),
  listWineAcquisitions: service.list,
  listLegacyHoldingPrices: service.legacy,
  saveWineAcquisition: service.save,
  voidWineAcquisition: service.remove,
}))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  service.list.mockReset().mockResolvedValue([])
  service.legacy.mockReset().mockResolvedValue([])
  service.save.mockReset().mockResolvedValue(undefined)
  service.remove.mockReset().mockResolvedValue(undefined)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("wine acquisition panel", () => {
  it("shows paid and imported acquisition history in French", async () => {
    service.list.mockResolvedValueOnce([{
      id: "manual-1", household_id: "home", wine_id: "wine-1", acquisition_kind: "PURCHASE",
      quantity: 2, acquired_on: "2024-05-02", unit_price_amount: 12.5, price_currency: "EUR",
      source_name: "Caviste", note: null, source_kind: "MANUAL", created_at: "2026-10-02T00:00:00Z",
    }, {
      id: "legacy-1", household_id: "home", wine_id: "wine-1", acquisition_kind: "GIFT",
      quantity: 1, acquired_on: null, unit_price_amount: null, price_currency: null,
      source_name: null, note: null, source_kind: "LEGACY_V01", created_at: "2026-10-02T00:00:00Z",
    }])
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><WineAcquisitionsPanel householdId="home" isOnline wineId="wine-1" /></LanguageContext.Provider>))
    expect(container.textContent).toContain("Prix payé : 12,50 € par bouteille")
    expect(container.textContent).toContain("Historique importé · lecture seule")
    expect(container.querySelectorAll(".wine-acquisitions__list li")).toHaveLength(2)
    expect(container.querySelectorAll(".wine-acquisitions__list button")).toHaveLength(2)
    expect(container.textContent).toContain("Aucune bouteille n’est ajoutée")
  })

  it("records a manual acquisition without invoking an inventory operation", async () => {
    await act(async () => root.render(<WineAcquisitionsPanel householdId="home" isOnline wineId="wine-1" />))
    const form = container.querySelector("form")
    expect(form).not.toBeNull()
    await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(service.save).toHaveBeenCalledOnce()
    expect(service.save.mock.calls[0][1]).toBe("wine-1")
    expect(service.save.mock.calls[0][2]).toMatchObject({ kind: "PURCHASE", quantity: 1, unitPrice: null })
    expect(container.textContent).toContain("Acquisition recorded. Stock was not changed.")
  })

  it("labels old holding prices without inventing purchases or currency", async () => {
    service.legacy.mockResolvedValueOnce([{
      source_holding_id: "old-1", price_bought: "19.50", acquired_on: null,
    }])
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><WineAcquisitionsPanel householdId="home" isOnline wineId="wine-1" /></LanguageContext.Provider>))
    expect(container.textContent).toContain("19,50")
    expect(container.textContent).toContain("Devise et date non enregistrées")
    expect(container.textContent).not.toContain("19,50 €")
  })

  it("does not fetch or submit financial history offline", async () => {
    await act(async () => root.render(<WineAcquisitionsPanel householdId="home" isOnline={false} wineId="wine-1" />))
    expect(container.textContent).toContain("Connect to view or update acquisition records")
    expect(container.querySelector("form")).toBeNull()
    expect(service.list).not.toHaveBeenCalled()
    expect(service.legacy).not.toHaveBeenCalled()
  })
})
