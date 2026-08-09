import {
  cleanWineText,
  parseWineFormatMl,
  parseWineVintage,
} from "./wineCatalog"

export interface WineCatalogEdit {
  producer: string
  cuvee: string
  vintage: number | null
  color: string
  appellation: string | null
  area: string | null
  formatMl: number
}

function cleanOptionalWineText(
  value: string,
): string | null {
  const cleaned = cleanWineText(value)
  return cleaned.length > 0 ? cleaned : null
}

export function prepareWineCatalogEdit(
  producer: string,
  cuvee: string,
  vintage: string,
  color: string,
  appellation: string,
  area: string,
  formatMl: string,
): WineCatalogEdit {
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
    appellation: cleanOptionalWineText(appellation),
    area: cleanOptionalWineText(area),
    formatMl: parseWineFormatMl(formatMl),
  }
}
