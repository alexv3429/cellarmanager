import { describe, expect, it } from "vitest"

import { encodeLocationQr, parseLocationQr } from "./locationQr"

const householdId = "e4098b45-289a-41d7-9650-51311376976c"
const locationId = "e706fd88-afca-4f05-94fa-5671c61cb61b"

describe("location QR identifiers", () => {
  it("round-trips stable household and location IDs", () => {
    expect(parseLocationQr(encodeLocationQr({ householdId, locationId }))).toEqual({ householdId, locationId })
  })

  it("rejects malformed, unrelated, and extra data", () => {
    expect(parseLocationQr("https://example.com/inventory")).toBeNull()
    expect(parseLocationQr(`CMLOC2:${householdId}:${locationId}`)).toBeNull()
    expect(parseLocationQr(`CMLOC1:${householdId}:${locationId}:extra`)).toBeNull()
    expect(parseLocationQr(`CMLOC1:${householdId}:not-a-uuid`)).toBeNull()
    expect(() => encodeLocationQr({ householdId, locationId: "invalid" })).toThrow()
  })
})
