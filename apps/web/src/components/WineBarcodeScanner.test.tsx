// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WineBarcodeScanner } from "./WineBarcodeScanner"

const scanner = vi.hoisted(() => ({
  callback: null as null | ((result: { getText: () => string; getBarcodeFormat: () => string }, error: unknown, controls: { stop: () => void }) => void),
  formats: [] as string[],
  stop: vi.fn(),
}))

vi.mock("@zxing/browser", () => ({
  BarcodeFormat: { EAN_13: "EAN_13", UPC_A: "UPC_A", EAN_8: "EAN_8" },
  BrowserMultiFormatReader: class {
    set possibleFormats(formats: string[]) { scanner.formats = formats }
    decodeFromVideoDevice(_device: unknown, _video: unknown, callback: typeof scanner.callback) {
      scanner.callback = callback
      return Promise.resolve({ stop: scanner.stop })
    }
  },
}))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } })
  scanner.callback = null
  scanner.formats = []
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

describe("wine barcode scanning", () => {
  it("ignores a partial EAN-8 and asks the user to confirm the full bottle code", async () => {
    const onScanned = vi.fn()
    await act(async () => root.render(<WineBarcodeScanner onScanned={onScanned} onClose={() => undefined} />))
    expect(scanner.formats).toEqual(["EAN_13", "UPC_A"])

    await act(async () => scanner.callback?.({ getText: () => "12417438", getBarcodeFormat: () => "EAN_8" }, null, { stop: scanner.stop }))
    expect(onScanned).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain("12417438")

    await act(async () => scanner.callback?.({ getText: () => "8033749750242", getBarcodeFormat: () => "EAN_13" }, null, { stop: scanner.stop }))
    expect(container.textContent).toContain("8033749750242")
    expect(onScanned).not.toHaveBeenCalled()
    const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent === "Use this code")
    await act(async () => confirm?.click())
    expect(onScanned).toHaveBeenCalledExactlyOnceWith("8033749750242")
  })
})
