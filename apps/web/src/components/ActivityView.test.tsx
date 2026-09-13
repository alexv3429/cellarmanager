// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ActivityView } from "./ActivityView"
import type { InventoryActivityRow } from "../data/activityView"
const query = vi.hoisted(() => ({ rows: [] as InventoryActivityRow[] }))
vi.mock("@powersync/react", () => ({ useQuery: () => ({ data: query.rows, error: null, isLoading: false }) }))
vi.mock("./InventoryQueueReview", () => ({ InventoryQueueReview: () => <section>Own browser queue</section> }))
const onOpenWine = vi.fn()
const row: InventoryActivityRow = {
  id: "rejected-request", user_id: "self", operation_type: "REMOVE", wine_id: "old-id", catalog_wine_id: "canonical-id",
  producer: "Synthetic Domaine", cuvee: "Test wine", vintage: 2020, color: "red", format_ml: 750,
  source_cellar_name: "Home", source_code: "A", destination_cellar_name: null, destination_code: null, quantity: 2,
  remove_reason: "DRANK", status: "REJECTED", error_code: "INSUFFICIENT_STOCK", error_message: "Insufficient stock",
  created_at_client: "2026-09-12T12:00:00Z", received_at_server: "2026-09-12T12:01:00Z", device_name: "Phone",
}
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); onOpenWine.mockReset()
  query.rows = [row, { ...row, id: "accepted-request", status: "ACCEPTED", error_code: null, error_message: null }]
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => root.render(<ActivityView householdId="home" userId="self" isOnline onOpenWine={onOpenWine} />)) }
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text)!
  expect(button).toBeDefined(); await act(async () => button.click())
}
describe("rejected-operation UX", () => {
  it("distinguishes a past rejection from a blocked upload and describes no stock effect", async () => {
    await render()
    expect(container.textContent).toContain("historical rejections, not changes still waiting to upload")
    expect(container.textContent).toContain("Not applied: remove 2 bottles")
    expect(container.textContent).toContain("Not enough bottles at the source")
    expect(container.textContent).toContain("No stock change was applied by this request")
    const details = container.querySelector("details")!
    expect(details.open).toBe(false); expect(details.textContent).toContain("rejected-request")
  })
  it("filters rejected changes and opens current canonical stock without creating an operation", async () => {
    await render(); await click("Show rejected changes")
    expect(container.querySelectorAll(".activity-card")).toHaveLength(1)
    await click("Review current stock")
    expect(onOpenWine).toHaveBeenCalledExactlyOnceWith("canonical-id")
    expect(container.textContent).not.toContain("Retry this request")
  })
  it("keeps an unavailable wine readable without creating an invalid detail link", async () => {
    query.rows = [{ ...row, catalog_wine_id: null, error_code: "LOCATION_ARCHIVED" }]; await render()
    expect(container.textContent).toContain("storage location is archived")
    expect(container.textContent).toContain("not available in the synchronized catalog yet")
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Review current stock")).toBe(false)
    expect(onOpenWine).not.toHaveBeenCalled()
  })
})
