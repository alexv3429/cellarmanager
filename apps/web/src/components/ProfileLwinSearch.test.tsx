// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { reuseProfileLwin, searchProfileLwin } from "../data/drinkingWindowProfileExchange"
import { ProfileLwinSearch } from "./ProfileLwinSearch"

vi.mock("../data/drinkingWindowProfileExchange", () => ({ searchProfileLwin: vi.fn(), reuseProfileLwin: vi.fn() }))
vi.mock("../i18n/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = "" })

it("requires a reviewed LWIN identity before selecting the shared product", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(searchProfileLwin).mockResolvedValue([{ lwin7: "1195121", name: "Jacques Carillon Les Referts",
    producer: "Jacques Carillon", region: "Burgundy", appellation: "Puligny-Montrachet", site: "Les Referts", parcel: null,
    color: "White", classification: "Premier Cru" }])
  vi.mocked(reuseProfileLwin).mockResolvedValue("product-1")
  const onSelect = vi.fn(), host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ProfileLwinSearch profileId="profile" cuveeId="cuvee"
    producerId="producer" disabled={false} onSelect={onSelect} />))
  const button = (name: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(name))
  const set = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
      const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  await set(host.querySelector("input") as HTMLInputElement, "Referts")
  await act(async () => button("Search LWIN")?.click())
  await act(async () => button("1195121")?.click())
  expect(button("Reuse this LWIN wine")?.disabled).toBe(true)
  await set(host.querySelector("textarea") as HTMLTextAreaElement,
    "Verified producer, appellation, colour and cuvée in the source.")
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
  await act(async () => button("Reuse this LWIN wine")?.click())
  expect(reuseProfileLwin).toHaveBeenCalledWith("profile", "cuvee", "producer", "1195121",
    "Verified producer, appellation, colour and cuvée in the source.", true)
  expect(onSelect).toHaveBeenCalledWith("product-1", "Jacques Carillon Les Referts")
  await act(async () => root.unmount())
})
