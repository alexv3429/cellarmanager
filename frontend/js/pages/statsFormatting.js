export function formatCurrencyTotals(
  totals,
  { fallbackValue = null, fallbackCurrency = null, unknownLabel = "Unknown currency", emptyLabel = "None" } = {},
) {
  const entries = Object.entries(totals || {});
  if (!entries.length && fallbackValue !== null && fallbackValue !== undefined) {
    entries.push([fallbackCurrency || "UNKNOWN", fallbackValue]);
  }
  if (!entries.length) return emptyLabel;
  return entries
    .map(([currency, amount]) => `${Number(amount).toFixed(2)} ${currency === "UNKNOWN" ? unknownLabel : currency}`)
    .join(" · ");
}
