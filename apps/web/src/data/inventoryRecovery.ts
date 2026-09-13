export interface QueuedInventoryRequest {
  id: string
  household_id: string
  user_id: string
  device_id: string
  operation_type: "ADD" | "MOVE" | "REMOVE"
  wine_id: string
  source_location_id: string | null
  destination_location_id: string | null
  quantity: number
  remove_reason: string | null
  created_at_client: string
  wine_producer?: string | null
  wine_cuvee?: string | null
  wine_vintage?: number | null
  wine_color?: string | null
  wine_appellation?: string | null
  wine_area?: string | null
  wine_format_ml?: number | null
  wine_label: string | null
  household_label: string | null
  device_label: string | null
  source_label: string | null
  destination_label: string | null
}
export interface InventoryUploadReceipt {
  operation_id: string
  household_id: string
  user_id: string
  device_id: string
  status: "ACCEPTED" | "REJECTED" | "STOPPED"
  error_code: string | null
}
export interface StoppedInventoryUpload extends InventoryUploadReceipt {
  request: QueuedInventoryRequest
  stopped_at: string
}

export const INVENTORY_REQUEST_FIELDS = ["household_id", "user_id", "device_id", "operation_type", "wine_id", "quantity",
  "source_location_id", "destination_location_id", "remove_reason", "created_at_client",
  "wine_producer", "wine_cuvee", "wine_vintage", "wine_color", "wine_appellation", "wine_area", "wine_format_ml"] as const

export function matchesReviewedInventoryRequest(json: string, id: string, data: Record<string, unknown>): boolean {
  try {
    const saved = record(JSON.parse(json))
    return saved.id === id && INVENTORY_REQUEST_FIELDS
      .every((key) => (saved[key] ?? null) === (data[key] ?? null))
  } catch { return false }
}
type Rpc = (name: string, params: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: { message: string } | null }>

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid inventory recovery response")
  return value as Record<string, unknown>
}
export function parseInventoryUploadReceipt(value: unknown, request: QueuedInventoryRequest): InventoryUploadReceipt {
  const data = record(value)
  if (data.operation_id !== request.id || data.household_id !== request.household_id ||
    data.user_id !== request.user_id || data.device_id !== request.device_id ||
    !["ACCEPTED", "REJECTED", "STOPPED"].includes(String(data.status))) {
    throw new Error("The server receipt does not match this queued request. Nothing was acknowledged locally.")
  }
  return { operation_id: request.id, household_id: request.household_id, user_id: request.user_id,
    device_id: request.device_id, status: data.status as InventoryUploadReceipt["status"],
    error_code: typeof data.error_code === "string" ? data.error_code : null }
}
async function call(name: string, params: Record<string, unknown>, rpc?: Rpc) {
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, params)
  if (result.error) throw new Error(result.error.message)
  return result.data
}
export async function stopInventoryUpload(request: QueuedInventoryRequest, userId: string, rpc?: Rpc) {
  if (request.user_id !== userId) throw new Error("Only the originating account can stop this upload")
  return parseInventoryUploadReceipt(await call("stop_inventory_upload", {
    p_operation_id: request.id, p_request: request,
  }, rpc), request)
}
export async function getStoppedInventoryUploads(householdId: string | null, userId: string, rpc?: Rpc): Promise<StoppedInventoryUpload[]> {
  const data = await call("get_stopped_inventory_uploads", { p_household_id: householdId }, rpc)
  if (!Array.isArray(data)) throw new Error("Invalid stopped-upload history")
  return data.map((value) => {
    const item = record(value)
    const request = record(item.request) as unknown as QueuedInventoryRequest
    if (item.user_id !== userId || (householdId !== null && item.household_id !== householdId) || request.id !== item.operation_id ||
      !["ADD", "MOVE", "REMOVE"].includes(request.operation_type) || !Number.isInteger(request.quantity) || request.quantity <= 0 ||
      (request.wine_label != null && typeof request.wine_label !== "string") ||
      typeof item.stopped_at !== "string" || Number.isNaN(Date.parse(item.stopped_at))) throw new Error("Invalid stopped-upload scope")
    return { ...parseInventoryUploadReceipt({ ...item, status: "STOPPED" }, request), request, stopped_at: item.stopped_at }
  })
}

export function describeInventoryRejection(code: string | null): { title: string; explanation: string; nextStep: string } {
  if (code === "INSUFFICIENT_STOCK") return {
    title: "Not enough bottles at the source",
    explanation: "There were not enough bottles at that location when the server checked. Another device may have moved or removed them first.",
    nextStep: "Review the wine’s current locations and quantity. If a change is still needed, create a new request for the right location and quantity.",
  }
  if (code === "LOCATION_ARCHIVED") return {
    title: "The storage location is archived",
    explanation: "The source or destination was no longer active when the server checked.",
    nextStep: "Review current stock and choose an active location for any new change. An Owner can review archived storage in Cellar setup.",
  }
  if (code === "USER_CANCELLED") return {
    title: "The request was stopped",
    explanation: "The originating account stopped this request before it was accepted.",
    nextStep: "Review current stock before making a separate new change if one is still needed.",
  }
  return {
    title: "This change could not be applied",
    explanation: "The server did not accept this request. The technical details are available below.",
    nextStep: "Review current stock before making another change. Keep the request ID if you need help understanding the rejection.",
  }
}
