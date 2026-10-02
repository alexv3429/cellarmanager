// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ActivityView } from "./ActivityView"
import type { InventoryActivityRow } from "../data/activityView"
import type { LegacyActivityRow } from "../data/legacyActivity"
import { LanguageContext } from "../i18n/LanguageContext"
import { translate } from "../i18n/messages"
const query = vi.hoisted(() => ({ rows: [] as InventoryActivityRow[], legacyRows: [] as LegacyActivityRow[] }))
vi.mock("@powersync/react", () => ({ useQuery: (sql: string) => ({
  data: sql.includes("from legacy_inventory_events") ? query.legacyRows : query.rows,
  error: null,
  isLoading: false,
}) }))
vi.mock("./InventoryQueueReview", () => ({ InventoryQueueReview: () => <section>Own browser queue</section> }))
vi.mock("./StatisticsView", () => ({ StatisticsView: () => <section>Household statistics</section> }))
const onOpenWine = vi.fn()
const row: InventoryActivityRow = {
  id: "rejected-request", user_id: "self", operation_type: "REMOVE", wine_id: "old-id", catalog_wine_id: "canonical-id",
  producer: "Synthetic Domaine", cuvee: "Test wine", vintage: 2020, color: "red", format_ml: 750,
  source_cellar_name: "Home", source_code: "A", destination_cellar_name: null, destination_code: null, quantity: 2,
  remove_reason: "DRANK", status: "REJECTED", error_code: "INSUFFICIENT_STOCK", error_message: "Insufficient stock",
  created_at_client: "2026-09-12T12:00:00Z", received_at_server: "2026-09-12T12:01:00Z", device_name: "Phone",
}
const legacyOpening: LegacyActivityRow = {
  household_id: "home", wine_id: "legacy-wine", source_record_id: "old-opening",
  archive_source_sha256: "archive", event_type: "OPENING_BALANCE", quantity: 3,
  remove_reason: null, occurred_at: "2026-07-16T12:00:00Z", recorded_at: "2026-10-01T12:00:00Z",
  source_from_cellar_id: null, source_from_location: null,
  source_to_cellar_id: "former-cellar", source_to_location: "A1",
  catalog_wine_id: "canonical-legacy", producer: "Domaine Archive", cuvee: "Ancien vin",
  vintage: 2019, color: "red", format_ml: 750,
}
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); onOpenWine.mockReset()
  window.history.replaceState({}, "", "/activity")
  query.rows = [row, { ...row, id: "accepted-request", status: "ACCEPTED", error_code: null, error_message: null }]
  query.legacyRows = []
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => root.render(<ActivityView householdId="home" userId="self" isOnline onOpenWine={onOpenWine} />)) }
async function renderFrench() {
  await act(async () => root.render(
    <LanguageContext.Provider value={{
      language: "fr",
      preference: "fr",
      setSavedPreference: () => undefined,
      t: (key, values) => translate("fr", key, values),
    }}>
      <ActivityView householdId="home" userId="self" isOnline onOpenWine={onOpenWine} />
    </LanguageContext.Provider>,
  ))
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text))!
  expect(button).toBeDefined(); await act(async () => button.click())
}
describe("rejected-operation UX", () => {
  it("keeps statistics alongside movements and synchronization", async () => {
    await render()
    expect(container.textContent).not.toContain("Household statistics")
    await click("Statistics")
    expect(container.textContent).toContain("Household statistics")
    expect(container.textContent).not.toContain("Showing 1 of")
    expect(window.location.search).toBe("?tab=statistics")
    await click("Wine movements")
    expect(container.textContent).not.toContain("Household statistics")
    expect(window.location.search).toBe("")
  })
  it("keeps an unconfirmed request out of wine movements while making the queue discoverable", async () => {
    query.rows = [{ ...row, status: "PENDING", error_code: null, error_message: null }]
    await render()
    expect(container.querySelectorAll(".activity-card")).toHaveLength(0)
    expect(container.textContent).toContain("Synchronization1")
    await click("Synchronization")
    expect(container.textContent).toContain("Own browser queue")
    expect(container.textContent).toContain("Stored locally and queued")
  })

  it("distinguishes a past rejection from a blocked upload and describes no stock effect", async () => {
    await render()
    expect(container.textContent).not.toContain("Own browser queue")
    expect(container.textContent).not.toContain("Not applied: remove")
    await click("Synchronization")
    expect(container.textContent).toContain("Own browser queue")
    expect(container.textContent).toContain("historical rejections, not changes still waiting to upload")
    expect(container.textContent).toContain("Not applied: remove 2 bottles")
    expect(container.textContent).toContain("Not enough bottles at the source")
    expect(container.textContent).toContain("No stock change was applied by this request")
    const details = container.querySelector("details")!
    expect(details.open).toBe(false); expect(details.textContent).toContain("rejected-request")
  })
  it("localizes activity actions, status, wine color and missing device on French UI", async () => {
    query.rows = [{
      ...row,
      operation_type: "ADD",
      status: "ACCEPTED",
      color: "white",
      device_name: null,
      destination_cellar_name: "Marseille ArteVino",
      destination_code: "2F",
      source_cellar_name: null,
      source_code: null,
    }]
    await renderFrench()
    expect(container.textContent).toContain("Ajout de 2 bouteilles à Marseille ArteVino / 2F")
    expect(container.textContent).toContain("2020 · blanc · 75 cl")
    expect(container.textContent).not.toContain("Synchronisé")
    expect(container.textContent).toContain("Appareil inconnu")
    await click("Synchronisation")
    expect(container.textContent).toContain("Synchronisé")
    expect(container.textContent).not.toContain("Added")
    expect(container.textContent).not.toContain("Unknown device")
  })
  it("filters rejected changes and opens current canonical stock without creating an operation", async () => {
    await render(); await click("Synchronization"); await click("Show rejected changes")
    expect(container.querySelectorAll(".activity-card")).toHaveLength(1)
    await click("Review current stock")
    expect(onOpenWine).toHaveBeenCalledExactlyOnceWith("canonical-id")
    expect(container.textContent).not.toContain("Retry this request")
  })
  it("keeps an unavailable wine readable without creating an invalid detail link", async () => {
    query.rows = [{ ...row, catalog_wine_id: null, error_code: "LOCATION_ARCHIVED" }]; await render(); await click("Synchronization")
    expect(container.textContent).toContain("storage location is archived")
    expect(container.textContent).toContain("not available in the synchronized catalog yet")
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Review current stock")).toBe(false)
    expect(onOpenWine).not.toHaveBeenCalled()
  })
})

describe("imported history in movements", () => {
  it("groups opening stock and shows an archived drink without creating operations", async () => {
    query.rows = []
    query.legacyRows = [
      legacyOpening,
      { ...legacyOpening, source_record_id: "old-opening-2", quantity: 2 },
      { ...legacyOpening, source_record_id: "old-drink", event_type: "REMOVE", quantity: 1,
        remove_reason: "DRANK", occurred_at: "2026-07-30T12:00:00Z",
        source_from_location: "B2", source_to_location: null },
    ]
    await renderFrench()
    expect(container.querySelectorAll(".activity-card--legacy")).toHaveLength(2)
    expect(container.textContent).toContain("Stock de départ importé")
    expect(container.textContent).toContain("pas d’une autre cave")
    expect(container.textContent).toContain("5 bouteilles pour 1 vin et 2 positions")
    expect(container.textContent).toContain("Bu 1 bouteille")
    expect(container.textContent).toContain("non rejoué sur le stock actuel")
    await click("Domaine Archive — Ancien vin")
    expect(onOpenWine).toHaveBeenCalledExactlyOnceWith("canonical-legacy")
  })

  it("keeps another household’s archive out and hides imported cards in synchronization", async () => {
    query.legacyRows = [legacyOpening, { ...legacyOpening, household_id: "other", source_record_id: "private" }]
    await render()
    expect(container.querySelectorAll(".activity-card--legacy")).toHaveLength(1)
    await click("Synchronization")
    expect(container.querySelectorAll(".activity-card--legacy")).toHaveLength(0)
    await click("Wine movements")
    expect(container.querySelectorAll(".activity-card--legacy")).toHaveLength(1)
    expect(container.textContent).not.toContain("Own browser queue")
  })
})
