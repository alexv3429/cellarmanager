export type AcquisitionKind = "PURCHASE" | "GIFT" | "OTHER"

export interface WineAcquisition {
  id: string
  household_id: string
  wine_id: string
  acquisition_kind: AcquisitionKind
  quantity: number
  acquired_on: string | null
  unit_price_amount: number | string | null
  price_currency: string | null
  source_name: string | null
  note: string | null
  source_kind: "MANUAL" | "LEGACY_V01"
  created_at: string
}

export interface LegacyHoldingPrice {
  source_holding_id: string
  price_bought: number | string | null
  acquired_on: string | null
}

export interface WineAcquisitionDraft {
  kind: AcquisitionKind
  quantity: string
  acquiredOn: string
  unitPrice: string
  currency: string
  sourceName: string
  note: string
}

export interface PreparedAcquisition {
  kind: AcquisitionKind
  quantity: number
  acquiredOn: string | null
  unitPrice: string | null
  currency: string | null
  sourceName: string | null
  note: string | null
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}

export function prepareWineAcquisition(draft: WineAcquisitionDraft): PreparedAcquisition {
  if (!["PURCHASE", "GIFT", "OTHER"].includes(draft.kind)) {
    throw new Error("acquisition.validationKind")
  }
  const quantity = Number(draft.quantity)
  if (!/^\d+$/.test(draft.quantity.trim()) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2_147_483_647) {
    throw new Error("acquisition.validationQuantity")
  }
  const acquiredOn = draft.acquiredOn.trim() || null
  if (acquiredOn !== null && !validCalendarDate(acquiredOn)) {
    throw new Error("acquisition.validationDate")
  }
  const sourceName = draft.sourceName.trim() || null
  const note = draft.note.trim() || null
  if (sourceName && sourceName.length > 200) throw new Error("acquisition.validationSource")
  if (note && note.length > 500) throw new Error("acquisition.validationNote")

  const priceText = draft.unitPrice.trim().replace(",", ".")
  const currencyText = draft.currency.trim().toUpperCase()
  if (!priceText) {
    return { kind: draft.kind, quantity, acquiredOn, unitPrice: null, currency: null, sourceName, note }
  }
  if (draft.kind !== "PURCHASE") throw new Error("acquisition.validationPriceKind")
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(priceText) || Number(priceText) > 9_999_999_999.99) {
    throw new Error("acquisition.validationPrice")
  }
  if (!/^[A-Z]{3}$/.test(currencyText)) throw new Error("acquisition.validationCurrency")
  return { kind: draft.kind, quantity, acquiredOn, unitPrice: priceText, currency: currencyText, sourceName, note }
}

export async function listWineAcquisitions(householdId: string, wineId: string): Promise<WineAcquisition[]> {
  const { supabase } = await import("./supabase")
  const { data, error } = await supabase.from("wine_acquisitions")
    .select("id, household_id, wine_id, acquisition_kind, quantity, acquired_on, unit_price_amount, price_currency, source_name, note, source_kind, created_at")
    .eq("household_id", householdId)
    .eq("wine_id", wineId)
    .is("voided_at", null)
    .order("acquired_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WineAcquisition[]
}

export async function listLegacyHoldingPrices(householdId: string, wineId: string): Promise<LegacyHoldingPrice[]> {
  const { supabase } = await import("./supabase")
  const { data, error } = await supabase.from("legacy_holding_prices")
    .select("source_holding_id, price_bought, acquired_on")
    .eq("household_id", householdId)
    .eq("wine_id", wineId)
    .order("source_holding_id")
  if (error) throw new Error(error.message)
  return (data ?? []) as LegacyHoldingPrice[]
}

export async function saveWineAcquisition(id: string, wineId: string, value: PreparedAcquisition): Promise<void> {
  const { supabase } = await import("./supabase")
  const { error } = await supabase.rpc("upsert_wine_acquisition", {
    p_id: id,
    p_wine_id: wineId,
    p_acquisition_kind: value.kind,
    p_quantity: value.quantity,
    p_acquired_on: value.acquiredOn,
    p_unit_price_amount: value.unitPrice,
    p_price_currency: value.currency,
    p_source_name: value.sourceName,
    p_note: value.note,
  })
  if (error) throw new Error(error.message)
}

export async function voidWineAcquisition(id: string): Promise<void> {
  const { supabase } = await import("./supabase")
  const { error } = await supabase.rpc("void_wine_acquisition", { p_id: id })
  if (error) throw new Error(error.message)
}
