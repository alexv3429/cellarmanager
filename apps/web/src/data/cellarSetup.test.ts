import { describe, expect, it } from "vitest"

import { cleanSetupLabel } from "./cellarSetupLabels"

describe("cellar setup labels", () => {
  it("normalizes surrounding and repeated whitespace", () => {
    expect(cleanSetupLabel("  Main   Room  ")).toBe(
      "Main Room",
    )
  })
})
