import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { createInitialImportDestination } from "./cellarSetup"

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock("./supabase", () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
  },
}))

describe("initial CSV import destination", () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset()
  })

  it("creates a cellar and its initial location in order", async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: "cellar-1",
        error: null,
      })
      .mockResolvedValueOnce({
        data: "location-1",
        error: null,
      })

    await expect(
      createInitialImportDestination(
        "household-1",
        " Stock   A ",
        " Unsorted ",
        " 250 ",
      ),
    ).resolves.toEqual({
      cellarId: "cellar-1",
      locationId: "location-1",
    })

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(
      1,
      "create_cellar",
      {
        p_household_id: "household-1",
        p_name: "Stock A",
      },
    )
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(
      2,
      "create_location",
      {
        p_capacity: 250,
        p_cellar_id: "cellar-1",
        p_code: "Unsorted",
        p_household_id: "household-1",
        p_storage_purpose: "overflow",
      },
    )
  })

  it("validates both labels before creating anything", async () => {
    await expect(
      createInitialImportDestination(
        "household-1",
        "Stock A",
        " ",
        "",
      ),
    ).rejects.toThrow("Location code is required")

    expect(supabaseMocks.rpc).not.toHaveBeenCalled()
  })

  it("reports when the cellar exists but location creation fails", async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: "cellar-1",
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Network response was lost" },
      })

    await expect(
      createInitialImportDestination(
        "household-1",
        "Stock A",
        "Unsorted",
        "",
      ),
    ).rejects.toThrow(
      "Cellar “Stock A” was created, but its initial location was not confirmed",
    )
  })
})
