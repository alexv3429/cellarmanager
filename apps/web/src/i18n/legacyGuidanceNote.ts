type Translator = (key: string) => string

const ARCHIVED_V01_HEADER =
  "Archived v0.1 guidance (restored; it does not replace current recommendations)."
const ARCHIVED_ENRICHMENT_HEADER =
  "Archived v0.1 enrichment (historical reference only; not used for current wine facts, recommendations, or stock)."

function translateSegments(value: string, labels: readonly string[], t: Translator): string {
  return value.split("; ").map((part) => {
    const label = labels.find((item) => part.startsWith(`${item} `))
    return label ? `${t(label)} ${part.slice(label.length + 1)}` : part
  }).join(" ; ")
}

function formatArchivedEnrichment(lines: string[], t: Translator): string {
  const prefixed = [
    "Verified source archive:",
    "Archived external identifiers (retailer/reference codes, not bottle barcodes):",
    "Archived drinking window:",
    "Archived maturity assessment:",
    "Archived pairing examples:",
  ]
  return lines.map((line, index) => {
    if (index === 0) return t(ARCHIVED_ENRICHMENT_HEADER)
    if (line.startsWith("- ")) return line.replace("(source: ", `(${t("source:")} `)
    if (line.startsWith("Archived composition: ")) {
      return `${t("Archived composition:")} ${translateSegments(line.slice("Archived composition: ".length), ["grapes", "sweetness", "oak", "alcohol", "certifications"], t)}`
    }
    if (line.startsWith("Archived serving notes: ")) {
      return `${t("Archived serving notes:")} ${translateSegments(line.slice("Archived serving notes: ".length), ["decant", "stand upright", "glass", "method"], t)}`
    }
    const reviews = line.match(/^(\d+) archived critical-review references remain in the private source archive; excerpts are not restored\.$/)
    if (reviews) return t("{count} archived review references remain in the private source archive; excerpts are not restored.").replace("{count}", reviews[1])
    const prefix = prefixed.find((item) => line.startsWith(`${item} `))
    return prefix ? `${t(prefix)} ${line.slice(prefix.length + 1)}` : t(line)
  }).join("\n")
}

/** Localizes migration-generated labels while preserving the user's own note text. */
export function formatLegacyGuidanceNote(note: string, t: Translator): string {
  const lines = note.split("\n")
  if (lines[0] === ARCHIVED_ENRICHMENT_HEADER) return formatArchivedEnrichment(lines, t)
  if (lines[0] !== ARCHIVED_V01_HEADER) return note

  return lines.map((line, index) => {
    if (index === 0) return t(ARCHIVED_V01_HEADER)

    const window = line.match(/^Original drinking window: (.+) to (.+)\.$/)
    if (window) {
      const start = window[1] === "not set" ? t("not set") : window[1]
      const end = window[2] === "not set" ? t("not set") : window[2]
      return `${t("Original drinking window:")} ${start} ${t("to")} ${end}.`
    }

    const provenance = line.match(/^Original window provenance: (.+)\.$/)
    if (provenance) {
      const translated = provenance[1].split("; ").map((part) => {
        const entry = part.match(/^(start|end) (.+)$/)
        if (!entry) return part
        const source = entry[2].replace(/ \(\d+%\)$/, "")
        const percentage = entry[2].match(/ \(\d+%\)$/)?.[0]?.replace(/(\d+)%/, "$1 %") ?? ""
        return `${t(entry[1])} ${t(source)}${percentage}`
      })
      return `${t("Original window provenance:")} ${translated.join(" ; ")}.`
    }

    const advice = line.match(/^(Experience \/ advice|Pairing advice|Original note): (.*)$/)
    if (advice) return `${t(`${advice[1]}:`)} ${advice[2]}`

    return line
  }).join("\n")
}
