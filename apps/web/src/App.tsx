import { useStatus } from "@powersync/react"
import { useEffect, useState } from "react"

import "./App.css"
import { signOutAndClearLocalData } from "./auth/signOut"
import { useSession } from "./auth/useSession"
import { AppShell } from "./components/AppShell"
import { ActivityView } from "./components/ActivityView"
import { CatalogView } from "./components/CatalogView"
import { CellarSetupView } from "./components/CellarSetupView"
import { HoldingsView } from "./components/HoldingsView"
import { ImportView } from "./components/ImportView"
import { LoginForm } from "./components/LoginForm"
import { OnboardingView } from "./components/OnboardingView"
import { PairingView } from "./components/PairingView"
import { Notice } from "./components/Notice"
import { ResetPasswordForm } from "./components/ResetPasswordForm"
import { WineDetailView } from "./components/WineDetailView"
import {
  setPowerSyncAccess,
} from "./data/powersync/connection"
import { useRegisteredDevices } from "./devices/useRegisteredDevices"
import {
  resolveHouseholdGate,
} from "./households/householdGate"
import { useActiveHousehold } from "./households/useActiveHousehold"
import {
  getAppRouteFromPathname,
  getAppRouteTitle,
  getAppViewPath,
  getWineDetailPath,
  getWineDetailReturnView,
  type AppRoute,
  type AppView,
  type WineDetailHistoryState,
} from "./navigation/appNavigation"

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
  const [route, setRoute] =
    useState<AppRoute>(() =>
      getAppRouteFromPathname(window.location.pathname),
    )

  const [wineDetailReturnView, setWineDetailReturnView] =
    useState<AppView>(() =>
      getWineDetailReturnView(window.history.state) ??
      "catalog",
    )
  const [hasMountedPairing, setHasMountedPairing] =
    useState(
      () =>
        route.view === "pairing" ||
        getWineDetailReturnView(window.history.state) ===
          "pairing",
    )

  useEffect(() => {
    function handlePopState() {
      setRoute(
        getAppRouteFromPathname(window.location.pathname),
      )
      setWineDetailReturnView(
        getWineDetailReturnView(window.history.state) ??
          "catalog",
      )
    }

    window.addEventListener("popstate", handlePopState)

    return () => {
      window.removeEventListener(
        "popstate",
        handlePopState,
      )
    }
  }, [])

  useEffect(() => {
    if (route.view === "pairing") {
      setHasMountedPairing(true)
    }
  }, [route.view])

  function changeView(nextView: AppView) {
    const nextPath = getAppViewPath(nextView)

    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath)
    }

    setRoute({ view: nextView, wineId: null })
  }

  function openWineDetail(
    wineId: string,
    returnView: AppView,
  ) {
    const historyState: WineDetailHistoryState = {
      wineDetailReturnView: returnView,
    }

    window.history.pushState(
      historyState,
      "",
      getWineDetailPath(wineId),
    )

    setWineDetailReturnView(returnView)
    setRoute({ view: "wine", wineId })
  }

  function leaveWineDetail() {
    if (getWineDetailReturnView(window.history.state)) {
      window.history.back()
      return
    }

    changeView("catalog")
  }

  function replaceWineDetail(wineId: string) {
    const historyState: WineDetailHistoryState = {
      wineDetailReturnView,
    }

    window.history.replaceState(
      historyState,
      "",
      getWineDetailPath(wineId),
    )
    setRoute({ view: "wine", wineId })
  }

  const deviceRegistration = useRegisteredDevices(
    userId,
    initialSyncComplete,
  )

  return (
    <AppShell
      activeHouseholdId={activeHouseholdId}
      contentKey={
        route.view === "wine"
          ? `wine:${route.wineId}`
          : route.view
      }
      deviceRegistration={deviceRegistration}
      householdError={householdError}
      households={households}
      isOfflineAccess={isOfflineAccess}
      isOnline={isOnline}
      onSelectHousehold={selectHousehold}
      onSignOut={signOutAndClearLocalData}
      onViewChange={changeView}
      pageTitle={getAppRouteTitle(route)}
      syncError={currentSyncError}
      view={
        route.view === "wine"
          ? wineDetailReturnView
          : route.view
      }
    >
      {route.view === "inventory" ? (
        <HoldingsView
          deviceRegistration={deviceRegistration}
          householdId={activeHouseholdId}
          onOpenWine={(wineId) =>
            openWineDetail(wineId, "inventory")
          }
          userId={userId}
        />
      ) : null}

      {route.view === "activity" ? (
        <ActivityView
          householdId={activeHouseholdId}
          onOpenWine={(wineId) =>
            openWineDetail(wineId, "activity")
          }
        />
      ) : null}

      {hasMountedPairing ? (
        <div hidden={route.view !== "pairing"}>
          <PairingView
            householdId={activeHouseholdId}
            isOnline={isOnline}
            onOpenWine={(wineId) =>
              openWineDetail(wineId, "pairing")
            }
          />
        </div>
      ) : null}

      {route.view === "catalog" ? (
        <CatalogView
          householdId={activeHouseholdId}
          isOnline={isOnline}
          onOpenWine={(wineId) =>
            openWineDetail(wineId, "catalog")
          }
        />
      ) : null}

      {route.view === "setup" ? (
        <CellarSetupView
          householdId={activeHouseholdId}
          isOnline={isOnline}
        />
      ) : null}

      {route.view === "import" ? (
        <ImportView
          deviceId={
            deviceRegistration.deviceIdByHousehold[
              activeHouseholdId
            ] ?? null
          }
          householdId={activeHouseholdId}
          isOnline={isOnline}
          key={activeHouseholdId}
        />
      ) : null}

      {route.view === "wine" ? (
        <WineDetailView
          deviceRegistration={deviceRegistration}
          householdId={activeHouseholdId}
          isOnline={isOnline}
          onBack={leaveWineDetail}
          onOpenMergedWine={replaceWineDetail}
          returnView={wineDetailReturnView}
          userId={userId}
          wineId={route.wineId}
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
    return (
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="status">
          Loading household data…
        </Notice>
      </main>
    )
  }

  if (householdGate === "error") {
    return (
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="alert" tone="error">
          {currentSyncError ??
            householdError ??
            "Unable to load household data"}
        </Notice>
      </main>
    )
  }

  if (householdGate === "offline-unavailable") {
    return (
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="alert" tone="warning">
          Household data is not available offline on this
          device. Reconnect to finish loading your account.
        </Notice>
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
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="alert" tone="error">
          Unable to resolve the active household.
        </Notice>
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
    isPasswordRecovery,
    finishPasswordRecovery,
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

    if (isPasswordRecovery) {
      setPreparedUserId(null)

      void setPowerSyncAccess({
        userId: null,
        connectToBackend: false,
      }).catch((error: unknown) => {
        if (active) {
          setSyncError(
            error instanceof Error
              ? error.message
              : "Unable to pause local cellar data",
          )
        }
      })

      return () => {
        active = false
      }
    }

    void setPowerSyncAccess({
      userId,
      connectToBackend:
        session !== null && isOnline,
      onLocalReady: () => {
        if (active) {
          setPreparedUserId(userId)
        }
      },
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
  }, [isOnline, isPasswordRecovery, session, userId])

  if (isLoading) {
    return (
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="status">Loading session…</Notice>
      </main>
    )
  }

  if (sessionError && !userId) {
    return (
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="alert" tone="error">
          {sessionError}
        </Notice>
      </main>
    )
  }

  if (isPasswordRecovery) {
    if (session) {
      return (
        <ResetPasswordForm
          onComplete={finishPasswordRecovery}
        />
      )
    }

    return (
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="status" tone="warning">
          Reconnect to the internet to use this password reset
          link.
        </Notice>
      </main>
    )
  }

  if (!userId) {
    return <LoginForm />
  }

  if (preparedUserId !== userId) {
    if (syncError) {
      return (
        <main className="standalone-page">
          <h1>CellarManager</h1>
          <Notice role="alert" tone="error">
            {syncError}
          </Notice>
        </main>
      )
    }

    return (
      <main className="standalone-page">
        <h1>CellarManager</h1>
        <Notice role="status">
          Preparing local cellar data…
        </Notice>
      </main>
    )
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
