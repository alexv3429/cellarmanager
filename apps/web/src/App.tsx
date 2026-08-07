import { useEffect, useState } from "react"

import "./App.css"
import { signOutAndClearLocalData } from "./auth/signOut"
import { useSession } from "./auth/useSession"
import { CatalogView } from "./components/CatalogView"
import { CellarSetupView } from "./components/CellarSetupView"
import { HoldingsView } from "./components/HoldingsView"
import { LoginForm } from "./components/LoginForm"
import {
  setPowerSyncAccess,
} from "./data/powersync/connection"

type AppView = "inventory" | "catalog" | "setup"

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

  const [view, setView] =
    useState<AppView>("inventory")

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
    <>
      <nav aria-label="Main navigation">
        <button
          aria-pressed={view === "inventory"}
          onClick={() => setView("inventory")}
          type="button"
        >
          Inventory
        </button>
        <button
          aria-pressed={view === "catalog"}
          onClick={() => setView("catalog")}
          type="button"
        >
          Catalog
        </button>
        <button
          aria-pressed={view === "setup"}
          onClick={() => setView("setup")}
          type="button"
        >
          Cellar setup
        </button>
      </nav>

      {view === "inventory" ? (
        <HoldingsView
          isOfflineAccess={isOfflineAccess}
          isOnline={isOnline}
          onSignOut={signOutAndClearLocalData}
          syncError={syncError ?? sessionError}
          userId={userId}
        />
      ) : null}

      {view === "catalog" ? <CatalogView /> : null}

      {view === "setup" ? (
        <CellarSetupView isOnline={isOnline} />
      ) : null}
    </>
  )
}
