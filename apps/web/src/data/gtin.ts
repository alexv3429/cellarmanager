export function normalizeGtin(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "")
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null
  if (!/[1-9]/.test(digits)) return null
  const padded = digits.padStart(14, "0")
  const sum = [...padded.slice(0, 13)].reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - sum % 10) % 10 === Number(padded[13]) ? padded : null
}
