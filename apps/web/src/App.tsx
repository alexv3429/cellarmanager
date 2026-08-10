import { useStatus } from "@powersync/react"
import { useEffect, useState } from "react"

import "./App.css"
import { signOutAndClearLocalData } from "./auth/signOut"
import { useSession } from "./auth/useSession"
import {
  AppShell,
  type AppView,
} from "./components/AppShell"
import { CatalogView } from "./components/CatalogView"
import { CellarSetupView } from "./components/CellarSetupView"
import { HoldingsView } from "./components/HoldingsView"
import { LoginForm } from "./components/LoginForm"
import { OnboardingView } from "./components/OnboardingView"
import {
  setPowerSyncAccess,
} from "./data/powersync/connection"
import { useRegisteredDevices } from "./devices/useRegisteredDevices"
import {
  resolveHouseholdGate,
} from "./households/householdGate"
import { useActiveHousehold } from "./households/useActiveHousehold"

type HouseholdOption = {
  id: string
  name: string
}

interface AuthenticatedAppProps {
  currentSyncError: string | null
  hasAuthenticatedSession: boolean
  isOfflineAccess: boolean
  isOnline: boolean
  userId: string
}

interface ReadyAuthenticatedAppProps {
  activeHouseholdId: string
  currentSyncError: string | null
  householdError: string | null
  households: HouseholdOption[]
  initialSyncComplete: boolean
  isOfflineAccess: boolean
  isOnline: boolean
  selectHousehold: (householdId: string) => void
  userId: string
}

function ReadyAuthenticatedApp({
  activeHouseholdId,
  currentSyncError,
  householdError,
  households,
  initialSyncComplete,
  isOfflineAccess,
  isOnline,
  selectHousehold,
  userId,
}: ReadyAuthenticatedAppProps) {
  const [view, setView] =
    useState<AppView>("inventory")

  const deviceRegistration = useRegisteredDevices(
    userId,
    initialSyncComplete,
  )

  return (
    <AppShell
      activeHouseholdId={activeHouseholdId}
      deviceRegistration={deviceRegistration}
      householdError={householdError}
      households={households}
      isOfflineAccess={isOfflineAccess}
      isOnline={isOnline}
      onSelectHousehold={selectHousehold}
      onSignOut={signOutAndClearLocalData}
      onViewChange={setView}
      syncError={currentSyncError}
      view={view}
    >
      {view === "inventory" ? (
        <HoldingsView
          deviceRegistration={deviceRegistration}
          householdId={activeHouseholdId}
          userId={userId}
        />
      ) : null}

      {view === "catalog" ? (
        <CatalogView
          householdId={activeHouseholdId}
          isOnline={isOnline}
        />
      ) : null}

      {view === "setup" ? (
        <CellarSetupView
          householdId={activeHouseholdId}
          isOnline={isOnline}
        />
      ) : null}
    </AppShell>
  )
}

function AuthenticatedApp({
  currentSyncError,
  hasAuthenticatedSession,
  isOfflineAccess,
  isOnline,
  userId,
}: AuthenticatedAppProps) {
  const powerSyncStatus = useStatus()

  const {
    activeHouseholdId,
    households,
    error: householdError,
    isLoading: householdsLoading,
    selectHousehold,
  } = useActiveHousehold(userId)

  const householdGate = resolveHouseholdGate({
    activeHouseholdId,
    hasAuthenticatedSession,
    householdCount: households.length,
    householdError,
    householdsLoading,
    initialSyncComplete:
      powerSyncStatus.hasSynced === true,
    isOnline,
    syncError: currentSyncError,
  })

  if (householdGate === "loading") {
    return <p>Loading household data…</p>
  }

  if (householdGate === "error") {
    return (
      <main>
        <h1>CellarManager</h1>
        <p role="alert">
          {currentSyncError ??
            householdError ??
            "Unable to load household data"}
        </p>
      </main>
    )
  }

  if (householdGate === "offline-unavailable") {
    return (
      <main>
        <h1>CellarManager</h1>
        <p role="alert">
          Household data is not available offline on this
          device. Reconnect to finish loading your account.
        </p>
      </main>
    )
  }

  if (householdGate === "onboarding") {
    return (
      <OnboardingView
        isOnline={isOnline}
        onSignOut={signOutAndClearLocalData}
      />
    )
  }

  if (!activeHouseholdId) {
    return (
      <main>
        <h1>CellarManager</h1>
        <p role="alert">
          Unable to resolve the active household.
        </p>
      </main>
    )
  }

  return (
    <ReadyAuthenticatedApp
      activeHouseholdId={activeHouseholdId}
      currentSyncError={currentSyncError}
      householdError={householdError}
      households={households}
      initialSyncComplete={
        powerSyncStatus.hasSynced === true
      }
      isOfflineAccess={isOfflineAccess}
      isOnline={isOnline}
      selectHousehold={selectHousehold}
      userId={userId}
    />
  )
}

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

  // The ID whose local PowerSync database has actually finished
  // being prepared. This deliberately trails userId during an
  // account switch, preventing the next account from rendering
  // against the previous account's local database.
  const [preparedUserId, setPreparedUserId] =
    useState<string | null>(null)

  useEffect(() => {
    let active = true

    setSyncError(null)

    void setPowerSyncAccess({
      userId,
      connectToBackend:
        session !== null && isOnline,
    })
      .then(() => {
        if (active) {
          setPreparedUserId(userId)
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }

        setSyncError(
          error instanceof Error
            ? error.message
            : "Unable to prepare local cellar data",
        )
      })

    return () => {
      active = false
    }
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

  if (preparedUserId !== userId) {
    if (syncError) {
      return (
        <main>
          <h1>CellarManager</h1>
          <p role="alert">{syncError}</p>
        </main>
      )
    }

    return <p>Preparing local cellar data…</p>
  }

  return (
    <AuthenticatedApp
      currentSyncError={syncError ?? sessionError}
      hasAuthenticatedSession={session !== null}
      isOfflineAccess={isOfflineAccess}
      isOnline={isOnline}
      key={userId}
      userId={userId}
    />
  )
}
