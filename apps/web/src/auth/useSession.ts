import type { Session } from "@supabase/supabase-js"
import { useEffect, useState } from "react"

import { supabase } from "../data/supabase"
import {
  resolveOfflineUserId,
  saveLocalAccess,
} from "./localAccess"

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to restore the authentication session"
}

function canUseOfflineFallback(error: unknown): boolean {
  if (!navigator.onLine) {
    return true
  }

  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status

    if (
      typeof status === "number" &&
      (status === 0 || status >= 500)
    ) {
      return true
    }
  }

  return /fetch|network|offline|timeout/i.test(
    getErrorMessage(error),
  )
}

export function useSession() {
  const [session, setSession] =
    useState<Session | null>(null)

  const [userId, setUserId] =
    useState<string | null>(null)

  const [isLoading, setIsLoading] = useState(true)

  const [isOnline, setIsOnline] = useState(
    () => navigator.onLine,
  )

  const [error, setError] =
    useState<string | null>(null)

  useEffect(() => {
    let active = true

    function applySignedOut(): void {
      if (!active) {
        return
      }

      setSession(null)
      setUserId(null)
      setError(null)
      setIsLoading(false)
    }

    function applyOfflineAccess(): boolean {
      if (!active) {
        return false
      }

      try {
        const offlineUserId = resolveOfflineUserId(
          window.localStorage,
        )

        if (!offlineUserId) {
          applySignedOut()
          return false
        }

        setSession(null)
        setUserId(offlineUserId)
        setError(null)
        setIsLoading(false)

        return true
      } catch (caughtError: unknown) {
        setSession(null)
        setUserId(null)
        setError(getErrorMessage(caughtError))
        setIsLoading(false)

        return false
      }
    }

    function applyAuthenticatedSession(
      nextSession: Session,
    ): void {
      if (!active) {
        return
      }

      let persistenceError: string | null = null

      try {
        saveLocalAccess(
          window.localStorage,
          nextSession.user.id,
        )
      } catch (caughtError: unknown) {
        persistenceError = getErrorMessage(caughtError)
      }

      setSession(nextSession)
      setUserId(nextSession.user.id)
      setError(persistenceError)
      setIsLoading(false)
    }

    async function restoreSession(): Promise<void> {
      if (!active) {
        return
      }

      setIsLoading(true)

      try {
        const {
          data,
          error: sessionError,
        } = await supabase.auth.getSession()

        if (!active) {
          return
        }

        if (sessionError) {
          if (
            canUseOfflineFallback(sessionError) &&
            applyOfflineAccess()
          ) {
            return
          }

          setSession(null)
          setUserId(null)
          setError(sessionError.message)
          setIsLoading(false)
          return
        }

        if (data.session) {
          applyAuthenticatedSession(data.session)
        } else {
          applySignedOut()
        }
      } catch (caughtError: unknown) {
        if (
          canUseOfflineFallback(caughtError) &&
          applyOfflineAccess()
        ) {
          return
        }

        setSession(null)
        setUserId(null)
        setError(getErrorMessage(caughtError))
        setIsLoading(false)
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!active) {
          return
        }

        // Supabase can emit its persisted session during startup.
        // While offline, local access remains authoritative because
        // authentication cannot be refreshed or used for synchronization.
        if (!navigator.onLine) {
          applyOfflineAccess()
          return
        }

        if (nextSession) {
          applyAuthenticatedSession(nextSession)
        } else {
          applySignedOut()
        }
      },
    )

    function handleOnline(): void {
      setIsOnline(true)
      void restoreSession()
    }

    function handleOffline(): void {
      setIsOnline(false)
      applyOfflineAccess()
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    if (navigator.onLine) {
      void restoreSession()
    } else {
      applyOfflineAccess()
    }

    return () => {
      active = false
      subscription.unsubscribe()

      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  return {
    session,
    userId,
    isLoading,
    isOnline,
    isOfflineAccess:
      userId !== null && session === null,
    error,
  }
}
