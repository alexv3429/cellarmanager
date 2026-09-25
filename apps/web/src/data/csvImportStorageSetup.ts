import { cleanSetupLabel, requireSetupLabel } from "./cellarSetupLabels"
import type { CsvStorageCellar, CsvStorageLocation, CsvStorageReconciliationResult } from "./csvStorageReconciliation"

export const storageNameKey = (value: string) => cleanSetupLabel(value).toLowerCase()
export const isActiveStorage = (value: CsvStorageCellar["is_active"]) => value === true || value === 1

export interface ImportStorageGroup {
  key: string
  sourceCellar: string
  sourceCellars: string[]
  locations: { key: string; sourceLocation: string; sourceExamples: string[]; records: number[]; bottles: number }[]
}
export type StorageTarget = { kind: "existing"; id: string } | { kind: "new"; name: string }
export interface ImportStorageFamilyRule {
  sourceCellars: string[]
  destinationCellarName: string
  locationMode: "suffix" | "full-label"
}
export interface ImportStorageChoices {
  cellar: StorageTarget
  locations: Record<string, StorageTarget>
}
export interface ImportStorageSnapshot {
  cellars: CsvStorageCellar[]
  locations: Pick<CsvStorageLocation, "id" | "household_id" | "cellar_id" | "code" | "is_active">[]
}

export function familyLocationLabel(sourceCellar: string, sourceLocation: string, rule: ImportStorageFamilyRule): string {
  const suffix = sourceCellar.match(/(\d+)$/u)?.[1]
  const base = rule.locationMode === "suffix" && suffix ? suffix : sourceCellar
  return [base, sourceLocation.trim()].filter(Boolean).join(" / ")
}

export function suggestImportStorageFamilies(groups: ImportStorageGroup[]) {
  const candidates = new Map<string, { prefix: string; sourceCellars: string[] }>()
  for (const group of groups) {
    if (!group.sourceCellar.trim()) continue
    const label = group.sourceCellar.trim()
    const spaced = label.match(/^(.*?)[\s_-]+(\d+)$/u)
    const compact = spaced ? null : label.match(/^([^\d]+)(\d+)$/u)
    const prefix = (spaced?.[1] ?? compact?.[1] ?? "").trim()
    if (!prefix) continue
    const key = storageNameKey(prefix)
    const candidate = candidates.get(key) ?? { prefix, sourceCellars: [] }
    if (!candidate.sourceCellars.some((value) => storageNameKey(value) === group.key)) {
      candidate.sourceCellars.push(label)
    }
    candidates.set(key, candidate)
  }
  return [...candidates.entries()]
    .map(([key, candidate]) => ({ key, ...candidate }))
    .filter((candidate) => candidate.sourceCellars.length > 1)
    .map((candidate) => ({
      ...candidate,
      sourceCellars: candidate.sourceCellars.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix))
}

export function groupImportStorage(
  results: CsvStorageReconciliationResult[],
  familyRules: ImportStorageFamilyRule[] = [],
): ImportStorageGroup[] {
  const ruleBySource = new Map<string, ImportStorageFamilyRule>()
  for (const rule of familyRules) {
    for (const sourceCellar of rule.sourceCellars) {
      const key = storageNameKey(sourceCellar)
      if (ruleBySource.has(key)) throw new Error(`Source cellar “${sourceCellar}” is included in more than one grouping rule`)
      ruleBySource.set(key, rule)
    }
  }
  const groups = new Map<string, ImportStorageGroup>()
  for (const result of results) {
    if (result.status !== "unresolved" || result.row.issues.length || result.quantity === null || result.quantity <= 0) continue
    const originalCellar = result.row.fields.cellar?.trim() ?? ""
    const originalLocation = result.row.fields.location?.trim() ?? ""
    const rule = ruleBySource.get(storageNameKey(originalCellar))
    const sourceCellar = rule?.destinationCellarName.trim() || originalCellar
    const sourceLocation = rule
      ? familyLocationLabel(originalCellar, originalLocation, rule)
      : originalLocation
    const key = storageNameKey(sourceCellar)
    const group = groups.get(key) ?? { key, sourceCellar, sourceCellars: [], locations: [] }
    if (!group.sourceCellars.some((value) => storageNameKey(value) === storageNameKey(originalCellar))) {
      group.sourceCellars.push(originalCellar)
    }
    const locationKey = storageNameKey(sourceLocation)
    let location = group.locations.find((item) => item.key === locationKey)
    if (!location) {
      location = { key: locationKey, sourceLocation, sourceExamples: [], records: [], bottles: 0 }
      group.locations.push(location)
    }
    const sourceExample = `${originalCellar || "No cellar"}${originalLocation ? ` / ${originalLocation}` : ""}`
    if (!location.sourceExamples.includes(sourceExample) && location.sourceExamples.length < 4) {
      location.sourceExamples.push(sourceExample)
    }
    location.records.push(result.row.recordNumber)
    location.bottles += result.quantity
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.sourceCellars.sort((a, b) => a.localeCompare(b))
    group.locations.sort((a, b) => a.sourceLocation.localeCompare(b.sourceLocation))
  }
  return [...groups.values()].sort((a, b) => a.sourceCellar.localeCompare(b.sourceCellar))
}

export function initialStorageChoices(group: ImportStorageGroup, snapshot: ImportStorageSnapshot, householdId: string, selectedCellar?: StorageTarget): ImportStorageChoices {
  const matches = snapshot.cellars.filter((cellar) => cellar.household_id === householdId &&
    isActiveStorage(cellar.is_active) && storageNameKey(cellar.name) === group.key)
  const cellar: StorageTarget = selectedCellar ?? (matches.length === 1
    ? { kind: "existing", id: matches[0].id } : { kind: "new", name: group.sourceCellar })
  return { cellar, locations: Object.fromEntries(group.locations.map((source) => {
    const name = source.sourceLocation || "General"
    const matches = snapshot.locations.filter((location) => cellar.kind === "existing" &&
      location.cellar_id === cellar.id && location.household_id === householdId &&
      isActiveStorage(location.is_active) && storageNameKey(location.code) === storageNameKey(name))
    return [source.key, matches.length === 1 ? { kind: "existing", id: matches[0].id } : { kind: "new", name }]
  })) }
}

interface SetupDependencies {
  read: (householdId: string) => Promise<ImportStorageSnapshot>
  createCellar: (householdId: string, name: string) => Promise<string>
  createLocation: (householdId: string, cellarId: string, name: string) => Promise<string>
}

const defaultDependencies: SetupDependencies = {
  async read(householdId) {
    const { supabase } = await import("./supabase")
    async function readAll<T>(table: "cellars" | "locations", columns: string): Promise<T[]> {
      const rows: T[] = []
      for (let offset = 0; ; offset += 500) {
        const page = await supabase.from(table).select(columns).eq("household_id", householdId).order("id").range(offset, offset + 499)
        if (page.error) throw new Error(page.error.message)
        const data = (page.data ?? []) as unknown as T[]
        rows.push(...data)
        if (data.length < 500) return rows
      }
    }
    const [cellars, locations] = await Promise.all([
      readAll<CsvStorageCellar>("cellars", "id, household_id, name, is_active"),
      readAll<ImportStorageSnapshot["locations"][number]>("locations", "id, household_id, cellar_id, code, is_active"),
    ])
    return { cellars, locations }
  },
  async createCellar(householdId, name) {
    return (await import("./cellarSetup")).createCellar(householdId, name)
  },
  async createLocation(householdId, cellarId, name) {
    return (await import("./cellarSetup")).createLocation(householdId, cellarId, name, "", "mixed")
  },
}

function resolveTarget<T extends { id: string; is_active: CsvStorageCellar["is_active"] }>(
  target: StorageTarget, items: T[], label: (item: T) => string, field: string,
): { id: string | null; name: string } {
  if (target.kind === "existing") {
    const item = items.find((item) => item.id === target.id && isActiveStorage(item.is_active))
    if (!item) throw new Error(`The selected ${field.toLowerCase()} is no longer active in this household and cellar. Review the selection.`)
    return { id: item.id, name: label(item) }
  }
  const name = requireSetupLabel(target.name, field)
  const matches = items.filter((item) => storageNameKey(label(item)) === storageNameKey(name))
  if (matches.some((item) => !isActiveStorage(item.is_active))) throw new Error(`${field} “${name}” is archived. Choose another name or active destination; archived storage is never restored by an import.`)
  if (matches.length > 1) throw new Error(`${field} “${name}” is ambiguous. Select an existing destination explicitly.`)
  return { id: matches[0]?.id ?? null, name }
}

// Setup is deliberately separate from the atomic bottle import. Fresh server
// reads and normalized-name uniqueness make partial/lost-response retries safe.
// No optimistic storage is injected into the synchronized inventory preview.
export async function saveImportStorageGroup(householdId: string, group: ImportStorageGroup,
  choices: ImportStorageChoices, dependencies: SetupDependencies = defaultDependencies): Promise<Record<number, string>> {
  if (!group.locations.length) throw new Error("No storage rows remain in this group")
  const snapshot = await dependencies.read(householdId)
  const cellar = resolveTarget(choices.cellar, snapshot.cellars.filter((item) => item.household_id === householdId), (item) => item.name, "Cellar")
  const locations = snapshot.locations.filter((item) => item.household_id === householdId && item.cellar_id === cellar.id)
  // Validate the entire group before making the first setup write.
  const planned = group.locations.map((source) => {
    const target = choices.locations[source.key]
    if (!target) throw new Error("Choose a destination for every source location")
    return { source, ...resolveTarget(target, locations, (item) => item.code, "Location") }
  })
  const cellarId = cellar.id ?? await dependencies.createCellar(householdId, cellar.name)
  const byName = new Map<string, string>()
  const assignments: Record<number, string> = {}
  for (const location of planned) {
    const key = storageNameKey(location.name)
    const id = location.id ?? byName.get(key) ?? await dependencies.createLocation(householdId, cellarId, location.name)
    byName.set(key, id)
    for (const record of location.source.records) assignments[record] = id
  }
  return assignments
}
