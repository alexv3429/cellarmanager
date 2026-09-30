// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { encodeLocationQr } from "../data/locationQr"
import { LocationQrScanner } from "./LocationQrScanner"

const scanner = vi.hoisted(() => ({
  callback: null as null | ((result: { getText: () => string }, error: unknown, controls: { stop: () => void }) => void),
  stop: vi.fn(),
}))

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice(_device: unknown, _video: unknown, callback: typeof scanner.callback) {
      scanner.callback = callback
      return Promise.resolve({ stop: scanner.stop })
    }
  },
}))

const householdId = "e4098b45-289a-41d7-9650-51311376976c"
const otherHouseholdId = "ec70f460-57f6-4667-947d-cd214a02bf2f"
const locationId = "e706fd88-afca-4f05-94fa-5671c61cb61b"

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } })
  scanner.callback = null
  scanner.stop.mockReset()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("location QR scanning", () => {
  it("rejects other households and archived locations, then selects an active location once", async () => {
    const onScanned = vi.fn()
    await act(async () => root.render(
      <LocationQrScanner householdId={householdId} locationIds={[locationId]} onScanned={onScanned} onClose={() => undefined} />,
    ))
    expect(scanner.callback).not.toBeNull()

    const scan = async (code: string) => act(async () => scanner.callback?.({ getText: () => code }, null, { stop: scanner.stop }))
    await scan(encodeLocationQr({ householdId: otherHouseholdId, locationId }))
    expect(container.textContent).toContain("another household")
    expect(onScanned).not.toHaveBeenCalled()

    await scan(encodeLocationQr({ householdId, locationId: "6b5a18bd-853b-4074-8631-aed7743204bc" }))
    expect(container.textContent).toContain("not available")
    expect(onScanned).not.toHaveBeenCalled()

    await scan(encodeLocationQr({ householdId, locationId }))
    await scan(encodeLocationQr({ householdId, locationId }))
    expect(onScanned).toHaveBeenCalledExactlyOnceWith(locationId)
    expect(scanner.stop).toHaveBeenCalled()
  })
})
