// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HoldingsView } from "./HoldingsView"
import type { RegisteredDevicesState } from "../devices/useRegisteredDevices"
import { queueAdd, queueMove } from "../data/powersync/inventoryOperations"

const queryData = vi.hoisted(() => ({
  wines: [] as Array<Record<string, unknown>>,
  locations: [] as Array<Record<string, unknown>>,
  holdings: [] as Array<Record<string, unknown>>,
}))

vi.mock("@powersync/react", () => ({
  useQuery: (sql: string) => ({
    data: sql.includes("from wines") ? queryData.wines
      : sql.includes("from locations") ? queryData.locations
        : sql.includes("from holdings") ? queryData.holdings : [],
    error: null, isLoading: false, isFetching: false,
  }),
}))
vi.mock("../data/powersync/inventoryOperations", () => ({
  queueAdd: vi.fn(), queueMove: vi.fn(), queueRemove: vi.fn(),
}))
vi.mock("./CapturePhotosPanel", () => ({ CapturePhotosPanel: ({ onUseReviewedDetails, completedSessionIds = [] }: {
  completedSessionIds?: string[]
  onUseReviewedDetails: (details: {
    captureSessionId: string; wineId?: string; producer: string; cuvee: string; vintage: number | null; color: string;
    appellation: string; area: string; formatMl: number | null;
  }) => void
}) => <div data-testid="photo-panel" data-completed={completedSessionIds.join(",")}>
  Photo panel
  {!completedSessionIds.includes("capture-1") ? <button type="button" onClick={() => onUseReviewedDetails({
    captureSessionId: "capture-1", wineId: "saved-wine", producer: "Domaine Barraud",
    cuvee: "En France", vintage: 2019, color: "white", appellation: "Pouilly-Fuissé",
    area: "Bourgogne", formatMl: 750,
  })}>Choose saved label wine</button> : null}
  <button type="button" onClick={() => onUseReviewedDetails({
    captureSessionId: "capture-1", producer: "Domaine Barraud", cuvee: "En France", vintage: 2020,
    color: "white", appellation: "Pouilly-Fuissé", area: "Bourgogne", formatMl: 750,
  })}>Use reviewed label details</button>
  <button type="button" onClick={() => onUseReviewedDetails({
    captureSessionId: "capture-1", producer: "Domaine Barraud", cuvee: "En France", vintage: 2020,
    color: "white", appellation: "Pouilly-Fuissé", area: "Bourgogne", formatMl: null,
  })}>Use label without format</button>
  {completedSessionIds.includes("capture-1") ? <button type="button" onClick={() => onUseReviewedDetails({
    captureSessionId: "capture-2", wineId: "second-wine", producer: "Jean-Marc Burgaud",
    cuvee: "Côte du Py", vintage: 2011, color: "red", appellation: "Morgon",
    area: "Beaujolais", formatMl: 750,
  })}>Choose next label wine</button> : null}
</div> }))
vi.mock("./LocationQrScanner", () => ({ LocationQrScanner: ({ onScanned }: { onScanned: (locationId: string) => void }) => (
  <button type="button" onClick={() => onScanned("location-2")}>Scan location 2</button>
) }))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(queueAdd).mockReset()
  vi.mocked(queueAdd).mockResolvedValue("operation-1")
  vi.mocked(queueMove).mockReset()
  queryData.wines = []
  queryData.locations = []
  queryData.holdings = []
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}

describe("add-bottles entry mode", () => {
  it("selects an active scanned location without queuing stock", async () => {
    queryData.locations = [
      { id: "location-1", household_id: "household-1", cellar_id: "cellar-1", cellar_name: "Home", code: "A1" },
      { id: "location-2", household_id: "household-1", cellar_id: "cellar-2", cellar_name: "Service", code: "B2" },
    ]
    await act(async () => root.render(
      <HoldingsView userId="owner-1" householdId="household-1" isOnline canManageInventory
        deviceRegistration={{ deviceIdByHousehold: { "household-1": "device-1" } } as RegisteredDevicesState}
        onOpenWine={() => undefined} />,
    ))
    await click("Scan a location QR code")
    await click("Scan location 2")
    expect(container.textContent).toContain("Location selected: Service / B2")
    expect([...container.querySelectorAll<HTMLSelectElement>(".inventory-filters select")].at(-1)?.value).toBe("location-2")
    await click("Enter details manually")
    expect([...container.querySelectorAll<HTMLSelectElement>(".add-bottles-form select")].at(-1)?.value).toBe("location-2")
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it("uses a scanned destination in a Move form without moving stock", async () => {
    queryData.locations = [
      { id: "location-1", household_id: "household-1", cellar_id: "cellar-1", cellar_name: "Home", code: "A1" },
      { id: "location-2", household_id: "household-1", cellar_id: "cellar-2", cellar_name: "Service", code: "B2" },
    ]
    queryData.holdings = [{ id: "holding-1", household_id: "household-1", wine_id: "wine-1", location_id: "location-1",
      producer: "Domaine Barraud", cuvee: "En France", vintage: 2019, color: "white", appellation: "Pouilly-Fuissé",
      area: "Bourgogne", format_ml: 750, location_code: "A1", quantity: 2, revision: 1 }]
    await act(async () => root.render(
      <HoldingsView userId="owner-1" householdId="household-1" isOnline canManageInventory
        deviceRegistration={{ deviceIdByHousehold: { "household-1": "device-1" } } as RegisteredDevicesState}
        onOpenWine={() => undefined} />,
    ))
    await click("Move")
    await click("Scan destination QR")
    await click("Scan location 2")
    expect(container.querySelector<HTMLSelectElement>(".inventory-action-form select")?.value).toBe("location-2")
    expect(queueMove).not.toHaveBeenCalled()
  })

  it("keeps photo and manual entry separate until the Owner chooses one", async () => {
    await act(async () => root.render(
      <HoldingsView
        userId="owner-1"
        householdId="household-1"
        isOnline
        canManageInventory
        deviceRegistration={{ deviceIdByHousehold: {} } as RegisteredDevicesState}
        onOpenWine={() => undefined}
      />,
    ))
    const panel = container.querySelector(".inventory-add-panel")!
    expect(panel.textContent).toContain("Choose how to add bottles")
    expect(panel.querySelector(".add-bottles-form")).toBeNull()
    expect(panel.querySelector('[data-testid="photo-panel"]')).toBeNull()

    await click("Use a label photo")
    expect(panel.querySelector('[data-testid="photo-panel"]')).not.toBeNull()
    expect(panel.querySelector(".add-bottles-form")).toBeNull()

    await click("Change entry method")
    await click("Enter details manually")
    expect(panel.querySelector(".add-bottles-form")).not.toBeNull()
    expect(panel.querySelector('[data-testid="photo-panel"]')).toBeNull()
  })

  it("keeps the explicitly selected catalogue wine through the stock confirmation", async () => {
    const saved = { id: "saved-wine", household_id: "household-1", producer: "Domaine Barraud",
      cuvee: "En France", vintage: 2019, color: "white", appellation: "Pouilly-Fuissé",
      area: "Bourgogne", format_ml: 750 }
    queryData.wines = [saved, { ...saved, id: "duplicate-wine" }]
    queryData.locations = [{ id: "location-1", household_id: "household-1", cellar_id: "cellar-1",
      cellar_name: "Home", code: "A1" }]
    await act(async () => root.render(
      <HoldingsView userId="owner-1" householdId="household-1" isOnline canManageInventory
        deviceRegistration={{ deviceIdByHousehold: { "household-1": "device-1" } } as RegisteredDevicesState}
        onOpenWine={() => undefined} />,
    ))
    await click("Use a label photo")
    await click("Choose saved label wine")
    const form = container.querySelector<HTMLFormElement>(".add-bottles-form")!
    expect(form.querySelectorAll('.capture-wine-target input[type="radio"]')).toHaveLength(2)
    expect(form.querySelector<HTMLInputElement>('.capture-wine-target input[type="radio"]')?.checked).toBe(true)
    await click("Add bottles")
    expect(queueAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      wineId: "saved-wine", householdId: "household-1", destinationLocationId: "location-1", quantity: 1,
    }))
    expect(vi.mocked(queueAdd).mock.calls[0][0]).not.toHaveProperty("wineProducer")
  })

  it("requires explicit new-wine confirmation after reviewed photo details", async () => {
    queryData.locations = [{ id: "location-1", household_id: "household-1", cellar_id: "cellar-1",
      cellar_name: "Home", code: "A1" }]
    await act(async () => root.render(
      <HoldingsView userId="owner-1" householdId="household-1" isOnline canManageInventory
        deviceRegistration={{ deviceIdByHousehold: { "household-1": "device-1" } } as RegisteredDevicesState}
        onOpenWine={() => undefined} />,
    ))
    await click("Use a label photo")
    await click("Use reviewed label details")
    const addButton = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Add bottles")!
    expect(addButton.disabled).toBe(true)
    expect(queueAdd).not.toHaveBeenCalled()
    const createChoice = container.querySelector<HTMLInputElement>('.capture-wine-target input[type="radio"]')!
    await act(async () => createChoice.click())
    expect(addButton.disabled).toBe(false)
    await click("Add bottles")
    expect(queueAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      wineProducer: "Domaine Barraud", wineCuvee: "En France", wineVintage: 2020,
      wineColor: "white", quantity: 1,
    }))
  })

  it("does not silently select an exact catalogue wine from reviewed label fields", async () => {
    queryData.wines = [{ id: "saved-wine", household_id: "household-1", producer: "Domaine Barraud",
      cuvee: "En France", vintage: 2020, color: "white", appellation: "Pouilly-Fuissé",
      area: "Bourgogne", format_ml: 750 }]
    queryData.locations = [{ id: "location-1", household_id: "household-1", cellar_id: "cellar-1",
      cellar_name: "Home", code: "A1" }]
    await act(async () => root.render(
      <HoldingsView userId="owner-1" householdId="household-1" isOnline canManageInventory
        deviceRegistration={{ deviceIdByHousehold: { "household-1": "device-1" } } as RegisteredDevicesState}
        onOpenWine={() => undefined} />,
    ))
    await click("Use a label photo")
    await click("Use reviewed label details")
    const addButton = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Add bottles")!
    const existingChoice = container.querySelector<HTMLInputElement>('.capture-wine-target input[type="radio"]')!
    expect(existingChoice.checked).toBe(false)
    expect(addButton.disabled).toBe(true)
    await act(async () => existingChoice.click())
    await click("Add bottles")
    expect(queueAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ wineId: "saved-wine" }))
  })

  it("does not reuse a previous bottle format when the label did not identify one", async () => {
    queryData.locations = [{ id: "location-1", household_id: "household-1", cellar_id: "cellar-1",
      cellar_name: "Home", code: "A1" }]
    await act(async () => root.render(
      <HoldingsView userId="owner-1" householdId="household-1" isOnline canManageInventory
        deviceRegistration={{ deviceIdByHousehold: { "household-1": "device-1" } } as RegisteredDevicesState}
        onOpenWine={() => undefined} />,
    ))
    await click("Use a label photo")
    await click("Use label without format")
    const format = [...container.querySelectorAll<HTMLInputElement>('.add-bottles-form input[type="number"]')]
      .find((input) => input.closest("label")?.textContent?.includes("Bottle format"))!
    expect(format.value).toBe("")
    expect([...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Add bottles")?.disabled).toBe(true)
  })

  it("continues with the next distinct label after each confirmed ADD", async () => {
    queryData.wines = [
      { id: "saved-wine", household_id: "household-1", producer: "Domaine Barraud",
        cuvee: "En France", vintage: 2019, color: "white", appellation: "Pouilly-Fuissé",
        area: "Bourgogne", format_ml: 750 },
      { id: "second-wine", household_id: "household-1", producer: "Jean-Marc Burgaud",
        cuvee: "Côte du Py", vintage: 2011, color: "red", appellation: "Morgon",
        area: "Beaujolais", format_ml: 750 },
    ]
    queryData.locations = [{ id: "location-1", household_id: "household-1", cellar_id: "cellar-1",
      cellar_name: "Home", code: "A1" }]
    await act(async () => root.render(
      <HoldingsView userId="owner-1" householdId="household-1" isOnline canManageInventory
        deviceRegistration={{ deviceIdByHousehold: { "household-1": "device-1" } } as RegisteredDevicesState}
        onOpenWine={() => undefined} />,
    ))
    await click("Use a label photo")
    await click("Choose saved label wine")
    await click("Add bottles")
    expect(container.querySelector(".add-bottles-form")).toBeNull()
    expect(container.querySelector('[data-testid="photo-panel"]')?.getAttribute("data-completed")).toBe("capture-1")
    expect(container.textContent).toContain("Additions queued in this batch: 1")

    await click("Choose next label wine")
    await click("Add bottles")
    expect(container.querySelector('[data-testid="photo-panel"]')?.getAttribute("data-completed")).toBe("capture-1,capture-2")
    expect(container.textContent).toContain("Additions queued in this batch: 2")
    expect(vi.mocked(queueAdd).mock.calls.map(([input]) => input.wineId)).toEqual(["saved-wine", "second-wine"])
    await click("Finish for now")
    expect(container.querySelector('[data-testid="photo-panel"]')).toBeNull()
  })

  it("keeps the reviewed wine in the form if queuing its ADD fails", async () => {
    vi.mocked(queueAdd).mockRejectedValueOnce(new Error("queue unavailable"))
    queryData.wines = [{ id: "saved-wine", household_id: "household-1", producer: "Domaine Barraud",
      cuvee: "En France", vintage: 2019, color: "white", appellation: "Pouilly-Fuissé",
      area: "Bourgogne", format_ml: 750 }]
    queryData.locations = [{ id: "location-1", household_id: "household-1", cellar_id: "cellar-1",
      cellar_name: "Home", code: "A1" }]
    await act(async () => root.render(
      <HoldingsView userId="owner-1" householdId="household-1" isOnline canManageInventory
        deviceRegistration={{ deviceIdByHousehold: { "household-1": "device-1" } } as RegisteredDevicesState}
        onOpenWine={() => undefined} />,
    ))
    await click("Use a label photo")
    await click("Choose saved label wine")
    await click("Add bottles")
    expect(container.querySelector(".add-bottles-form")).not.toBeNull()
    expect(container.querySelector('[data-testid="photo-panel"]')).toBeNull()
    expect(container.textContent).toContain("queue unavailable")
    expect(container.textContent).not.toContain("Additions queued in this batch")
  })
})
