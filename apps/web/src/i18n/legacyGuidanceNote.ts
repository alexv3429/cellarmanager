type Translator = (key: string) => string

const ARCHIVED_V01_HEADER =
  "Archived v0.1 guidance (restored; it does not replace current recommendations)."

/** Localizes migration-generated labels while preserving the user's own note text. */
export function formatLegacyGuidanceNote(note: string, t: Translator): string {
  const lines = note.split("\n")
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
