// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HoldingsView } from "./HoldingsView"
import type { RegisteredDevicesState } from "../devices/useRegisteredDevices"

vi.mock("@powersync/react", () => ({
  useQuery: () => ({ data: [], error: null, isLoading: false, isFetching: false }),
}))
vi.mock("../data/powersync/inventoryOperations", () => ({
  queueAdd: vi.fn(), queueMove: vi.fn(), queueRemove: vi.fn(),
}))
vi.mock("./CapturePhotosPanel", () => ({ CapturePhotosPanel: () => <div data-testid="photo-panel">Photo panel</div> }))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
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
})
