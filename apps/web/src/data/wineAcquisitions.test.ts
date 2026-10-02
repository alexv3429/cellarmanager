import { describe, expect, it } from "vitest"

import { prepareWineAcquisition, type WineAcquisitionDraft } from "./wineAcquisitions"

const purchase: WineAcquisitionDraft = {
  kind: "PURCHASE", quantity: "6", acquiredOn: "2026-02-28", unitPrice: "12,50",
  currency: "eur", sourceName: "  Cave locale  ", note: "  Facture conservée  ",
}

describe("wine acquisition validation", () => {
  it("normalizes a paid purchase without inventing a stock movement", () => {
    expect(prepareWineAcquisition(purchase)).toEqual({
      kind: "PURCHASE", quantity: 6, acquiredOn: "2026-02-28", unitPrice: "12.50",
      currency: "EUR", sourceName: "Cave locale", note: "Facture conservée",
    })
  })

  it("allows an unpriced gift with an unknown date", () => {
    expect(prepareWineAcquisition({ ...purchase, kind: "GIFT", quantity: "1", acquiredOn: "", unitPrice: "" }))
      .toMatchObject({ kind: "GIFT", quantity: 1, acquiredOn: null, unitPrice: null, currency: null })
  })

  it("rejects invalid dates, quantities, prices and paid gifts", () => {
    expect(() => prepareWineAcquisition({ ...purchase, acquiredOn: "2026-02-29" }))
      .toThrow("acquisition.validationDate")
    expect(() => prepareWineAcquisition({ ...purchase, quantity: "0" }))
      .toThrow("acquisition.validationQuantity")
    expect(() => prepareWineAcquisition({ ...purchase, unitPrice: "12.345" }))
      .toThrow("acquisition.validationPrice")
    expect(() => prepareWineAcquisition({ ...purchase, kind: "GIFT" }))
      .toThrow("acquisition.validationPriceKind")
    expect(() => prepareWineAcquisition({ ...purchase, currency: "EU" }))
      .toThrow("acquisition.validationCurrency")
  })

  it("rejects excessive free-text fields", () => {
    expect(() => prepareWineAcquisition({ ...purchase, sourceName: "s".repeat(201) }))
      .toThrow("acquisition.validationSource")
    expect(() => prepareWineAcquisition({ ...purchase, note: "n".repeat(501) }))
      .toThrow("acquisition.validationNote")
  })
})
