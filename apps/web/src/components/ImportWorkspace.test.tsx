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
  it("fills blank formats only, preserves magnums and row edits, and imports catalog-only rows without destinations", async () => {
    await render()
    await upload("Producer,Cuvée,Vintage,Color,Bottle format,Quantity\nEstate,Hill,2020,red,,0\nEstate,Garden,2020,red,1500 ml,0\n")
    await fill('.import-mapping-default-add select', "formatMl")
    await fill('.import-mapping-default-add input', "750 ml")
    await click("Set default")
    await click("Continue to import confirmation")
    expect(container.textContent).toContain("2 catalog-only rows add or match wines without adding bottles")
    expect(container.textContent).toContain("Catalog only · no storage needed")
    await click("Review or edit stages 1–6")
    await fill('.import-row-editor__filters select', "all")
    await click("Edit row 2")
    await fill('input[aria-label="Vintage for row 2"]', "2021")
    await click("Save row corrections")
    // Saving an unrelated field must not freeze a fallback as a manual format.
    await fill('input[aria-label="Bottle format default for empty cells"]', "375 ml")
    expect(container.querySelector(".import-confirmation")).toBeNull()
    await click("Continue to import confirmation")
    vi.mocked(commitCsvImport).mockImplementation(async (plan) => ({ importId: plan.importId, importedRowCount: 2, importedBottleCount: 0, createdWineCount: 2, reusedWineCount: 0 }))
    await act(async () => container.querySelector<HTMLInputElement>('.import-confirmation input[type="checkbox"]')!.click())
    await click("Import catalog wines")
    expect(vi.mocked(commitCsvImport).mock.calls[0][0].rows.map((row) => [row.quantity, row.wineFormatMl, row.destinationLocationId]))
      .toEqual([[0, 375, null], [0, 1500, null]])
  })
  it("splits an arbitrary unmapped storage column into cellar and location only on confirmation", async () => {
    await render()
    await upload("Producer,Cuvée,Vintage,Color,Bottle format,Quantity,Combined place\nEstate,Hill,2020,red,750,2,Main/A1\n")
    await click("Review or edit stages 1–6")
    await click("Split a column")
    await fill('.import-column-split-settings select:nth-of-type(1)', "6")
    const selects = container.querySelectorAll<HTMLSelectElement>('.import-column-split-settings select')
    await act(async () => { selects[1].value = "cellar"; selects[1].dispatchEvent(new Event("change", { bubbles: true })) })
    await act(async () => { selects[2].value = "location"; selects[2].dispatchEvent(new Event("change", { bubbles: true })) })
    await fill('.import-column-split-settings input', "/")
    expect(button("Resolve 1 blocked row first")).toBeDefined()
    expect([...container.querySelectorAll("button")].some((node) => node.textContent === "Continue to import confirmation")).toBe(false)
    await click("Apply split to 1 row")
    await click("Continue to import confirmation")
    expect(container.textContent).toContain("Main / A1")
    expect(commitCsvImport).not.toHaveBeenCalled()
  })
  it("reviews combined names before matching, allows a reversed split, and commits only confirmed names", async () => {
    await render()
    await upload("Producer,Vintage,Color,Bottle format,Quantity,Appellation,Cellar,Location\nEstate - Hill,2020,red,75 cl,2,Village,Main,A1\nEstate - Hill,2021,red,75 cl,3,Village,Main,A1\nGarden - Estate,2022,red,75 cl,1,Village,Main,A1\nOld name,1990,red,75 cl,0,Village,Main,A1\n")
    await click("Split a column")
    expect(container.textContent).toContain("4 included rows available to split")
    expect(container.textContent).not.toContain("Preparation complete")
    await click("Exclude 1 zero-stock row")
    await click("Apply split to 2 rows")
    expect(container.textContent).toContain("1 included rows available to split")
    await click("Swap values")
    await click("Apply split to 1 row")
    expect(container.textContent).toContain("All included rows passed cleaning")
    await click("Continue to import confirmation")
    expect(container.textContent).toContain("This will add 6 bottles across 3 source rows")
    vi.mocked(commitCsvImport).mockImplementation(async (plan) => ({ importId: plan.importId, importedRowCount: 3, importedBottleCount: 6, createdWineCount: 3, reusedWineCount: 0 }))
    await act(async () => container.querySelector<HTMLInputElement>('.import-confirmation input[type="checkbox"]')!.click())
    await click("Import 6 bottles")
    const plan = vi.mocked(commitCsvImport).mock.calls[0][0]
    expect(plan.rows.map((row) => [row.wineProducer, row.wineCuvee, row.wineVintage, row.quantity])).toEqual([
      ["Estate", "Hill", 2020, 2], ["Estate", "Hill", 2021, 3], ["Estate", "Garden", 2022, 1],
    ])
  })
  it("requires manual names without a separator and resetting corrections invalidates confirmation", async () => {
    await render()
    const input = "Producer,Vintage,Color,Bottle format,Quantity,Appellation,Cellar,Location\nEstate Hill,2020,red,75 cl,2,Village,Main,A1\n"
    await upload(input)
    await click("Split a column")
    expect(button("Apply split to 1 row").disabled).toBe(true)
    await fill('.import-column-split__group label:nth-child(1) input', "Estate")
    await fill('.import-column-split__group label:nth-child(2) input', "Hill")
    expect(container.textContent).not.toContain("Preparation complete")
    await click("Apply split to 1 row")
    await click("Continue to import confirmation")
    await click("Reset all row corrections")
    expect(container.querySelector(".import-confirmation")).toBeNull()
    expect(container.textContent).toContain("1 included rows available to split")
    expect(commitCsvImport).not.toHaveBeenCalled()
    await click("Choose another file"); await upload(input)
    expect(container.querySelector<HTMLSelectElement>('.import-cuvee-fallback select')?.value).toBe("none")
    expect(container.querySelector(".import-column-split")).toBeNull()
  })
  it("searches and pages through combined names without changing what is included", async () => {
    await render()
    await upload("Producer,Vintage,Color,Bottle format,Quantity\n" + Array.from({ length: 9 }, (_, index) => `Estate ${index} - Hill,2020,red,75 cl,1`).join("\n"))
    await click("Split a column")
    expect(container.querySelectorAll(".import-column-split__group")).toHaveLength(6)
    await click("Next split groups")
    expect(container.querySelectorAll(".import-column-split__group")).toHaveLength(3)
    await fill('.import-column-split input[type="search"]', "Estate 8")
    expect(container.querySelectorAll(".import-column-split__group")).toHaveLength(1)
    expect(container.textContent).toContain("9 rows included · 0 excluded")
  })
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
