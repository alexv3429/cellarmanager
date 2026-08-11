import { describe, expect, it } from "vitest"

import {
  cleanSetupLabel,
  parseOptionalLocationCapacity,
} from "./cellarSetupLabels"

describe("cellar setup labels", () => {
  it("normalizes surrounding and repeated whitespace", () => {
    expect(cleanSetupLabel("  Main   Room  ")).toBe(
      "Main Room",
    )
  })

  it("parses an optional positive whole-number capacity", () => {
    expect(parseOptionalLocationCapacity(" 24 ")).toBe(24)
    expect(parseOptionalLocationCapacity("   ")).toBeNull()
  })

  it("rejects invalid location capacities", () => {
    expect(() =>
      parseOptionalLocationCapacity("0"),
    ).toThrow("positive whole number")
    expect(() =>
      parseOptionalLocationCapacity("2.5"),
    ).toThrow("positive whole number")
  })
})
