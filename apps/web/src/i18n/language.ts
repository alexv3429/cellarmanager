export const LANGUAGE_PREFERENCES = ["system", "en", "fr"] as const
export type LanguagePreference = typeof LANGUAGE_PREFERENCES[number]
export type AppLanguage = Exclude<LanguagePreference, "system">

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "en" || value === "fr" || value === "system"
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return isLanguagePreference(value) ? value : "system"
}

export function detectDeviceLanguage(locales: readonly string[]): AppLanguage {
  const primaryLocale = locales[0]?.trim().toLowerCase() ?? ""
  if (primaryLocale === "fr" || primaryLocale.startsWith("fr-")) return "fr"
  if (primaryLocale === "en" || primaryLocale.startsWith("en-")) return "en"
  return "en"
}

export function resolveLanguage(preference: LanguagePreference, locales: readonly string[]): AppLanguage {
  return preference === "system" ? detectDeviceLanguage(locales) : preference
}

const LOCAL_PREFERENCE_PREFIX = "cellarmanager.languagePreference."

export function readLocalLanguagePreference(storage: Pick<Storage, "getItem">, userId: string): LanguagePreference | null {
  try {
    const value = storage.getItem(`${LOCAL_PREFERENCE_PREFIX}${userId}`)
    return value === null ? null : normalizeLanguagePreference(value)
  } catch {
    return null
  }
}

export function writeLocalLanguagePreference(storage: Pick<Storage, "setItem">, userId: string, preference: LanguagePreference): boolean {
  try {
    storage.setItem(`${LOCAL_PREFERENCE_PREFIX}${userId}`, preference)
    return true
  } catch {
    return false
  }
}
