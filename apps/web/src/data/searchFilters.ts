export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, " ")
}

export function matchesSearch(
  fields: Array<string | number | null | undefined>,
  query: string,
): boolean {
  const normalizedQuery = normalizeSearchText(query)

  if (normalizedQuery.length === 0) {
    return true
  }

  const haystack = normalizeSearchText(
    fields
      .filter(
        (field): field is string | number =>
          field !== null && field !== undefined,
      )
      .join(" "),
  )

  return normalizedQuery
    .split(" ")
    .every((term) => haystack.includes(term))
}
