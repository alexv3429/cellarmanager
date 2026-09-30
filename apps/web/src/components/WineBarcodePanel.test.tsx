// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { findWineBarcodeLinks, linkWineBarcode, lookupBarcodeProduct } from "../data/wineBarcodes"
import { WineBarcodePanel } from "./WineBarcodePanel"

vi.mock("../data/wineBarcodes", async () => {
  const { normalizeGtin } = await import("../data/gtin")
  return { normalizeGtin, findWineBarcodeLinks: vi.fn(), linkWineBarcode: vi.fn(), unlinkWineBarcode: vi.fn(), lookupBarcodeProduct: vi.fn() }
})
vi.mock("./WineBarcodeScanner", () => ({ WineBarcodeScanner: () => <div>Camera scanner</div> }))

const householdId = "e4098b45-289a-41d7-9650-51311376976c"
const wine = { id: "e706fd88-afca-4f05-94fa-5671c61cb61b", household_id: householdId,
  producer: "Domaine Barraud", cuvee: "En France", vintage: 2019, color: "white",
  appellation: "Pouilly-Fuissé", area: "Bourgogne", format_ml: 750 }

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(findWineBarcodeLinks).mockReset()
  vi.mocked(linkWineBarcode).mockReset()
  vi.mocked(lookupBarcodeProduct).mockReset()
  vi.mocked(findWineBarcodeLinks).mockResolvedValue([{ id: "link", wineId: wine.id, gtin14: "00036000291452" }])
  vi.mocked(lookupBarcodeProduct).mockResolvedValue(null)
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
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label)
  expect(button, `Missing button ${label}`).toBeTruthy()
  await act(async () => button?.click())
}

describe("wine barcode lookup", () => {
  it("finds saved wine links without contacting the external provider or changing stock", async () => {
    const onOpenWine = vi.fn()
    const onUseWine = vi.fn()
    await act(async () => root.render(<WineBarcodePanel householdId={householdId} wines={[wine]}
      isOnline canManageInventory onOpenWine={onOpenWine} onUseWine={onUseWine} />))
    const input = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')
    await act(async () => {
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "036000291452")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Find in my catalogue")
    expect(findWineBarcodeLinks).toHaveBeenCalledWith(householdId, "00036000291452")
    expect(lookupBarcodeProduct).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Domaine Barraud")
    expect(onOpenWine).not.toHaveBeenCalled()
    expect(onUseWine).not.toHaveBeenCalled()
    await click("Open wine card")
    expect(onOpenWine).toHaveBeenCalledExactlyOnceWith(wine.id)
    await click("Check Open Food Facts")
    expect(lookupBarcodeProduct).toHaveBeenCalledWith("00036000291452")
  })

  it("checks Open Food Facts directly from valid manually entered digits", async () => {
    vi.mocked(findWineBarcodeLinks).mockResolvedValue([])
    await act(async () => root.render(<WineBarcodePanel householdId={householdId} wines={[wine]}
      isOnline canManageInventory onOpenWine={() => undefined} onUseWine={() => undefined} />))
    const input = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "5999557600120")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Check Open Food Facts")
    expect(findWineBarcodeLinks).toHaveBeenCalledWith(householdId, "05999557600120")
    expect(lookupBarcodeProduct).toHaveBeenCalledExactlyOnceWith("05999557600120")
    expect(container.textContent).toContain("Open Food Facts has no entry")
  })

  it("requires explicit wine selection before saving a code link", async () => {
    vi.mocked(findWineBarcodeLinks).mockResolvedValue([])
    vi.mocked(linkWineBarcode).mockResolvedValue(undefined)
    await act(async () => root.render(<WineBarcodePanel householdId={householdId} wines={[wine]}
      isOnline canManageInventory onOpenWine={() => undefined} onUseWine={() => undefined} />))
    const input = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "036000291452")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Find in my catalogue")
    expect(linkWineBarcode).not.toHaveBeenCalled()
    const search = [...container.querySelectorAll("input")].find((item) => item.placeholder === "Producer, cuvée, or appellation")
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "pouilly fuisse")
      search?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const radio = container.querySelector<HTMLInputElement>('input[type="radio"]')
    expect(radio).not.toBeNull()
    await act(async () => radio?.click())
    await click("Confirm barcode link")
    expect(linkWineBarcode).toHaveBeenCalledExactlyOnceWith(householdId, wine.id, "00036000291452")
  })

  it("explains a failed online lookup and lets the user retry", async () => {
    vi.mocked(findWineBarcodeLinks).mockResolvedValue([])
    vi.mocked(lookupBarcodeProduct).mockRejectedValueOnce(new Error("barcode_authentication_required"))
    await act(async () => root.render(<WineBarcodePanel householdId={householdId} wines={[wine]}
      isOnline canManageInventory onOpenWine={() => undefined} onUseWine={() => undefined} />))
    const input = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "036000291452")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Find in my catalogue")
    await click("Check Open Food Facts")
    expect(container.textContent).toContain("could not verify your session")
    await click("Retry Open Food Facts")
    expect(lookupBarcodeProduct).toHaveBeenCalledTimes(2)
  })

  it("makes an absent catalogue wine explicit instead of leaving a disabled link button unexplained", async () => {
    vi.mocked(findWineBarcodeLinks).mockResolvedValue([])
    await act(async () => root.render(<WineBarcodePanel householdId={householdId} wines={[wine]}
      isOnline canManageInventory onOpenWine={() => undefined} onUseWine={() => undefined} />))
    const input = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "036000291452")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Find in my catalogue")
    const search = [...container.querySelectorAll("input")].find((item) => item.placeholder === "Producer, cuvée, or appellation")
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "Campo della Pieve")
      search?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(container.textContent).toContain("No matching wine in this catalogue")
  })
})
