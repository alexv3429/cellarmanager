import { createContext } from "react"
import type { AppLanguage, LanguagePreference } from "./language"

export interface LanguageContextValue {
  language: AppLanguage
  preference: LanguagePreference
  setSavedPreference: (preference: LanguagePreference) => void
  t: (key: string, values?: Record<string, string>) => string
}

export const LanguageContext = createContext<LanguageContextValue | null>(null)
