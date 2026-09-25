import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { isLanguagePreference, readLocalLanguagePreference, resolveLanguage, writeLocalLanguagePreference, type LanguagePreference } from "./language"
import { translate, type MessageKey } from "./messages"
import { LanguageContext, type LanguageContextValue } from "./LanguageContext"

export function LanguageProvider({ children, userId, session, isOnline }: {
  children: ReactNode
  userId: string | null
  session: Session | null
  isOnline: boolean
}) {
  function readOfflinePreference(): LanguagePreference | null {
    if (!userId || isOnline) return null
    try { return readLocalLanguagePreference(window.localStorage, userId) }
    catch { return null }
  }

  const deviceLocales = useMemo(() => {
    if (typeof navigator === "undefined") return ["en"]
    return navigator.languages?.length ? [...navigator.languages] : [navigator.language]
  }, [])
  const remotePreferenceValue = session?.user.id === userId
    ? session.user.user_metadata?.preferred_language
    : undefined
  const remotePreference = isLanguagePreference(remotePreferenceValue)
    ? remotePreferenceValue
    : null
  const sessionIdentityMismatch = Boolean(session && session.user.id !== userId)
  const localPreference = readOfflinePreference()
  const remotePreferenceRef = useRef(remotePreference)
  remotePreferenceRef.current = remotePreference
  const [saved, setSaved] = useState<{ userId: string; preference: LanguagePreference; remoteAtSave: LanguagePreference | null } | null>(null)
  const savedIsCurrent = !sessionIdentityMismatch && saved?.userId === userId &&
    (remotePreference === null || remotePreference === saved.remoteAtSave || remotePreference === saved.preference)
  const preference = sessionIdentityMismatch
    ? "system"
    : savedIsCurrent
    ? saved.preference
    : remotePreference ?? localPreference ?? "system"
  const language = resolveLanguage(preference, deviceLocales)

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    if (!userId || remotePreference === null) return
    try { writeLocalLanguagePreference(window.localStorage, userId, remotePreference) }
    catch { /* The Auth preference remains available online if browser storage is blocked. */ }
  }, [remotePreference, userId])

  const setSavedPreference = useCallback((next: LanguagePreference) => {
    if (!userId) return
    setSaved({ userId, preference: next, remoteAtSave: remotePreferenceRef.current })
    try { writeLocalLanguagePreference(window.localStorage, userId, next) }
    catch { /* Auth metadata remains the cross-device source of truth. */ }
  }, [userId])

  const t = useCallback((key: MessageKey, values?: Record<string, string>) => translate(language, key, values), [language])

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    preference,
    setSavedPreference,
    t,
  }), [language, preference, setSavedPreference, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
