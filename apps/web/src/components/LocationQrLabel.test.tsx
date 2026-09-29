// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LocationQrLabel } from "./LocationQrLabel"

const qr = vi.hoisted(() => ({ toString: vi.fn(async () => "<svg xmlns=\"http://www.w3.org/2000/svg\" />") }))
vi.mock("qrcode", () => ({ toString: qr.toString }))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("print", vi.fn())
  qr.toString.mockClear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("location QR label", () => {
  it("prints a location-specific code and visible names", async () => {
    await act(async () => root.render(
      <LocationQrLabel
        householdId="e4098b45-289a-41d7-9650-51311376976c"
        locationId="e706fd88-afca-4f05-94fa-5671c61cb61b"
        cellarName="Service"
        locationCode="Shelf B2"
        onClose={() => undefined}
      />,
    ))
    expect(qr.toString).toHaveBeenCalledWith(expect.stringMatching(/^CMLOC1:/), expect.objectContaining({ type: "svg" }))
    expect(container.textContent).toContain("Service")
    expect(container.textContent).toContain("Shelf B2")
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/)
    const print = [...container.querySelectorAll("button")].find((button) => button.textContent === "Print label")!
    await act(async () => print.click())
    expect(window.print).toHaveBeenCalledOnce()
  })
})
