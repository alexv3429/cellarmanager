// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MaturityOverviewItem } from "../data/wineMaturity"
import { LanguageContext } from "../i18n/LanguageContext"
import { translate } from "../i18n/messages"
import { DrinkingWindowDashboard } from "./DrinkingWindowDashboard"

const fixtures = vi.hoisted(() => ({
  stock: [
    { id: "soon", household_id: "home", producer: "Domaine A", cuvee: "Cuvée A", vintage: 2019, quantity: 3 },
    { id: "ready", household_id: "home", producer: "Domaine B", cuvee: "Cuvée B", vintage: 2020, quantity: 2 },
    { id: "unknown", household_id: "home", producer: "Domaine C", cuvee: "Cuvée C", vintage: null, quantity: 1 },
  ],
  overview: [] as MaturityOverviewItem[],
  reject: false,
  calls: 0,
}))

vi.mock("@powersync/react", () => ({ useQuery: () => ({ data: fixtures.stock, error: null, isLoading: false }) }))
vi.mock("../data/wineMaturity", () => ({
  getHouseholdMaturityOverview: async () => {
    fixtures.calls += 1
    if (fixtures.reject) throw new Error("Unavailable")
    return fixtures.overview
  },
}))

let root: Root
let container: HTMLDivElement
const onOpenWine = vi.fn()
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  fixtures.calls = 0
  fixtures.reject = false
  fixtures.overview = [
    { wineId: "soon", state: "priority", drinkByYear: 2027, firstTrialYear: 2022,
      isOverride: false, isPersonalized: false, urgencyScore: 5 } as MaturityOverviewItem,
    { wineId: "ready", state: "ready", drinkByYear: 2031, firstTrialYear: 2023,
      isOverride: true, isPersonalized: false, urgencyScore: 2 } as MaturityOverviewItem,
  ]
  onOpenWine.mockReset()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("drinking-window dashboard", () => {
  it("shows bottle-weighted groups and opens the selected wine", async () => {
    await act(async () => root.render(<LanguageContext.Provider value={{
      language: "fr", preference: "fr", setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}><DrinkingWindowDashboard householdId="home" isOnline onOpenWine={onOpenWine} />
    </LanguageContext.Provider>))

    expect(container.textContent).toContain("Bouteilles dans la cave : 6")
    expect(container.querySelector('.drinking-dashboard__group--soon')?.textContent).toContain("3À boire bientôt")
    expect(container.querySelector('.drinking-dashboard__group--unassessed')?.textContent).toContain("1Sans estimation")
    expect(container.textContent).toContain("Domaine A · Cuvée A · 2019")
    const ready = container.querySelector<HTMLButtonElement>('.drinking-dashboard__group--ready')!
    await act(async () => ready.click())
    expect(container.textContent).toContain("Domaine B · Cuvée B · 2020")
    expect(container.textContent).toContain("Fenêtre manuelle")
    const wineButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Domaine B · Cuvée B"))!
    await act(async () => wineButton.click())
    expect(onOpenWine).toHaveBeenCalledExactlyOnceWith("ready")
  })

  it("does not request an online estimate while offline", async () => {
    await act(async () => root.render(<DrinkingWindowDashboard householdId="home" isOnline={false} onOpenWine={onOpenWine} />))
    expect(container.textContent).toContain("Connect to see current drinking-window suggestions")
    expect(fixtures.calls).toBe(0)
  })

  it("shows a recoverable load error without presenting empty guidance as fact", async () => {
    fixtures.reject = true
    await act(async () => root.render(<DrinkingWindowDashboard householdId="home" isOnline onOpenWine={onOpenWine} />))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded")
    expect(container.querySelectorAll(".drinking-dashboard__group")).toHaveLength(0)
    fixtures.reject = false
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Try again")!
    await act(async () => retry.click())
    expect(container.querySelectorAll(".drinking-dashboard__group")).toHaveLength(5)
  })
})
