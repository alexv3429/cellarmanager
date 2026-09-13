// Node-only SQLite regression; keep Node APIs outside the browser TypeScript project.
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { QUEUE_QUERY } from "./InventoryQueueReview"
import { INVENTORY_REQUEST_FIELDS } from "../data/inventoryRecovery"

describe("queued request SQLite selection", () => {
  it("hides only exact terminal receipts, not mismatched or corrupt local cache", () => {
    const db = new DatabaseSync(":memory:")
    try {
      db.exec(`create table inventory_operations (id text, status text, ${INVENTORY_REQUEST_FIELDS.map((field) => `${field} ${["quantity", "wine_vintage", "wine_format_ml"].includes(field) ? "integer" : "text"}`).join(",")});
        create table wines (id text, producer text, cuvee text);
        create table households (id text, name text); create table devices (id text, name text);
        create table cellars (id text, name text); create table locations (id text, cellar_id text, code text);
        create table inventory_upload_receipts (id text, household_id text, user_id text, device_id text, status text, request text);`)
      const payload = { household_id: "home", user_id: "self", device_id: "device", operation_type: "MOVE", wine_id: "wine",
        source_location_id: "a", destination_location_id: "b", quantity: 2, created_at_client: "2026-09-12T12:00:00Z" }
      const row = db.prepare(`insert into inventory_operations (id,status,${Object.keys(payload).join(",")}) values (?, 'PENDING', ${Object.keys(payload).map(() => "?").join(",")})`)
      const receipt = db.prepare("insert into inventory_upload_receipts values (?, ?, ?, ?, ?, ?)")
      for (const id of ["exact", "wrong-quantity", "invalid-json", "different-device", "not-terminal", "unreviewed", "other-author"]) {
        row.run(id, ...Object.values({ ...payload, user_id: id === "other-author" ? "other" : "self" }))
        if (id === "unreviewed" || id === "other-author") continue
        receipt.run(id, "home", "self", "device", id === "not-terminal" ? "PENDING" : "STOPPED",
          id === "invalid-json" ? "broken" : JSON.stringify({ id, ...payload,
            quantity: id === "wrong-quantity" ? 3 : 2, device_id: id === "different-device" ? "other-device" : "device" }))
      }
      expect(db.prepare(QUEUE_QUERY).all("self").map((row) => row.id)).toEqual([
        "different-device", "invalid-json", "not-terminal", "unreviewed", "wrong-quantity",
      ])
    } finally { db.close() }
  })
})
