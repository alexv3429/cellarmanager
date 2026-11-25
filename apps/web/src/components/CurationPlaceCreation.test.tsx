// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { createCurationGeographicDenomination } from "../data/drinkingWindowFallbackAuthoring"
import { CurationPlaceCreation } from "./CurationPlaceCreation"

vi.mock("../data/drinkingWindowFallbackAuthoring", () => ({
  createCurationPlace: vi.fn(), createCurationGeographicDenomination: vi.fn(),
}))
vi.mock("./CurationTargetPicker", () => ({ CurationTargetPicker: ({ kind, onChange }: {
  kind: string; onChange: (target: { id: string; label: string; detail: string }) => void
}) => <button type="button" onClick={() => onChange({ id: "parent", label: "Mâcon", detail: kind })}>
  Select {kind}
</button> }))
vi.mock("../i18n/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

it("does not make an enclosing fallback form invalid when the place editor is unused", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<form><input required defaultValue="ready" />
    <CurationPlaceCreation isOnline /></form>))
  const form = container.querySelector("form")!
  expect(form.checkValidity()).toBe(true)
  for (const control of container.querySelectorAll(".drinking-window-place-creation input, .drinking-window-place-creation textarea")) {
    expect(control.hasAttribute("required")).toBe(false)
    expect(control.hasAttribute("minlength")).toBe(false)
  }
  expect(container.querySelector<HTMLButtonElement>(".drinking-window-place-creation button")?.disabled).toBe(true)
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it("creates a geographic denomination only with its selected parent and explicit confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(createCurationGeographicDenomination).mockResolvedValue({
    id: "child", label: "Mâcon-Pierreclos", detail: "geographic denomination",
  })
  const container = document.createElement("div"); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<CurationPlaceCreation isOnline />))
  const select = container.querySelector("select")!
  await act(async () => { select.value = "denomination"; select.dispatchEvent(new Event("change", { bubbles: true })) })
  const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === label)!
  await act(async () => button("Select appellation").click())
  const fields = [container.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!,
    container.querySelector<HTMLTextAreaElement>("textarea")!]
  for (const [element, value] of [[fields[0], "Mâcon-Pierreclos"],
    [fields[1], "Official AOC specification confirms the denomination and parent."]] as const) {
    await act(async () => {
      const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  expect(button("Create shared place").disabled).toBe(true)
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  await act(async () => button("Create shared place").click())
  expect(createCurationGeographicDenomination).toHaveBeenCalledWith(expect.objectContaining({
    appellationId: "parent", canonicalName: "Mâcon-Pierreclos", confirmed: true,
  }))
  await act(async () => root.unmount())
  container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals()
})
