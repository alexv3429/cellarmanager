import type { Session } from "@supabase/supabase-js"
import { useEffect, useState } from "react"

import { supabase } from "../data/supabase"

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) {
        return
      }

      if (sessionError) {
        setError(sessionError.message)
      }

      setSession(data.session)
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
      setError(null)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return { session, isLoading, error }
}
