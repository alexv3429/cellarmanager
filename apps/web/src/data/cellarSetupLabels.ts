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
