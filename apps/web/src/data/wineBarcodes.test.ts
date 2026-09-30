import { describe, expect, it } from "vitest"

import { normalizeGtin } from "./gtin"

describe("GTIN normalization", () => {
  it("accepts valid EAN-8, UPC-A, EAN-13, and GTIN-14 with one canonical key", () => {
    expect(normalizeGtin("9638 5074")).toBe("00000096385074")
    expect(normalizeGtin("036000291452")).toBe("00036000291452")
    expect(normalizeGtin("0 36000 29145 2")).toBe("00036000291452")
    expect(normalizeGtin("10012345000017")).toBe("10012345000017")
  })

  it("rejects malformed or mistyped barcodes", () => {
    expect(normalizeGtin("96385075")).toBeNull()
    expect(normalizeGtin("036000291453")).toBeNull()
    expect(normalizeGtin("abc" )).toBeNull()
    expect(normalizeGtin("12345678901")).toBeNull()
  })
})
