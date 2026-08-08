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
import { useActiveHousehold } from "./households/useActiveHousehold"

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

  const {
    activeHouseholdId,
    households,
    error: householdError,
    isLoading: householdsLoading,
    selectHousehold,
  } = useActiveHousehold(userId ?? "")

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
    return <p>Loading session…</p>
  }

  if (sessionError && !userId) {
    return <p role="alert">{sessionError}</p>
  }

  if (!userId) {
    return <LoginForm />
  }

  if (householdsLoading) {
    return <p>Loading households…</p>
  }

  if (!activeHouseholdId) {
    return (
      <main>
        <h1>CellarManager</h1>
        <p role="alert">
          {householdError ??
            "No household membership is available for this user"}
        </p>
      </main>
    )
  }

  return (
    <>
      <label>
        Household
        <select
          onChange={(event) =>
            selectHousehold(event.target.value)
          }
          value={activeHouseholdId}
        >
          {households.map((household) => (
            <option
              key={household.id}
              value={household.id}
            >
              {household.name}
            </option>
          ))}
        </select>
      </label>

      {householdError ? (
        <p role="alert">{householdError}</p>
      ) : null}

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

      {view === "inventory" ? (
        <HoldingsView
          householdId={activeHouseholdId}
          isOfflineAccess={isOfflineAccess}
          isOnline={isOnline}
          onSignOut={signOutAndClearLocalData}
          syncError={syncError ?? sessionError}
          userId={userId}
        />
      ) : null}

      {view === "catalog" ? (
        <CatalogView
          householdId={activeHouseholdId}
        />
      ) : null}

      {view === "setup" ? (
        <CellarSetupView
          householdId={activeHouseholdId}
          isOnline={isOnline}
        />
      ) : null}
    </>
  )
}
