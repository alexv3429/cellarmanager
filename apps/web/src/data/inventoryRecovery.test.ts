import { describe, expect, it, vi } from "vitest"
import { describeInventoryRejection, getStoppedInventoryUploads, matchesReviewedInventoryRequest, parseInventoryUploadReceipt, stopInventoryUpload, type QueuedInventoryRequest } from "./inventoryRecovery"

const request: QueuedInventoryRequest = {
  id: "op", household_id: "household", user_id: "self", device_id: "device", operation_type: "MOVE", wine_id: "wine",
  source_location_id: "a", destination_location_id: "b", quantity: 2, remove_reason: null, created_at_client: "2026-09-12T12:00:00Z",
  wine_label: "Synthetic wine", household_label: "Home", device_label: "Phone", source_label: "A", destination_label: "B",
}
const receipt = { operation_id: request.id, household_id: request.household_id, user_id: request.user_id, device_id: request.device_id, status: "STOPPED", error_code: "USER_CANCELLED" }

describe("inventory recovery boundaries", () => {
  it.each(["ACCEPTED", "REJECTED", "STOPPED"])("accepts a scoped %s receipt", (status) => {
    expect(parseInventoryUploadReceipt({ ...receipt, status }, request).status).toBe(status)
  })
  it.each(["operation_id", "household_id", "user_id", "device_id", "status"])("rejects a mismatched %s", (key) => {
    expect(() => parseInventoryUploadReceipt({ ...receipt, [key]: "wrong" }, request)).toThrow("does not match")
  })
  it("does not treat a missing server receipt as success", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    await expect(stopInventoryUpload(request, "self", rpc)).rejects.toThrow("Invalid inventory recovery response")
  })
  it("submits the original request once and never retries an uncertain write", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "Response lost" } }))
    await expect(stopInventoryUpload(request, "self", rpc)).rejects.toThrow("Response lost")
    expect(rpc).toHaveBeenCalledExactlyOnceWith("stop_inventory_upload", { p_operation_id: "op", p_request: request })
  })
  it("never submits another account’s request", async () => {
    const rpc = vi.fn()
    await expect(stopInventoryUpload(request, "other", rpc)).rejects.toThrow("originating account")
    expect(rpc).not.toHaveBeenCalled()
  })
  it("matches an exact queued payload, ignoring display labels and optional nulls", () => {
    expect(matchesReviewedInventoryRequest(JSON.stringify(request), "op", { ...request, wine_label: "Renamed", wine_vintage: null })).toBe(true)
    expect(matchesReviewedInventoryRequest("not json", "op", request as unknown as Record<string, unknown>)).toBe(false)
  })
  it.each(["household_id", "user_id", "device_id", "operation_type", "wine_id", "quantity", "source_location_id", "destination_location_id", "remove_reason", "created_at_client", "wine_producer", "wine_cuvee", "wine_vintage", "wine_color", "wine_appellation", "wine_area", "wine_format_ml"])("cannot acknowledge changed %s", (key) => {
    expect(matchesReviewedInventoryRequest(JSON.stringify(request), "op", { ...request, [key]: "changed" })).toBe(false)
  })
  it("cannot acknowledge a different UUID", () => {
    expect(matchesReviewedInventoryRequest(JSON.stringify(request), "other", { ...request })).toBe(false)
  })
  it("loads only scoped private history with safe display values", async () => {
    const entry = { ...receipt, request, stopped_at: "2026-09-12T13:00:00Z" }
    const rpc = vi.fn(async () => ({ data: [entry], error: null }))
    expect(await getStoppedInventoryUploads("household", "self", rpc)).toEqual([entry])
    for (const bad of [{ ...entry, user_id: "other" }, { ...entry, household_id: "other" }, { ...entry, stopped_at: "wrong" },
      { ...entry, request: { ...request, user_id: "other" } }, { ...entry, request: { ...request, wine_label: {} } },
      { ...entry, request: { ...request, quantity: 0 } }]) {
      rpc.mockResolvedValueOnce({ data: [bad as typeof entry], error: null })
      await expect(getStoppedInventoryUploads("household", "self", rpc)).rejects.toThrow()
    }
  })
  it("explains terminal rejections without claiming a stock effect or prescribing an automatic retry", () => {
    expect(describeInventoryRejection("INSUFFICIENT_STOCK").explanation).toContain("may have")
    expect(describeInventoryRejection("LOCATION_ARCHIVED").nextStep).toContain("active location")
    expect(describeInventoryRejection("USER_CANCELLED").explanation).toContain("before it was accepted")
    expect(describeInventoryRejection("UNFAMILIAR").explanation).toContain("did not accept")
  })
})
