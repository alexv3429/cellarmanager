interface ComparisonRow {
  wineId: string
  comparisonStatus: string
}

const priority: Record<string, number> = {
  changed: 0,
  new_reference_no_baseline: 1,
  expired_baseline: 2,
  manual_preserved: 3,
  identity_conflict: 4,
  ambiguous: 5,
  missing_key: 6,
  no_match: 7,
  unchanged: 8,
}

export function orderShadowComparisonRows<T extends ComparisonRow>(
  rows: T[], names: Map<string, string>,
): T[] {
  return [...rows].sort((a, b) =>
    (priority[a.comparisonStatus] ?? 7) - (priority[b.comparisonStatus] ?? 7)
    || (names.get(a.wineId) ?? a.wineId).localeCompare(names.get(b.wineId) ?? b.wineId),
  )
}
