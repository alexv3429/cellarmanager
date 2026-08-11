export type InventoryHoldingAction =
  | "add"
  | "move"
  | "remove"

export interface ActiveInventoryHoldingAction {
  action: InventoryHoldingAction
  holdingId: string
}

export function toggleInventoryHoldingAction(
  current: ActiveInventoryHoldingAction | null,
  holdingId: string,
  action: InventoryHoldingAction,
): ActiveInventoryHoldingAction | null {
  if (
    current?.holdingId === holdingId &&
    current.action === action
  ) {
    return null
  }

  return { action, holdingId }
}

export function parseInventoryActionQuantity(
  value: string,
  maximum: number | null = null,
): number | null {
  const quantity = Number(value)

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    (maximum !== null && quantity > maximum)
  ) {
    return null
  }

  return quantity
}
