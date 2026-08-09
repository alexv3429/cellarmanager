import {
  cleanWineText,
  parseWineVintage,
} from "./wineCatalog"

export interface WineIdentityEdit {
  producer: string
  cuvee: string
  vintage: number | null
  color: string
}

export function prepareWineIdentityEdit(
  producer: string,
  cuvee: string,
  vintage: string,
  color: string,
): WineIdentityEdit {
  const cleanedProducer = cleanWineText(producer)
  const cleanedCuvee = cleanWineText(cuvee)
  const cleanedColor = cleanWineText(color).toLowerCase()

  if (cleanedProducer.length === 0) {
    throw new Error("Wine producer is required")
  }

  if (cleanedCuvee.length === 0) {
    throw new Error("Wine cuvée is required")
  }

  if (cleanedColor.length === 0) {
    throw new Error("Wine color is required")
  }

  return {
    producer: cleanedProducer,
    cuvee: cleanedCuvee,
    vintage: parseWineVintage(vintage),
    color: cleanedColor,
  }
}
