// @vitest-environment jsdom
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ImportRowEditor } from "./ImportRowEditor"
import { prepareCsvImportRows, type CsvRowCorrections } from "../data/csvImportPreparation"
import { parseCsvText } from "../data/csvIngestion"
import { suggestCsvColumnMapping } from "../data/csvColumnMapping"

const source = parseCsvText('Producer,Cuvée,Vintage,Color,Bottle format,Quantity\nTest,Old,2020,red,75 cl,0\nTest,Current,bad,white,,2\nTest,Another,bad,white,,3\n')
const mapping = suggestCsvColumnMapping(source.header!.values)
function Harness({ disabled = false, many = false }: { disabled?: boolean; many?: boolean }) {
  const [corrections, setCorrections] = useState<CsvRowCorrections>({})
  const [excluded, setExcluded] = useState(new Set<number>())
  const document = many ? { ...source, rows: Array.from({ length: 46 }, (_, i) => ({ ...source.rows[1], recordNumber: i + 2 })) } : source
  const prepared = prepareCsvImportRows({ document, mapping, corrections, excluded })
  return <ImportRowEditor rows={prepared.allRows} corrections={corrections} disabled={disabled}
    onCorrect={(changes) => setCorrections((current) => ({ ...current, ...changes }))}
    onReset={() => setCorrections({})}
    onExclude={(ids, exclude) => setExcluded((current) => {
      const next = new Set(current)
      ids.forEach((id) => exclude ? next.add(id) : next.delete(id))
      return next
    })} />
}
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function render(props = {}) { await act(async () => root.render(<Harness {...props} />)) }
function button(text: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === text)
  expect(button, text).toBeDefined(); return button!
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

describe("import row correction controls", () => {
  it("corrects a row, revalidates it, and restores its source values on reset", async () => {
    await render(); await click("Edit row 3")
    await fill('input[aria-label="Vintage for row 3"]', "NV")
    await fill('input[aria-label="Bottle format for row 3"]', "750 ml")
    await click("Save row corrections")
    expect(container.textContent).toContain("1 corrected")
    expect(container.textContent).not.toContain("Edit row 3")
    await click("Reset all row corrections")
    expect(container.textContent).toContain("Edit row 3")
    expect(source.rows[1].values[2]).toBe("bad")
  })
  it("requires explicit exclusion, restores rows and does not let filtering exclude anything", async () => {
    await render(); expect(container.textContent).toContain("3 rows included · 0 excluded")
    await click("Exclude 1 zero-stock row")
    expect(container.textContent).toContain("2 rows included · 1 excluded")
    await fill('input[type="search"]', "does not exist")
    expect(container.textContent).toContain("0 matching rows")
    expect(container.textContent).toContain("2 rows included · 1 excluded")
    await click("Include all rows again")
    expect(container.textContent).toContain("3 rows included · 0 excluded")
  })
  it("bulk-replaces exact values only in included rows", async () => {
    await render(); await click("Exclude row 4")
    await fill('.import-row-editor__bulk select:nth-of-type(1)', "vintage")
    await fill('.import-row-editor__bulk label:nth-child(2) select', "bad")
    await fill('.import-row-editor__bulk input', "NM")
    await click("Replace in 1 row")
    expect(container.textContent).toContain("1 corrected")
    await click("Include all rows again")
    await click("Edit row 4")
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Vintage for row 4"]')?.value).toBe("bad")
  })
  it("fills empty values without overwriting existing values and keeps normalization visible", async () => {
    await render()
    await fill('.import-row-editor__bulk label:nth-child(1) select', "formatMl")
    await fill('.import-row-editor__bulk input', "750 ml")
    await click("Replace in 2 rows")
    expect(container.textContent).toContain("2 corrected")
    await fill('.import-row-editor__filters select', "all")
    await click("Edit row 2")
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Bottle format for row 2"]')?.value).toBe("75 cl")
    expect(container.textContent).toContain("Bottle format: 75 cl → 750 ml")
  })
  it("reaches later rows without rendering an unbounded editor list", async () => {
    await render({ many: true })
    expect(container.querySelectorAll("article")).toHaveLength(20)
    await click("Next rows"); await click("Next rows")
    expect(container.querySelectorAll("article")).toHaveLength(6)
    expect(container.textContent).toContain("Edit row 47")
  })
  it("locks corrections and exclusions after import starts", async () => {
    await render({ disabled: true })
    expect(container.querySelector("fieldset")?.disabled).toBe(true)
    await click("Exclude 1 zero-stock row")
    expect(container.textContent).toContain("3 rows included · 0 excluded")
  })
})
