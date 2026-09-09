// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ACTIVE_HOUSEHOLD_STORAGE_KEY, readActiveHouseholdId, saveActiveHouseholdId } from "./activeHousehold"
import { useActiveHousehold, type HouseholdOption } from "./useActiveHousehold"

const query = vi.hoisted(() => ({ data: [] as HouseholdOption[], error: null as string | null, isLoading: false }))
vi.mock("@powersync/react", () => ({ useQuery: () => query }))
let root: Root
let container: HTMLDivElement
let current: ReturnType<typeof useActiveHousehold>
function Probe({ userId = "user-a" }: { userId?: string }) {
  current = useActiveHousehold(userId)
  return <p>{current.activeHouseholdId ?? "no household"}</p>
}
const households: HouseholdOption[] = [
  { id: "a", name: "My collection", role: "owner" },
  { id: "b", name: "Friends", role: "member" },
]
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  localStorage.clear()
  Object.assign(query, { data: households, error: null, isLoading: false })
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
async function render(userId?: string) { await act(async () => root.render(<Probe userId={userId} />)) }

describe("live household selection", () => {
  it("switches, survives query refresh, and restores on remount", async () => {
    await render()
    await act(async () => { expect(current.selectHousehold("b")).toBe(true) })
    query.data = [...households]
    await render()
    expect(current.activeHouseholdId).toBe("b")
    expect(readActiveHouseholdId(localStorage, "user-a")).toBe("b")
    await act(async () => root.unmount())
    root = createRoot(container)
    await render()
    expect(current.activeHouseholdId).toBe("b")
  })
  it("never opens a persisted ID before membership data arrives", async () => {
    saveActiveHouseholdId(localStorage, "user-a", "b")
    Object.assign(query, { data: [], isLoading: true })
    await render()
    expect(current.activeHouseholdId).toBeNull()
    expect(readActiveHouseholdId(localStorage, "user-a")).toBe("b")
    Object.assign(query, { data: households, isLoading: false })
    await render()
    expect(current.activeHouseholdId).toBe("b")
  })
  it("removes a lost household immediately and explains the fallback", async () => {
    saveActiveHouseholdId(localStorage, "user-a", "b")
    await render()
    query.data = [households[0]]
    await render()
    expect(current.activeHouseholdId).toBe("a")
    expect(current.selectionNotice).toContain("previous household is no longer available")
    expect(current.selectHousehold("b")).toBe(false)
    query.data = []
    await render()
    expect(current.activeHouseholdId).toBeNull()
  })
  it("fails closed on membership-query errors", async () => {
    await render()
    query.error = "Membership query failed"
    await render()
    expect(current.activeHouseholdId).toBeNull()
    expect(current.error).toBe(query.error)
  })
  it.each(["unavailable", "corrupt"])("still switches with %s browser storage", async (failure) => {
    if (failure === "unavailable") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    else localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, "not-json")
    await render()
    await act(async () => { current.selectHousehold("b") })
    expect(current.activeHouseholdId).toBe("b")
    expect(current.error).toBeNull()
    expect(current.selectionWarning).toContain("could not remember")
    query.data = [...households]
    await render()
    expect(current.activeHouseholdId).toBe("b")
  })
  it("does not share the selected household across accounts", async () => {
    saveActiveHouseholdId(localStorage, "user-a", "b")
    saveActiveHouseholdId(localStorage, "user-b", "a")
    await render()
    await act(async () => root.unmount())
    root = createRoot(container)
    await render("user-b")
    expect(current.activeHouseholdId).toBe("a")
    expect(readActiveHouseholdId(localStorage, "user-a")).toBe("b")
  })
})
