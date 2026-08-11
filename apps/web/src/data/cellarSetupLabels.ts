export function cleanSetupLabel(value: string): string {
  return value.trim().replace(/\s+/gu, " ")
}

export function requireSetupLabel(
  value: string,
  fieldName: string,
): string {
  const cleaned = cleanSetupLabel(value)

  if (cleaned.length === 0) {
    throw new Error(`${fieldName} is required`)
  }

  return cleaned
}

export function parseOptionalLocationCapacity(
  value: string,
): number | null {
  const cleaned = value.trim()

  if (cleaned.length === 0) {
    return null
  }

  if (!/^\d+$/u.test(cleaned)) {
    throw new Error(
      "Location capacity must be a positive whole number",
    )
  }

  const capacity = Number(cleaned)

  if (
    !Number.isSafeInteger(capacity) ||
    capacity <= 0 ||
    capacity > 2_147_483_647
  ) {
    throw new Error(
      "Location capacity must be a positive whole number",
    )
  }

  return capacity
}
