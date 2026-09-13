// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InventoryQueueReview } from "./InventoryQueueReview"
import { getStoppedInventoryUploads, stopInventoryUpload, type InventoryUploadReceipt, type QueuedInventoryRequest } from "../data/inventoryRecovery"
import { rememberInventoryUploadReceipt } from "../data/powersync/inventoryUploadReceipts"
vi.mock("../data/inventoryRecovery", async (importOriginal) => ({ ...await importOriginal<typeof import("../data/inventoryRecovery")>(), getStoppedInventoryUploads: vi.fn(), stopInventoryUpload: vi.fn() }))
vi.mock("../data/powersync/inventoryUploadReceipts", () => ({ rememberInventoryUploadReceipt: vi.fn() }))
const query = vi.hoisted(() => ({ result: { data: [] as QueuedInventoryRequest[], error: null as Error | null, isLoading: false } }))
vi.mock("@powersync/react", () => ({ useQuery: vi.fn(() => query.result) }))
const read = vi.mocked(getStoppedInventoryUploads), stop = vi.mocked(stopInventoryUpload), remember = vi.mocked(rememberInventoryUploadReceipt)
const props = { householdId: "home", userId: "self", isOnline: true }
const request: QueuedInventoryRequest = {
  id: "original-op", household_id: "old-home", user_id: "self", device_id: "old-device", operation_type: "MOVE", wine_id: "wine",
  source_location_id: "a", destination_location_id: "b", quantity: 2, remove_reason: null, created_at_client: "2026-09-12T12:00:00Z",
  wine_label: "Synthetic wine", household_label: "Old household", device_label: "Revoked phone", source_label: "A", destination_label: "B",
}
const receipt: InventoryUploadReceipt = { operation_id: request.id, household_id: request.household_id, user_id: "self", device_id: request.device_id, status: "STOPPED", error_code: "USER_CANCELLED" }
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.resetAllMocks()
  query.result = { data: [structuredClone(request)], error: null, isLoading: false }
  read.mockResolvedValue([]); stop.mockResolvedValue(receipt); remember.mockResolvedValue(undefined)
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function render(overrides: Partial<typeof props> = {}) { await act(async () => root.render(<InventoryQueueReview {...props} {...overrides} />)) }
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === label)
  expect(found, label).toBeDefined(); return found!
}
async function click(label: string) { await act(async () => button(label).click()) }
async function review() { await click("Review queued request: Synthetic wine") }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

describe("queued request review", () => {
  it("remains available after losing the last household, but is hidden for a new empty account", async () => {
    await act(async () => root.render(<InventoryQueueReview userId="self" householdId={null} isOnline onlyWhenQueued />))
    expect(container.textContent).toContain("Synthetic wine")
    expect(read).toHaveBeenCalledWith(null, "self")
    query.result.data = []
    await act(async () => root.render(<InventoryQueueReview userId="self" householdId={null} isOnline onlyWhenQueued />))
    expect(container.textContent).toBe("")
  })
  it("shows own queue across households and reads history without any write", async () => {
    await render()
    expect(container.textContent).toContain("Another household")
    expect(container.textContent).toContain("Revoked phone")
    expect(container.textContent).toContain("Move 2 bottles")
    expect(read).toHaveBeenCalledWith("home", "self")
    expect(stop).not.toHaveBeenCalled(); expect(remember).not.toHaveBeenCalled()
  })
  it("requires explicit confirmation, and cancellation restores focus without a write", async () => {
    await render(); await review()
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Stop queued request")
    expect(container.textContent).toContain("If already accepted, its stock change is kept")
    await click("Keep queued")
    expect(document.activeElement).toBe(button("Review queued request: Synthetic wine"))
    expect(stop).not.toHaveBeenCalled()
  })
  it("stops the exact request once and acknowledges only after the server receipt", async () => {
    const pending = deferred<InventoryUploadReceipt>(); stop.mockReturnValueOnce(pending.promise)
    await render(); await review()
    const confirm = button("Confirm: stop this request")
    await act(async () => { confirm.click(); confirm.click() })
    expect(stop).toHaveBeenCalledExactlyOnceWith(request, "self"); expect(remember).not.toHaveBeenCalled()
    await act(async () => pending.resolve(receipt))
    expect(remember).toHaveBeenCalledExactlyOnceWith(receipt, request)
    expect(container.textContent).toContain("Request stopped before acceptance")
    expect(container.textContent).toContain("0 queued")
    expect(document.activeElement?.textContent).toBe("Queued on this browser")
  })
  it.each(["ACCEPTED", "REJECTED"] as const)("reconciles %s instead of claiming it was stopped", async (status) => {
    stop.mockResolvedValueOnce({ ...receipt, status }); await render(); await review(); await click("Confirm: stop this request")
    expect(container.textContent).toContain(status === "ACCEPTED" ? "Nothing was undone or applied again" : "original rejection stays in Activity")
    expect(container.textContent).not.toContain("Request stopped before acceptance")
  })
  it.each(["response", "local storage"])("keeps the queue if %s fails and explains same-ID reconciliation", async (where) => {
    if (where === "response") stop.mockRejectedValueOnce(new Error("Response lost"))
    else remember.mockRejectedValueOnce(new Error("Storage unavailable"))
    await render(); await review(); await click("Confirm: stop this request")
    expect(container.textContent).toContain("queue was not acknowledged here")
    expect(container.textContent).toContain("never create a replacement")
    expect(container.textContent).toContain("1 queued")
    expect(stop).toHaveBeenCalledTimes(1)
    if (where === "response") expect(remember).not.toHaveBeenCalled()
    await review(); await click("Confirm: stop this request")
    expect(stop).toHaveBeenLastCalledWith(request, "self")
  })
  it("does not act offline and discards a confirmation on connectivity change", async () => {
    await render({ isOnline: false }); expect(read).not.toHaveBeenCalled()
    expect(button("Review queued request: Synthetic wine").disabled).toBe(true)
    await render(); await review(); await render({ isOnline: false })
    expect(container.querySelector('[role="region"]')).toBeNull()
    expect(stop).not.toHaveBeenCalled()
  })
  it.each(["household", "account", "connectivity"])("ignores a response after a %s switch", async (change) => {
    const pending = deferred<InventoryUploadReceipt>(); stop.mockReturnValueOnce(pending.promise)
    await render(); await review(); await click("Confirm: stop this request")
    await render(change === "account" ? { userId: "other" } : change === "household" ? { householdId: "next" } : { isOnline: false })
    await act(async () => pending.resolve(receipt))
    expect(remember).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain("Request stopped before acceptance")
  })
  it("will not submit a request that changed or synchronized while reviewing", async () => {
    await render(); await review()
    query.result.data = [{ ...request, quantity: 1 }]; await render()
    await click("Confirm: stop this request")
    expect(stop).not.toHaveBeenCalled(); expect(container.textContent).toContain("nothing was submitted")
  })
  it("does not expose another author from stale query results", async () => {
    query.result.data = [{ ...request, user_id: "someone-else" }]; await render()
    expect(container.textContent).not.toContain("Synthetic wine")
    expect(container.textContent).toContain("0 queued")
  })
  it("preserves the queue if its local read fails during review", async () => {
    await render(); await review(); query.result.error = new Error("Read failed"); await render()
    await click("Confirm: stop this request"); expect(stop).not.toHaveBeenCalled()
  })
})
