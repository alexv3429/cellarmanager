// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createCurationClimates, listCurationClimates } from "../data/drinkingWindowFallbackAuthoring"
import { CurationClimatCreation } from "./CurationClimatCreation"

vi.mock("../data/drinkingWindowFallbackAuthoring", () => ({
  createCurationClimates: vi.fn(), listCurationClimates: vi.fn(),
}))
vi.mock("./CurationTargetPicker", () => ({ CurationTargetPicker: ({ onChange }: {
  onChange: (value: { id: string; label: string; detail: string }) => void
}) => <button onClick={() => onChange({ id: "appellation", label: "Meursault", detail: "Bourgogne" })}>Select appellation</button> }))
vi.mock("../i18n/useLanguage", () => ({ useLanguage: () => ({
  t: (key: string, values?: Record<string, string>) => Object.entries(values || {})
    .reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), key),
}) }))

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = "" })

describe("shared climat creation", () => {
  it("requires an existing-list check, source and confirmation before a batch is created", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.mocked(listCurationClimates).mockResolvedValue([{ id: "existing", name: "Meursault Charmes" }])
    vi.mocked(createCurationClimates).mockResolvedValue([{ id: "new", name: "Meursault Perrières" }])
    const host = document.createElement("div"); document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<CurationClimatCreation isOnline />))
    await act(async () => host.querySelector("summary")?.click())
    const button = (name: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === name)
    await act(async () => button("Select appellation")?.click())
    expect(button("Create shared climates")).toBeUndefined()
    await act(async () => button("Show existing climates")?.click())
    expect(host.textContent).toContain("Meursault Charmes")
    const fields = host.querySelectorAll("textarea")
    const set = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      await act(async () => {
        const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value)
        element.dispatchEvent(new Event("input", { bubbles: true }))
      })
    }
    await set(fields[0], "Meursault Perrières")
    await set(host.querySelector('input[type="url"]') as HTMLInputElement, "https://example.org/appellation")
    await set(fields[1], "Official appellation list checked against the names.")
    expect(button("Create shared climates")?.disabled).toBe(true)
    await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    await act(async () => button("Create shared climates")?.click())
    expect(createCurationClimates).toHaveBeenCalledWith(expect.objectContaining({
      appellationId: "appellation", names: ["Meursault Perrières"], confirmed: true,
    }))
    expect(host.textContent).toContain("Meursault Perrières")
    expect(host.textContent).toContain("1 shared climates created")
    await act(async () => root.unmount())
  })
})
