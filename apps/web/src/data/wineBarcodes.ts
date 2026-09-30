import { supabase } from "./supabase"

export { normalizeGtin } from "./gtin"

export interface WineBarcodeLink {
  id: string
  wineId: string
  gtin14: string
}

export interface BarcodeProduct {
  name: string
  brand: string
  quantity: string
  sourceUrl: string
}

export async function findWineBarcodeLinks(householdId: string, gtin14: string): Promise<WineBarcodeLink[]> {
  const { data, error } = await supabase.from("wine_barcode_links")
    .select("id,wine_id,gtin14")
    .eq("household_id", householdId)
    .eq("gtin14", gtin14)
  if (error) throw error
  return (data ?? []).map((row) => ({ id: row.id, wineId: row.wine_id, gtin14: row.gtin14 }))
}

export async function linkWineBarcode(householdId: string, wineId: string, gtin14: string): Promise<void> {
  const { error } = await supabase.rpc("link_wine_barcode", {
    p_household_id: householdId,
    p_wine_id: wineId,
    p_gtin14: gtin14,
  })
  if (error) throw error
}

export async function unlinkWineBarcode(linkId: string): Promise<void> {
  const { error } = await supabase.rpc("unlink_wine_barcode", { p_link_id: linkId })
  if (error) throw error
}

export async function lookupBarcodeProduct(gtin14: string): Promise<BarcodeProduct | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("barcode_authentication_required")
  let response: Response
  try {
    response = await fetch("/api/barcodes/lookup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({ gtin14 }),
    })
  } catch {
    throw new Error("barcode_network_error")
  }
  if (!response.ok) {
    let reason = "lookup_unavailable"
    try {
      const body: unknown = await response.json()
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        reason = body.error
      }
    } catch {
      // The endpoint may be missing or return a non-JSON gateway error.
    }
    throw new Error(`barcode_${reason}`)
  }
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== "object" || !("product" in payload)) throw new Error("barcode_lookup_unavailable")
  if (payload.product === null) return null
  const product = payload.product
  if (!product || typeof product !== "object"
    || !("name" in product) || typeof product.name !== "string"
    || !("brand" in product) || typeof product.brand !== "string"
    || !("quantity" in product) || typeof product.quantity !== "string"
    || !("sourceUrl" in product) || typeof product.sourceUrl !== "string") throw new Error("barcode_lookup_unavailable")
  return product as BarcodeProduct
}
