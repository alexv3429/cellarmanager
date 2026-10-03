import { beforeEach, describe, expect, it, vi } from "vitest"

import { listLegacyHoldingPrices } from "./wineAcquisitions"

const database = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("./supabase", () => ({ supabase: database }))

beforeEach(() => database.from.mockReset())

describe("legacy holding prices after a wine merge", () => {
  it("reads prices for the active card and its retired source cards", async () => {
    const mergedFilter = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: "old-wine" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    const wineHouseholdFilter = vi.fn().mockReturnValue({ in: mergedFilter })
    const wineSelect = vi.fn().mockReturnValue({ eq: wineHouseholdFilter })
    const priceOrder = vi.fn().mockResolvedValue({
      data: [
        { source_holding_id: "old-holding", wine_id: "old-wine", price_bought: "20.00", acquired_on: null },
        { source_holding_id: "new-holding", wine_id: "current-wine", price_bought: "21.00", acquired_on: null },
      ],
      error: null,
    })
    const priceIdsFilter = vi.fn().mockReturnValue({ order: priceOrder })
    const priceHouseholdFilter = vi.fn().mockReturnValue({ in: priceIdsFilter })
    const priceSelect = vi.fn().mockReturnValue({ eq: priceHouseholdFilter })
    database.from.mockImplementation((table: string) => table === "wines"
      ? { select: wineSelect } : { select: priceSelect })

    const prices = await listLegacyHoldingPrices("home", "current-wine")

    expect(database.from).toHaveBeenCalledWith("wines")
    expect(wineHouseholdFilter).toHaveBeenCalledWith("household_id", "home")
    expect(mergedFilter).toHaveBeenNthCalledWith(1, "merged_into_wine_id", ["current-wine"])
    expect(mergedFilter).toHaveBeenNthCalledWith(2, "merged_into_wine_id", ["old-wine"])
    expect(priceHouseholdFilter).toHaveBeenCalledWith("household_id", "home")
    expect(priceIdsFilter).toHaveBeenCalledWith("wine_id", ["current-wine", "old-wine"])
    expect(prices).toHaveLength(2)
    expect(prices[0].wine_id).toBe("old-wine")
  })

  it("does not read prices when the merged-wine lookup fails", async () => {
    const mergedFilter = vi.fn().mockResolvedValue({ data: null, error: { message: "not allowed" } })
    database.from.mockReturnValue({ select: () => ({ eq: () => ({ in: mergedFilter }) }) })

    await expect(listLegacyHoldingPrices("home", "current-wine")).rejects.toThrow("not allowed")
    expect(database.from).toHaveBeenCalledTimes(1)
  })

  it("follows successive merges back to the original wine card", async () => {
    const mergedFilter = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: "middle-wine" }], error: null })
      .mockResolvedValueOnce({ data: [{ id: "old-wine" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    const priceIdsFilter = vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) })
    database.from.mockImplementation((table: string) => table === "wines"
      ? { select: () => ({ eq: () => ({ in: mergedFilter }) }) }
      : { select: () => ({ eq: () => ({ in: priceIdsFilter }) }) })

    await listLegacyHoldingPrices("home", "current-wine")

    expect(mergedFilter).toHaveBeenNthCalledWith(1, "merged_into_wine_id", ["current-wine"])
    expect(mergedFilter).toHaveBeenNthCalledWith(2, "merged_into_wine_id", ["middle-wine"])
    expect(mergedFilter).toHaveBeenNthCalledWith(3, "merged_into_wine_id", ["old-wine"])
    expect(priceIdsFilter).toHaveBeenCalledWith("wine_id", ["current-wine", "middle-wine", "old-wine"])
  })
})
