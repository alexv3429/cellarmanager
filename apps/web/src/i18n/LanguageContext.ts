import { createContext } from "react"
import type { AppLanguage, LanguagePreference } from "./language"
import type { MessageKey } from "./messages"

export interface LanguageContextValue {
  language: AppLanguage
  preference: LanguagePreference
  setSavedPreference: (preference: LanguagePreference) => void
  t: (key: MessageKey, values?: Record<string, string>) => string
}

export const LanguageContext = createContext<LanguageContextValue | null>(null)
