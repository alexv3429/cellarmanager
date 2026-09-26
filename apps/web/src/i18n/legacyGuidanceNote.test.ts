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
})
