import { describe, expect, it, vi } from "vitest"
import { cleanCsvMappedRow } from "./csvCleaning"
import { reconcileCsvStorage } from "./csvStorageReconciliation"
import { groupImportStorage, initialStorageChoices, saveImportStorageGroup, type ImportStorageSnapshot } from "./csvImportStorageSetup"

function groups(rows: [string, string, number][]) {
  return groupImportStorage(reconcileCsvStorage(rows.map(([cellar, location, quantity], i) => cleanCsvMappedRow({
    recordNumber: i + 2, sourceLineStart: i + 2, sourceLineEnd: i + 2, unmapped: [],
    fields: { producer: "Synthetic", cuvee: "Test", color: "red", formatMl: "750", quantity: String(quantity), cellar, location },
  })), [], [], "h"))
}
function fixture() {
  const snapshot: ImportStorageSnapshot = { cellars: [], locations: [] }
  const dependencies = {
    read: vi.fn(async () => snapshot),
    createCellar: vi.fn(async (household_id: string, name: string) => {
      const id = `cellar-${snapshot.cellars.length}`
      snapshot.cellars.push({ id, household_id, name, is_active: true }); return id
    }),
    createLocation: vi.fn(async (household_id: string, cellar_id: string, code: string) => {
      const id = `location-${snapshot.locations.length}`
      snapshot.locations.push({ id, household_id, cellar_id, code, is_active: true }); return id
    }),
  }
  return { snapshot, dependencies }
}

describe("grouped import storage", () => {
  it("groups by normalized cellar and location, excludes zero and invalid rows, and retains record IDs", () => {
    const result = groups([[" Bar ", "", 1], ["bar", "", 2], ["Bar", "Shelf 1", 3], ["Frigo", "", 1], ["Historical", "", 0], ["Bad", "", -1]])
    expect(result).toEqual([
      { key: "bar", sourceCellar: "Bar", locations: [{ key: "", sourceLocation: "", records: [2, 3], bottles: 3 }, { key: "shelf 1", sourceLocation: "Shelf 1", records: [4], bottles: 3 }] },
      { key: "frigo", sourceCellar: "Frigo", locations: [{ key: "", sourceLocation: "", records: [5], bottles: 1 }] },
    ])
  })
  it("creates distinct cellars and all reviewed locations, assigning only each group's rows", async () => {
    const { snapshot, dependencies } = fixture()
    const [bar, frigo] = groups([["Bar", "", 1], ["Bar", "Top", 2], ["Frigo", "", 3]])
    const barResult = await saveImportStorageGroup("h", bar, initialStorageChoices(bar, snapshot, "h"), dependencies)
    expect(barResult).toEqual({ 2: "location-0", 3: "location-1" })
    expect(dependencies.createCellar).toHaveBeenCalledTimes(1)
    expect(dependencies.createLocation.mock.calls).toEqual([["h", "cellar-0", "General"], ["h", "cellar-0", "Top"]])
    expect(await saveImportStorageGroup("h", frigo, initialStorageChoices(frigo, snapshot, "h"), dependencies)).toEqual({ 4: "location-2" })
    expect(snapshot.cellars.map((c) => c.name)).toEqual(["Bar", "Frigo"])
  })
  it("lets the user map a group to another existing cellar and location without creating setup", async () => {
    const { snapshot, dependencies } = fixture()
    snapshot.cellars.push({ id: "main", household_id: "h", name: "Main", is_active: true })
    snapshot.locations.push({ id: "existing", household_id: "h", cellar_id: "main", code: "A1", is_active: true })
    const [group] = groups([["Bar", "", 2]])
    expect(await saveImportStorageGroup("h", group, { cellar: { kind: "existing", id: "main" }, locations: { "": { kind: "existing", id: "existing" } } }, dependencies)).toEqual({ 2: "existing" })
    expect(dependencies.createCellar).not.toHaveBeenCalled()
    expect(dependencies.createLocation).not.toHaveBeenCalled()
  })
  it("deduplicates reviewed locations with the same final name, without collapsing different cellars", async () => {
    const { snapshot, dependencies } = fixture()
    const [group] = groups([["Bar", "", 2], ["Bar", "General", 1]])
    const result = await saveImportStorageGroup("h", group, initialStorageChoices(group, snapshot, "h"), dependencies)
    expect(result[2]).toBe(result[3]); expect(dependencies.createLocation).toHaveBeenCalledTimes(1)
  })
  it("reuses active names on partial and lost-response retries without duplicating setup", async () => {
    const { snapshot, dependencies } = fixture()
    const [group] = groups([["Bar", "A", 2], ["Bar", "B", 3]])
    const choices = initialStorageChoices(group, snapshot, "h")
    const create = dependencies.createLocation.getMockImplementation()!
    dependencies.createLocation.mockImplementationOnce(create).mockImplementationOnce(async (...args) => { await create(...args); throw new Error("Response lost") })
    await expect(saveImportStorageGroup("h", group, choices, dependencies)).rejects.toThrow("Response lost")
    expect(snapshot.locations).toHaveLength(2)
    const result = await saveImportStorageGroup("h", group, choices, dependencies)
    expect(result).toEqual({ 2: "location-0", 3: "location-1" })
    expect(dependencies.createCellar).toHaveBeenCalledTimes(1)
    expect(dependencies.createLocation).toHaveBeenCalledTimes(2)
  })
  it("validates every target before creating a cellar", async () => {
    const { snapshot, dependencies } = fixture()
    const [group] = groups([["Bar", "A", 1], ["Bar", "B", 1]])
    const choices = initialStorageChoices(group, snapshot, "h")
    choices.locations.b = { kind: "new", name: "   " }
    await expect(saveImportStorageGroup("h", group, choices, dependencies)).rejects.toThrow("Location is required")
    expect(dependencies.createCellar).not.toHaveBeenCalled()
    expect(dependencies.createLocation).not.toHaveBeenCalled()
  })
  it("requires a user-supplied cellar for rows without a source cellar", async () => {
    const { snapshot, dependencies } = fixture()
    const [group] = groups([["", "A1", 1]])
    await expect(saveImportStorageGroup("h", group, initialStorageChoices(group, snapshot, "h"), dependencies)).rejects.toThrow("Cellar is required")
    expect(dependencies.createCellar).not.toHaveBeenCalled()
  })
  it.each(["archived", "ambiguous", "foreign"])("does not silently reuse %s cellars", async (kind) => {
    const { snapshot, dependencies } = fixture()
    snapshot.cellars.push({ id: "existing", household_id: kind === "foreign" ? "other" : "h", name: "Bar", is_active: kind !== "archived" })
    if (kind === "ambiguous") snapshot.cellars.push({ ...snapshot.cellars[0], id: "duplicate" })
    const [group] = groups([["Bar", "", 1]])
    const choices = initialStorageChoices(group, { cellars: [], locations: [] }, "h")
    if (kind === "foreign") choices.cellar = { kind: "existing", id: "existing" }
    await expect(saveImportStorageGroup("h", group, choices, dependencies)).rejects.toThrow()
    expect(dependencies.createCellar).not.toHaveBeenCalled()
    expect(dependencies.createLocation).not.toHaveBeenCalled()
  })
  it("rejects locations from another cellar, another household, or archived since review", async () => {
    for (const patch of [{ cellar_id: "other" }, { household_id: "other" }, { is_active: false }]) {
      const { snapshot, dependencies } = fixture()
      snapshot.cellars.push({ id: "main", household_id: "h", name: "Main", is_active: true })
      snapshot.locations.push({ id: "existing", household_id: "h", cellar_id: "main", code: "A1", is_active: true, ...patch })
      const [group] = groups([["Bar", "", 1]])
      await expect(saveImportStorageGroup("h", group, { cellar: { kind: "existing", id: "main" }, locations: { "": { kind: "existing", id: "existing" } } }, dependencies)).rejects.toThrow("no longer active")
      expect(dependencies.createLocation).not.toHaveBeenCalled()
    }
  })
  it("fails closed if the fresh storage read fails", async () => {
    const { snapshot, dependencies } = fixture()
    dependencies.read.mockRejectedValue(new Error("offline"))
    const [group] = groups([["Bar", "", 1]])
    await expect(saveImportStorageGroup("h", group, initialStorageChoices(group, snapshot, "h"), dependencies)).rejects.toThrow("offline")
    expect(dependencies.createCellar).not.toHaveBeenCalled()
  })
})
