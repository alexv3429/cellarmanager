import { useEffect, useState } from "react"

import "./App.css"
import { useSession } from "./auth/useSession"
import { HoldingsView } from "./components/HoldingsView"
import { LoginForm } from "./components/LoginForm"
import { setPowerSyncUser } from "./data/powersync/connection"

export default function App() {
  const { session, isLoading, error: sessionError } = useSession()
  const [syncError, setSyncError] = useState<string | null>(null)

  const userId = session?.user.id ?? null

  useEffect(() => {
    setSyncError(null)

    void setPowerSyncUser(userId).catch((error: unknown) => {
      setSyncError(
        error instanceof Error
          ? error.message
          : "Unable to connect PowerSync",
      )
    })
  }, [userId])

  if (isLoading) {
    return <main>Loading session…</main>
  }

  if (sessionError) {
    return <main role="alert">{sessionError}</main>
  }

  if (!session) {
    return <LoginForm />
  }

  if (syncError) {
    return (
      <main>
        <h1>PowerSync connection failed</h1>
        <p role="alert">{syncError}</p>
      </main>
    )
  }

  return <HoldingsView />
}
