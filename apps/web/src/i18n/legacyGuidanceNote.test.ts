import { describe, expect, it } from "vitest"

import { formatLegacyGuidanceNote } from "./legacyGuidanceNote"
import { translate } from "./messages"

describe("legacy guidance note localization", () => {
  const t = (key: string) => translate("fr", key)

  it("translates generated labels and preserves the owner's advice", () => {
    const note = [
      "Archived v0.1 guidance (restored; it does not replace current recommendations).",
      "Original drinking window: 01/01/2021 to 31/12/2024.",
      "Original window provenance: start manual (100%); end manual (100%).",
      "Experience / advice: Grand Millésime, profond et fruité.",
    ].join("\n")

    expect(formatLegacyGuidanceNote(note, t)).toBe([
      "Anciennes recommandations v0.1 restaurées ; elles ne remplacent pas les conseils actuels.",
      "Période de dégustation d’origine : 01/01/2021 au 31/12/2024.",
      "Origine de la période : début manuel (100 %) ; fin manuel (100 %).",
      "Expérience / conseil : Grand Millésime, profond et fruité.",
    ].join("\n"))
  })

  it("does not translate free-form user notes", () => {
    const note = "A tasting note written by the cellar owner."
    expect(formatLegacyGuidanceNote(note, t)).toBe(note)
  })

  it("localizes archived enrichment labels without changing source values", () => {
    const note = [
      "Archived v0.1 enrichment (historical reference only; not used for current wine facts, recommendations, or stock).",
      "Verified source archive: aaaa.",
      "Archived external identifiers (retailer/reference codes, not bottle barcodes):",
      "- Shop SKU: SKU-42 (source: https://example.org/wine/42)",
      "Archived composition: grapes Pinot Noir 100%; alcohol 13%.",
      "Archived drinking window: 2026–2032.",
      "2 archived critical-review references remain in the private source archive; excerpts are not restored.",
    ].join("\n")
    const translated = formatLegacyGuidanceNote(note, t)
    expect(translated).toContain("Anciennes recherches v0.1 conservées")
    expect(translated).toContain("Anciens identifiants externes")
    expect(translated).toContain("Shop SKU: SKU-42 (source : https://example.org/wine/42)")
    expect(translated).toContain("Ancienne composition : cépages Pinot Noir 100% ; alcool 13%.")
    expect(translated).toContain("Ancienne période de dégustation : 2026–2032.")
    expect(translated).toContain("2 références de critiques")
  })
})
