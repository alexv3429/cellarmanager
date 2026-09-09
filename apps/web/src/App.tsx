import { useStatus } from "@powersync/react"
import { useEffect, useRef, useState } from "react"

import "./App.css"
import { signOutAndClearLocalData } from "./auth/signOut"
import { useSession } from "./auth/useSession"
import { AppShell } from "./components/AppShell"
import { ActivityView } from "./components/ActivityView"
import { CatalogView } from "./components/CatalogView"
import { MemberCellarView } from "./components/MemberCellarView"
import { CellarSetupView } from "./components/CellarSetupView"
import { HoldingsView } from "./components/HoldingsView"
import { ImportView } from "./components/ImportView"
import { HouseholdInvitationsView } from "./components/HouseholdInvitationsView"
import { HouseholdMembersView } from "./components/HouseholdMembersView"
import { InvitationEntryView } from "./components/InvitationEntryView"
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
  getHouseholdRoute,
  householdHistoryState,
  householdHomeRoute,
  isOtherHouseholdHistory,
} from "./households/householdNavigation"
import { getHouseholdPermissions } from "./households/householdPermissions"
import type {
  HouseholdOption,
} from "./households/useActiveHousehold"
import {
  captureHouseholdInvitationToken,
  clearHouseholdInvitationToken,
  getInvitationUrlWithoutSecret,
} from "./households/invitationToken"
import {
  getAppRouteForRole,
  getAppRouteTitle,
  getAppViewPath,
  getWineDetailPath,
  getWineDetailReturnView,
  type AppRoute,
  type AppView,
} from "./navigation/appNavigation"

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
  selectionWarning: string | null
  selectionNotice: string | null
  households: HouseholdOption[]
  initialSyncComplete: boolean
  isOfflineAccess: boolean
  isOnline: boolean
  selectHousehold: (householdId: string) => boolean
  userId: string
}

function ReadyAuthenticatedApp({
  activeHouseholdId,
  currentSyncError,
  householdError,
  selectionWarning,
  selectionNotice,
  households,
  initialSyncComplete,
  isOfflineAccess,
  isOnline,
  selectHousehold,
  userId,
}: ReadyAuthenticatedAppProps) {
  const workspaceActive = useRef(true)
  useEffect(() => {
    workspaceActive.current = true
    return () => { workspaceActive.current = false }
  }, [])
  const activeHouseholdRole =
    households.find(
      (household) => household.id === activeHouseholdId,
    )?.role ?? "member"
  const activeHouseholdName =
    households.find(
      (household) => household.id === activeHouseholdId,
    )?.name ?? "this household"
  const permissions = getHouseholdPermissions(activeHouseholdRole)

  const [requestedRoute, setRoute] =
    useState<AppRoute>(() =>
      getHouseholdRoute(window.location.pathname, window.history.state, activeHouseholdId, activeHouseholdRole),
    )

  const route = getAppRouteForRole(requestedRoute, activeHouseholdRole)
  const [requestedReturnView, setWineDetailReturnView] =
    useState<AppView>(() =>
      (!isOtherHouseholdHistory(window.history.state, activeHouseholdId) && getWineDetailReturnView(window.history.state)) ||
      "catalog",
    )
  const wineDetailReturnView = getAppRouteForRole(
    { view: requestedReturnView, wineId: null }, activeHouseholdRole,
  ).view as AppView

  useEffect(() => {
    const path = route.view === "wine" ? getWineDetailPath(route.wineId) : getAppViewPath(route.view)
    const foreign = isOtherHouseholdHistory(window.history.state, activeHouseholdId)
    // Only an in-app wine navigation has a known Back destination. A fresh
    // deep link falls back to the catalog instead of leaving the app.
    const hasReturnView = !foreign && getWineDetailReturnView(window.history.state) !== null
    window.history.replaceState(
      householdHistoryState(activeHouseholdId, route.view === "wine" && hasReturnView ? wineDetailReturnView : undefined),
      "",
      path + (foreign ? "" : window.location.search + window.location.hash),
    )
  }, [activeHouseholdId, route.view, route.wineId, wineDetailReturnView])
  const [hasMountedPairing, setHasMountedPairing] =
    useState(
      () =>
        route.view === "pairing" ||
        (!isOtherHouseholdHistory(window.history.state, activeHouseholdId) &&
          getWineDetailReturnView(window.history.state) === "pairing"),
    )

  useEffect(() => {
    function handlePopState() {
      const foreign = isOtherHouseholdHistory(window.history.state, activeHouseholdId)
      const nextRoute = getHouseholdRoute(window.location.pathname, window.history.state, activeHouseholdId, activeHouseholdRole)
      const returnView = (!foreign && getWineDetailReturnView(window.history.state)) || "catalog"
      setRoute(nextRoute)
      setWineDetailReturnView(
        returnView,
      )
      // Even if the visible route stays the same, normalize a foreign history
      // entry now; a dependency-based effect would not run in that case.
      if (foreign) window.history.replaceState(householdHistoryState(activeHouseholdId), "", getAppViewPath(nextRoute.view as AppView))
    }

    window.addEventListener("popstate", handlePopState)

    return () => {
      window.removeEventListener(
        "popstate",
        handlePopState,
      )
    }
  }, [activeHouseholdId, activeHouseholdRole])

  useEffect(() => {
    if (route.view === "pairing") {
      setHasMountedPairing(true)
    }
  }, [route.view])

  function changeView(nextView: AppView) {
    if (!workspaceActive.current) return
    const nextRoute = getAppRouteForRole({ view: nextView, wineId: null }, activeHouseholdRole)
    const nextPath = getAppViewPath(nextRoute.view as AppView)

    if (window.location.pathname !== nextPath) {
      window.history.pushState(householdHistoryState(activeHouseholdId), "", nextPath)
    }

    setRoute(nextRoute)
  }

  function openWineDetail(
    wineId: string,
    returnView: AppView,
  ) {
    if (!workspaceActive.current) return
    const historyState = householdHistoryState(activeHouseholdId, returnView)

    window.history.pushState(
      historyState,
      "",
      getWineDetailPath(wineId),
    )

    setWineDetailReturnView(returnView)
    setRoute({ view: "wine", wineId })
  }

  function leaveWineDetail() {
    if (!workspaceActive.current) return
    if (getWineDetailReturnView(window.history.state)) {
      window.history.back()
      return
    }

    changeView("catalog")
  }

  function replaceWineDetail(wineId: string) {
    if (!workspaceActive.current) return
    const historyState = householdHistoryState(activeHouseholdId, wineDetailReturnView)

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

  function switchHousehold(householdId: string) {
    const target = households.find((household) => household.id === householdId)
    if (!target || householdId === activeHouseholdId || !selectHousehold(householdId)) return
    const nextRoute = householdHomeRoute(target.role)
    window.history.replaceState(householdHistoryState(householdId), "", getAppViewPath(nextRoute.view as AppView))
  }

  return (
    <AppShell
      activeHouseholdId={activeHouseholdId}
      activeHouseholdRole={activeHouseholdRole}
      contentKey={
        route.view === "wine"
          ? `wine:${route.wineId}`
          : route.view
      }
      deviceRegistration={deviceRegistration}
      householdError={householdError}
      selectionNotice={selectionNotice}
      selectionWarning={selectionWarning}
      households={households}
      isOfflineAccess={isOfflineAccess}
      isOnline={isOnline}
      onSelectHousehold={switchHousehold}
      onSignOut={signOutAndClearLocalData}
      onViewChange={changeView}
      pageTitle={getAppRouteTitle(route).replace(" · CellarManager", ` · ${activeHouseholdName} · CellarManager`)}
      syncError={currentSyncError}
      view={
        route.view === "wine"
          ? wineDetailReturnView
          : route.view
      }
    >
      {!permissions.canManageInventory && (route.view === "cellar" || (route.view === "wine" && wineDetailReturnView === "cellar")) ? (
        <div hidden={route.view !== "cellar"}>
        <MemberCellarView
          householdId={activeHouseholdId}
          isOnline={isOnline}
          key={activeHouseholdId}
          onOpenWine={(wineId) => openWineDetail(wineId, "cellar")}
        />
        </div>
      ) : null}
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
          canManageCellarSetup={permissions.canManageCellarSetup}
          householdId={activeHouseholdId}
          isOnline={isOnline}
        />
      ) : null}

      {route.view === "import" ? (
        <ImportView
          canImportInventory={permissions.canImportInventory}
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

      {route.view === "members" ? (
        <HouseholdMembersView householdId={activeHouseholdId} householdName={activeHouseholdName}
          userId={userId} role={activeHouseholdRole} isOnline={isOnline} onInvite={() => changeView("invite")} />
      ) : null}

      {route.view === "invite" ? (
        activeHouseholdRole === "owner" ? (
          <HouseholdInvitationsView
            householdId={activeHouseholdId}
            householdName={activeHouseholdName}
            isOnline={isOnline}
            onBackToMembers={() => changeView("members")}
          />
        ) : (
          <main>
            <h1>Household invitations</h1>
            <Notice role="status" tone="warning">
              Only a household Owner can invite members.
            </Notice>
            <button onClick={() => changeView("members")} type="button">View members</button>
          </main>
        )
      ) : null}

      {route.view === "wine" ? (
        <WineDetailView
          canManageCellar={permissions.canManageInventory}
          key={`${activeHouseholdId}:${activeHouseholdRole}:${route.wineId}`}
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
    selectionWarning,
    selectionNotice,
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
      key={`${activeHouseholdId}:${households.find((household) => household.id === activeHouseholdId)?.role}`}
      activeHouseholdId={activeHouseholdId}
      currentSyncError={currentSyncError}
      householdError={householdError}
      selectionWarning={selectionWarning}
      selectionNotice={selectionNotice}
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

  const [invitationToken, setInvitationToken] =
    useState<string | null>(() => {
      const token = captureHouseholdInvitationToken(
        window.location.href,
        window.localStorage,
      )
      const safeUrl = getInvitationUrlWithoutSecret(
        window.location.href,
      )

      if (safeUrl) {
        window.history.replaceState(
          window.history.state,
          "",
          safeUrl,
        )
      }

      return token
    })

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

  if (invitationToken) {
    return (
      <InvitationEntryView
        hasAuthenticatedSession={session !== null}
        isOnline={isOnline}
        onCompleteInvitation={() => {
          clearHouseholdInvitationToken(
            window.localStorage,
          )
        }}
        onDismissInvitation={() => {
          clearHouseholdInvitationToken(
            window.localStorage,
          )
          setInvitationToken(null)
        }}
        onSignOut={signOutAndClearLocalData}
        token={invitationToken}
        userId={userId}
      />
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
