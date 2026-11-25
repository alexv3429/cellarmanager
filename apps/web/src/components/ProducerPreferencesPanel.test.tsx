// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getHouseholdProducerSources, manageHouseholdProducerPreference,
  searchHouseholdReferenceProducers,
} from "../data/householdProducerPreferences"
import { ProducerPreferencesPanel } from "./ProducerPreferencesPanel"

vi.mock("../data/householdProducerPreferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/householdProducerPreferences")>()
  return { ...actual, getHouseholdProducerSources: vi.fn(),
    manageHouseholdProducerPreference: vi.fn(), searchHouseholdReferenceProducers: vi.fn() }
})
vi.mock("../i18n/useLanguage", () => ({ useLanguage: () => ({
  t: (key: string, values?: Record<string, string>) => Object.entries(values || {})
    .reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement), key),
}) }))

let root: Root
let container: HTMLDivElement

const sources = [
  { sourceText: "Pernot", normalized: "pernot", wineCount: 12, producerId: null,
    canonicalName: null, suggestions: [{ id: "alvina", canonicalName: "Alvina Pernot", matchKind: "similar" as const }] },
  { sourceText: "Clos Marie", normalized: "clos marie", wineCount: 25, producerId: null,
    canonicalName: null, suggestions: [{ id: "clos", canonicalName: "Clos Marie", matchKind: "exact" as const }] },
  { sourceText: "Boillot", normalized: "boillot", wineCount: 8, producerId: null,
    canonicalName: null, suggestions: [] },
]

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getHouseholdProducerSources).mockResolvedValue(sources)
  vi.mocked(searchHouseholdReferenceProducers).mockResolvedValue([])
  vi.mocked(manageHouseholdProducerPreference).mockResolvedValue()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("producer name review", () => {
  it("saves only explicitly selected household links, leaving similar names unselected", async () => {
    await act(async () => root.render(<ProducerPreferencesPanel householdId="household" isOnline />))
    await act(async () => container.querySelector("summary")?.click())
    expect(container.textContent).toContain("Review 2 possible producer links affecting 37 wines")
    const batch = container.querySelector(".producer-preferences__batch") as HTMLElement
    await act(async () => batch.querySelector("summary")?.click())
    const save = [...batch.querySelectorAll("button")]
      .find((button) => button.textContent === "Save selected producer links for this household")
    expect(save?.disabled).toBe(true)
    const checkboxes = [...batch.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes.every((checkbox) => !checkbox.checked)).toBe(true)
    await act(async () => checkboxes[0].click())
    const enabledSave = [...batch.querySelectorAll("button")]
      .find((button) => button.textContent === "Save selected producer links for this household")
    expect(enabledSave?.disabled).toBe(false)
    await act(async () => enabledSave?.click())
    expect(manageHouseholdProducerPreference).toHaveBeenCalledTimes(1)
    expect(manageHouseholdProducerPreference).toHaveBeenCalledWith(
      "household", sources[1], "set", "clos",
    )
    expect(container.textContent).toContain("1 producer name matches saved for this household only.")
  })
})
