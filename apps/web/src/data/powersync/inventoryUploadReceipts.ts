import type { InventoryUploadReceipt, QueuedInventoryRequest } from "../inventoryRecovery"

export async function rememberInventoryUploadReceipt(receipt: InventoryUploadReceipt, request: QueuedInventoryRequest) {
  const { powerSyncDatabase } = await import("./database")
  await powerSyncDatabase.execute(`insert or replace into inventory_upload_receipts
    (id, household_id, user_id, device_id, status, request, recorded_at) values (?, ?, ?, ?, ?, ?, ?)`,
  [receipt.operation_id, receipt.household_id, receipt.user_id, receipt.device_id, receipt.status, JSON.stringify(request), new Date().toISOString()])
}
