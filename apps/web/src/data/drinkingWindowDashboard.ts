import type { MaturityOverviewItem, MaturityState } from "./wineMaturity"

export interface DrinkingWindowStockRow {
  id: string
  household_id: string
  producer: string
  cuvee: string
  vintage: number | null
  quantity: number
}

export type DrinkingWindowGroup = "soon" | "ready" | "assess" | "hold" | "unassessed"

export const drinkingWindowGroupOrder: readonly DrinkingWindowGroup[] =
  ["soon", "ready", "assess", "hold", "unassessed"]

export interface DrinkingWindowItem {
  wine: DrinkingWindowStockRow
  guidance: MaturityOverviewItem | null
}

export interface DrinkingWindowGroupSummary {
  bottles: number
  wines: DrinkingWindowItem[]
}

export interface DrinkingWindowDashboardData {
  totalBottles: number
  groups: Record<DrinkingWindowGroup, DrinkingWindowGroupSummary>
}

function groupForState(state: MaturityState | null): DrinkingWindowGroup {
  if (state === "priority" || state === "assess-now") return "soon"
  if (state === "ready" || state === "assess" || state === "hold") return state
  return "unassessed"
}

function nextRelevantYear(item: DrinkingWindowItem, group: DrinkingWindowGroup): number {
  if (group === "hold" || group === "assess") return item.guidance?.firstTrialYear ?? Infinity
  return item.guidance?.drinkByYear ?? Infinity
}

export function buildDrinkingWindowDashboard(
  stockRows: readonly DrinkingWindowStockRow[],
  overview: readonly MaturityOverviewItem[],
  householdId: string,
): DrinkingWindowDashboardData {
  const byWineId = new Map(overview.map((item) => [item.wineId, item]))
  const groups = Object.fromEntries(drinkingWindowGroupOrder.map((group) =>
    [group, { bottles: 0, wines: [] as DrinkingWindowItem[] }],
  )) as Record<DrinkingWindowGroup, DrinkingWindowGroupSummary>
  let totalBottles = 0

  for (const wine of stockRows) {
    if (wine.household_id !== householdId || !Number.isSafeInteger(wine.quantity) || wine.quantity <= 0) continue
    const guidance = byWineId.get(wine.id) ?? null
    const group = groupForState(guidance?.state ?? null)
    groups[group].bottles += wine.quantity
    groups[group].wines.push({ wine, guidance })
    totalBottles += wine.quantity
  }

  for (const group of drinkingWindowGroupOrder) {
    groups[group].wines.sort((left, right) => {
      const leftYear = nextRelevantYear(left, group)
      const rightYear = nextRelevantYear(right, group)
      return (leftYear === rightYear ? 0 : leftYear - rightYear) ||
        (right.guidance?.urgencyScore ?? 0) - (left.guidance?.urgencyScore ?? 0) ||
        left.wine.producer.localeCompare(right.wine.producer) ||
        left.wine.cuvee.localeCompare(right.wine.cuvee) ||
        left.wine.id.localeCompare(right.wine.id)
    })
  }

  return { totalBottles, groups }
}
