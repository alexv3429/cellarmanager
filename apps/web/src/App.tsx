import { useEffect, useState } from "react"

import "./App.css"
import { signOutAndClearLocalData } from "./auth/signOut"
import { useSession } from "./auth/useSession"
import { HoldingsView } from "./components/HoldingsView"
import { LoginForm } from "./components/LoginForm"
import {
  setPowerSyncAccess,
} from "./data/powersync/connection"

export default function App() {
  const {
    session,
    userId,
    isLoading,
    isOnline,
    isOfflineAccess,
    error: sessionError,
  } = useSession()

  const [syncError, setSyncError] =
    useState<string | null>(null)

  useEffect(() => {
    setSyncError(null)

    void setPowerSyncAccess({
      userId,
      connectToBackend:
        session !== null && isOnline,
    }).catch((error: unknown) => {
      setSyncError(
        error instanceof Error
          ? error.message
          : "Unable to connect PowerSync",
      )
    })
  }, [isOnline, session, userId])

  if (isLoading) {
    return <main>Loading session…</main>
  }

  if (sessionError && !userId) {
    return <main role="alert">{sessionError}</main>
  }

  if (!userId) {
    return <LoginForm />
  }

  return (
    <HoldingsView
      isOfflineAccess={isOfflineAccess}
      isOnline={isOnline}
      onSignOut={signOutAndClearLocalData}
      syncError={syncError ?? sessionError}
      userId={userId}
    />
  )
}
