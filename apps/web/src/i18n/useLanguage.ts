import { useContext } from "react"
import { LanguageContext } from "./LanguageContext"
import { translate } from "./messages"
import type { LanguageContextValue } from "./LanguageContext"

const fallback: LanguageContextValue = {
  language: "en",
  preference: "system",
  setSavedPreference: () => undefined,
  t: (key, values) => translate("en", key, values),
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext) ?? fallback
}
