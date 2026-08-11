import { describe, expect, it } from "vitest"

import {
  parseInventoryActionQuantity,
  toggleInventoryHoldingAction,
} from "./inventoryActionForms"

describe("inventory action forms", () => {
  it("opens, switches, and closes one holding action", () => {
    const addAction = toggleInventoryHoldingAction(
      null,
      "holding-1",
      "add",
    )

    expect(addAction).toEqual({
      action: "add",
      holdingId: "holding-1",
    })

    expect(
      toggleInventoryHoldingAction(
        addAction,
        "holding-1",
        "move",
      ),
    ).toEqual({
      action: "move",
      holdingId: "holding-1",
    })

    expect(
      toggleInventoryHoldingAction(
        addAction,
        "holding-1",
        "add",
      ),
    ).toBeNull()

    expect(
      toggleInventoryHoldingAction(
        addAction,
        "holding-2",
        "add",
      ),
    ).toEqual({
      action: "add",
      holdingId: "holding-2",
    })
  })

  it("accepts positive whole quantities within a holding", () => {
    expect(parseInventoryActionQuantity("1", 3)).toBe(1)
    expect(parseInventoryActionQuantity("3", 3)).toBe(3)
  })

  it("rejects invalid or excessive quantities", () => {
    expect(parseInventoryActionQuantity("0", 3)).toBeNull()
    expect(parseInventoryActionQuantity("1.5", 3)).toBeNull()
    expect(parseInventoryActionQuantity("4", 3)).toBeNull()
    expect(parseInventoryActionQuantity("wine", 3)).toBeNull()
  })

  it("allows an unbounded positive add quantity", () => {
    expect(parseInventoryActionQuantity("12")).toBe(12)
  })
})
