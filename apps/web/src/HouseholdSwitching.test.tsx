// @vitest-environment jsdom
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { readActiveHouseholdId, saveActiveHouseholdId } from "./households/activeHousehold"
import type { HouseholdOption } from "./households/useActiveHousehold"

const state = vi.hoisted(() => ({
  households: [] as HouseholdOption[],
  online: true,
  session: { user: { id: "test-user" } },
  queued: [{ household_id: "a", status: "PENDING", quantity: 2 }],
  lateNavigation: null as (() => void) | null,
}))
vi.mock("@powersync/react", () => ({
  useStatus: () => ({ connected: state.online, hasSynced: true }),
  useQuery: (sql: string, params: string[]) => ({
    data: sql.includes("join household_members") ? state.households :
      [{ pending_count: state.queued.filter((op) => op.household_id === params[0]).length }],
    error: null, isLoading: false,
  }),
}))
vi.mock("./auth/useSession", () => ({ useSession: () => ({
  session: state.session, userId: "test-user", isLoading: false, isOnline: state.online,
  isOfflineAccess: !state.online, isPasswordRecovery: false, error: null,
}) }))
vi.mock("./auth/signOut", () => ({ signOutAndClearLocalData: vi.fn() }))
vi.mock("./data/powersync/connection", () => ({ setPowerSyncAccess: async ({ onLocalReady }: { onLocalReady?: () => void }) => { onLocalReady?.() } }))
vi.mock("./devices/useRegisteredDevices", () => ({ useRegisteredDevices: () => ({
  deviceIdByHousehold: { a: "device-a", b: "device-b" }, error: null, isLoading: false,
  isReady: true, isRegistering: false, retryRegistration: vi.fn(),
}) }))
vi.mock("./households/invitationToken", () => ({
  captureHouseholdInvitationToken: () => null, getInvitationUrlWithoutSecret: () => null,
  clearHouseholdInvitationToken: vi.fn(),
}))

// Real App, hook, shell, switcher and History API; synthetic child screens
// make form state observable without touching any real cellar or network.
function StatefulScreen({ householdId, onOpenWine, kind = "inventory" }: {
  householdId: string; onOpenWine?: (wine: string) => void; kind?: string
}) {
  const [draft, setDraft] = useState("")
  return <section data-screen={kind}>
    <h1>{kind} in {householdId}</h1>
    <input aria-label={`${kind} draft`} value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button onClick={() => setDraft("Unfinished work in " + householdId)}>Prepare draft</button>
    {onOpenWine ? <button onClick={() => onOpenWine(householdId + "-wine")}>Open wine</button> : null}
  </section>
}
vi.mock("./components/HoldingsView", () => ({ HoldingsView: StatefulScreen }))
vi.mock("./components/CatalogView", () => ({ CatalogView: (props: Parameters<typeof StatefulScreen>[0]) => <StatefulScreen {...props} kind="catalog" /> }))
vi.mock("./components/PairingView", () => ({ PairingView: (props: Parameters<typeof StatefulScreen>[0]) => <StatefulScreen {...props} kind="pairing" /> }))
vi.mock("./components/ImportView", () => ({ ImportView: (props: Parameters<typeof StatefulScreen>[0]) => <StatefulScreen {...props} kind="import" /> }))
vi.mock("./components/CellarSetupView", () => ({ CellarSetupView: (props: Parameters<typeof StatefulScreen>[0]) => <StatefulScreen {...props} kind="setup" /> }))
vi.mock("./components/HouseholdInvitationsView", () => ({ HouseholdInvitationsView: (props: Parameters<typeof StatefulScreen>[0]) => <StatefulScreen {...props} kind="invite" /> }))
vi.mock("./components/HouseholdMembersView", () => ({ HouseholdMembersView: (props: Parameters<typeof StatefulScreen>[0]) => <StatefulScreen {...props} kind="members" /> }))
vi.mock("./components/ActivityView", () => ({ ActivityView: (props: Parameters<typeof StatefulScreen>[0]) => <StatefulScreen {...props} kind="activity" /> }))
vi.mock("./components/MemberCellarView", () => ({ MemberCellarView: ({ householdId }: { householdId: string }) => <h1>Read-only cellar in {householdId}</h1> }))
vi.mock("./components/WineDetailView", () => ({ WineDetailView: ({ householdId, wineId, onBack, onOpenMergedWine }: {
  householdId: string; wineId: string; onBack: () => void; onOpenMergedWine: (id: string) => void
}) => <section><h1>Wine {wineId} in {householdId}</h1><button onClick={onBack}>Back to list</button>
  <button onClick={() => { state.lateNavigation = () => onOpenMergedWine(householdId + "-merged") }}>Start delayed navigation</button>
</section> }))
vi.mock("./components/InvitationEntryView", () => ({ InvitationEntryView: () => null }))
vi.mock("./components/LoginForm", () => ({ LoginForm: () => null }))
vi.mock("./components/ResetPasswordForm", () => ({ ResetPasswordForm: () => null }))
vi.mock("./components/OnboardingView", () => ({ OnboardingView: () => <h1>Set up your cellar</h1> }))

let root: Root
let container: HTMLDivElement
const households: HouseholdOption[] = [
  { id: "a", name: "My collection", role: "owner" },
  { id: "b", name: "Friends’ collection", role: "member" },
]
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
  localStorage.clear()
  history.replaceState(null, "", "/")
  state.households = [...households]
  state.online = true
  state.lateNavigation = null
  state.queued = [{ household_id: "a", status: "PENDING", quantity: 2 }]
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function render() { await act(async () => root.render(<App />)) }
async function button(label: string) {
  const element = [...container.querySelectorAll("button")].find((node) => node.textContent === label)
  expect(element, label).toBeDefined()
  await act(async () => element!.click())
}
async function choose(householdId: string) {
  const select = container.querySelector<HTMLSelectElement>(".household-switcher select")!
  await act(async () => {
    select.value = householdId
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function switchTo(householdId: string) { await choose(householdId); await button("Switch household") }

describe("multi-household workspace isolation", () => {
  it("requires confirmation and cancellation keeps unfinished work", async () => {
    await render()
    await button("Prepare draft")
    await choose("b")
    expect(container.textContent).toContain("Switch to Friends’ collection?")
    expect(container.textContent).toContain("1 queued change stays with that household")
    expect(container.textContent).toContain("Current householdMy collection")
    expect(document.activeElement?.getAttribute("role")).toBe("region")
    await button("Stay here")
    expect(container.querySelector("input")?.value).toBe("Unfinished work in a")
    expect(document.activeElement?.tagName).toBe("SELECT")
    expect(history.state.householdId).toBe("a")
  })

  it.each([true, false])("switches owner to member without transferring data (online: %s)", async (online) => {
    state.online = online
    await render()
    await button("Prepare draft")
    const originalQueue = structuredClone(state.queued)
    await switchTo("b")
    expect(container.textContent).toContain("Read-only cellar in b")
    expect(container.textContent).not.toContain("inventory in a")
    expect(container.querySelector('nav a[href="/catalog"]')).toBeNull()
    expect(container.querySelector('nav a[href="/setup"]')).toBeNull()
    expect(location.pathname).toBe("/cellar")
    expect(document.title).toContain("Friends’ collection")
    expect(readActiveHouseholdId(localStorage, "test-user")).toBe("b")
    expect(state.queued).toEqual(originalQueue)
    if (!online) expect(container.textContent).toContain("only households already synchronized")
    await switchTo("a")
    expect(container.querySelector("input")?.value).toBe("")
    expect(location.pathname).toBe("/")
    expect(container.querySelector('nav a[href="/catalog"]')).not.toBeNull()
  })

  it.each(["/catalog", "/pairing", "/data", "/setup", "/invite", "/activity", "/members"])("resets mounted %s forms even when both roles are owner", async (path) => {
    state.households = households.map((household) => ({ ...household, role: "owner" }))
    history.replaceState(null, "", path)
    await render()
    await button("Prepare draft")
    await switchTo("b")
    expect(container.querySelector("input")?.value).toBe("")
    expect(container.textContent).toContain("inventory in b")
    expect(container.textContent).not.toContain("in a")
    expect(location.pathname).toBe("/")
  })

  it("restores the selected member household on refresh", async () => {
    saveActiveHouseholdId(localStorage, "test-user", "b")
    history.replaceState({ householdId: "a" }, "", "/wines/a-wine")
    await render()
    expect(container.textContent).toContain("Read-only cellar in b")
    expect(location.pathname).toBe("/cellar")
    expect(history.state.householdId).toBe("b")
  })

  it("Back/Forward cannot restore a previous household's wine even at the same visible home route", async () => {
    await render()
    await button("Open wine")
    expect(location.pathname).toBe("/wines/a-wine")
    await switchTo("b")
    await act(async () => {
      history.replaceState({ householdId: "a", wineDetailReturnView: "pairing" }, "", "/wines/a-wine")
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }))
    })
    expect(container.textContent).toContain("Read-only cellar in b")
    expect(container.textContent).not.toContain("Wine a-wine")
    expect(location.pathname).toBe("/cellar")
    expect(history.state.householdId).toBe("b")
  })

  it("keeps ordinary same-household Back navigation and pairing state", async () => {
    history.replaceState(null, "", "/pairing")
    await render()
    await button("Prepare draft")
    await button("Open wine")
    expect(container.textContent).toContain("Wine a-wine in a")
    await act(async () => {
      const popped = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }))
      history.back()
      await popped
    })
    expect(location.pathname).toBe("/pairing")
    expect(container.querySelector('input[aria-label="pairing draft"]')?.getAttribute("value")).toBe("Unfinished work in a")
  })

  it("returns a directly opened wine to the catalog without inventing a browser Back destination", async () => {
    history.replaceState(null, "", "/wines/a-wine")
    const browserBack = vi.spyOn(history, "back")
    await render()
    expect(history.state).toEqual({ householdId: "a" })
    await button("Back to list")
    expect(browserBack).not.toHaveBeenCalled()
    expect(location.pathname).toBe("/catalog")
    expect(container.textContent).toContain("catalog in a")
  })

  it("ignores an old screen's async navigation after switching households", async () => {
    await render()
    await button("Open wine")
    await button("Start delayed navigation")
    await switchTo("b")
    await act(async () => { state.lateNavigation?.() })
    expect(location.pathname).toBe("/cellar")
    expect(history.state.householdId).toBe("b")
    expect(container.textContent).toContain("Read-only cellar in b")
  })

  it("clears the entire workspace when access is lost or downgraded", async () => {
    await render()
    await button("Prepare draft")
    state.households = [{ ...households[0], role: "member" }, households[1]]
    await render()
    expect(container.textContent).toContain("Read-only cellar in a")
    expect(container.querySelector("input")).toBeNull()
    state.households = [households[1]]
    await render()
    expect(container.textContent).toContain("Read-only cellar in b")
    expect(container.textContent).toContain("previous household is no longer available")
    expect(location.pathname).toBe("/cellar")
  })

  it("shows no redundant selector for a single household", async () => {
    state.households = [households[0]]
    await render()
    expect(container.querySelector(".household-switcher select")).toBeNull()
    expect(container.textContent).toContain("including all its storage cellars")
  })

  it("does not confirm a destination that lost membership while confirmation was open", async () => {
    await render()
    await choose("b")
    state.households = [households[0]]
    await render()
    expect(container.textContent).not.toContain("Switch to Friends’ collection?")
    expect(container.textContent).toContain("inventory in a")
  })
})
