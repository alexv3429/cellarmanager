// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ImportWorkspace } from "./ImportView"
import { commitCsvImport } from "../data/csvImportCommit"

vi.mock("./CsvExportPanel", () => ({ CsvExportPanel: () => null }))
vi.mock("../data/cellarSetup", () => ({ createInitialImportDestination: vi.fn() }))
vi.mock("../data/csvImportCommit", async (original) => ({ ...await original<typeof import("../data/csvImportCommit")>(), commitCsvImport: vi.fn() }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.resetAllMocks(); localStorage.clear()
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function render() {
  await act(async () => root.render(<ImportWorkspace catalogError={null} catalogIsLoading={false} catalogWines={[]}
    deviceId="device" householdId="household" isOnline={true} storageError={null} storageIsLoading={false}
    storageCellars={[{ id: "cellar", household_id: "household", name: "Main", is_active: 1 }]}
    storageLocations={[{ id: "location", cellar_id: "cellar", household_id: "household", code: "A1", is_active: 1, bottle_count: 0, capacity: 20 }]} />))
}
async function upload(text: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const bytes = new TextEncoder().encode(text)
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "synthetic.csv", type: "text/csv", size: bytes.length, arrayBuffer: async () => bytes.buffer }] })
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
function button(text: string) {
  const element = [...container.querySelectorAll("button")].find((node) => node.textContent === text)
  expect(element, text).toBeDefined(); return element!
}
async function click(text: string) { await act(async () => button(text).click()) }
async function fill(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!
    const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }))
  })
}
const text = "Producer,Cuvée,Vintage,Color,Bottle format,Quantity,Cellar,Location\nTest,Old,2020,red,75 cl,0,Main,A1\nTest,Current,bad,white,,2,Main,A1\n,,,,,99,,\n"

describe("import workspace row preparation", () => {
  it("supports an absent Cuvée column with an explicit fallback and does not accept an empty fixed name", async () => {
    await render()
    await upload("Producer,Vintage,Color,Bottle format,Quantity,Appellation,Cellar,Location\nTest,2020,red,75 cl,2,Village,Main,A1\n")
    expect(container.textContent).not.toContain("Preparation complete")
    await fill('.import-cuvee-fallback select', "fixed")
    expect(container.textContent).not.toContain("Preparation complete")
    await fill('.import-cuvee-fallback select', "appellation")
    expect(container.textContent).toContain("Preparation complete")
    await click("Continue to import confirmation")
    expect(container.textContent).toContain("This will add 2 bottles across 1 source row")
    expect(commitCsvImport).not.toHaveBeenCalled()
  })
  it("corrects a messy file end-to-end, excludes totals, and invalidates an old confirmation after an edit", async () => {
    await render(); await upload(text)
    await click("Exclude 1 zero-stock row"); await click("Exclude row 4")
    await click("Edit row 3")
    await fill('input[aria-label="Vintage for row 3"]', "NM")
    await fill('input[aria-label="Bottle format for row 3"]', "75 cl")
    await click("Save row corrections")
    expect(container.textContent).toContain("2 excluded · 1 corrected")
    await click("Continue to import confirmation")
    expect(container.textContent).toContain("This will add 2 bottles across 1 source row")
    await click("Review or edit stages 1–6")
    await fill('.import-row-editor__filters select', "all")
    await click("Edit row 3"); await fill('input[aria-label="Quantity for row 3"]', "4"); await click("Save row corrections")
    expect(container.querySelector(".import-confirmation")).toBeNull()
    await click("Continue to import confirmation")
    expect(container.textContent).toContain("This will add 4 bottles across 1 source row")
    vi.mocked(commitCsvImport).mockImplementation(async (plan) => ({ importId: plan.importId, importedRowCount: 1, importedBottleCount: 4, createdWineCount: 1, reusedWineCount: 0 }))
    await act(async () => container.querySelector<HTMLInputElement>('.import-confirmation input[type="checkbox"]')!.click())
    await click("Import 4 bottles")
    expect(commitCsvImport).toHaveBeenCalledOnce()
    const plan = vi.mocked(commitCsvImport).mock.calls[0][0]
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0]).toMatchObject({ recordNumber: 3, quantity: 4, wineFormatMl: 750, wineVintage: null })
  })
  it("keeps an all-excluded file blocked and clears preparation when choosing another file", async () => {
    await render(); await upload(text)
    await click("Exclude 1 zero-stock row"); await click("Exclude row 3"); await click("Exclude row 4")
    expect(container.textContent).toContain("No rows are included")
    expect(container.textContent).not.toContain("Preparation complete")
    expect(commitCsvImport).not.toHaveBeenCalled()
    await click("Choose another file"); await upload(text)
    expect(container.textContent).toContain("3 rows included · 0 excluded · 0 corrected")
  })
})
