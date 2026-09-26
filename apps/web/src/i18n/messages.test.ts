import { describe, expect, it } from "vitest"

import { translate } from "./messages"

describe("French dynamic interface messages", () => {
  it("keeps counts and spacing readable in summaries", () => {
    expect(translate("fr", "inventory.resultsSummary", {
      shownBottles: "4",
      totalBottles: "4",
      shownWines: "2",
      totalWines: "2",
      shownPositions: "3",
      totalPositions: "3",
      pendingOperations: "0 opération en attente",
    })).toBe("Affichage de 4 sur 4 bouteilles · 2 sur 2 vins · 3 sur 3 emplacements · 0 opération en attente")
  })

  it("translates generated maturity, confidence, and sync copy", () => {
    expect(translate("fr", "Likely ready")).toBe("Probablement prêt")
    expect(translate("fr", "Low canonical confidence")).toBe("Confiance faible dans les recommandations de référence")
    expect(translate("fr", "This wine is inside its likely best period; reassess before the suggested drink-by year of 2035."))
      .toBe("Ce vin se trouve dans sa période optimale probable ; réévaluez-le avant l’année limite de dégustation suggérée, 2035.")
    expect(translate("fr", "The central estimate has passed; prioritize an assessment and aim to drink by about 2031."))
      .toBe("La date centrale estimée est dépassée ; donnez la priorité à une évaluation et prévoyez de boire le vin vers 2031.")
    expect(translate("fr", "Your timing: Likely ready"))
      .toBe("Votre calendrier : probablement prêt")
    expect(translate("fr", "Your private 2 years younger preference now applies to every assessed wine."))
      .toBe("Votre préférence privée (2 ans plus tôt) s’applique maintenant à tous les vins évalués.")
    expect(translate("fr", "Refreshing local data…")).toBe("Actualisation des données locales…")
  })
})
