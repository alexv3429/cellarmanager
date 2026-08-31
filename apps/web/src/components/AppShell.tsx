import { useQuery, useStatus } from "@powersync/react"
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"

import type {
  RegisteredDevicesState,
} from "../devices/useRegisteredDevices"
import {
  getAppViewPath,
  type AppView,
} from "../navigation/appNavigation"
import {
  getHouseholdRoleLabel,
  type HouseholdRole,
} from "../households/householdPermissions"
import type {
  HouseholdOption,
} from "../households/useActiveHousehold"
import { getSyncStatusPresentation } from "../data/syncStatusView"
import { Notice } from "./Notice"

interface AppShellProps {
  activeHouseholdId: string
  activeHouseholdRole: HouseholdRole
  children: ReactNode
  contentKey: string
  deviceRegistration: RegisteredDevicesState
  householdError: string | null
  households: HouseholdOption[]
  isOfflineAccess: boolean
  isOnline: boolean
  onSelectHousehold: (householdId: string) => void
  onSignOut: () => Promise<void>
  onViewChange: (view: AppView) => void
  pageTitle: string
  syncError: string | null
  view: AppView
}

interface PendingOperationCountRow {
  pending_count: number
}

const PENDING_OPERATION_COUNT_QUERY = `
  select count(*) as pending_count
  from inventory_operations
  where household_id = ?
    and status = 'PENDING'
`

function errorMessage(error: unknown): string | null {
  if (!error) {
    return null
  }

  return error instanceof Error
    ? error.message
    : String(error)
}

export function AppShell({
  activeHouseholdId,
  activeHouseholdRole,
  children,
  contentKey,
  deviceRegistration,
  householdError,
  households,
  isOfflineAccess,
  isOnline,
  onSelectHousehold,
  onSignOut,
  onViewChange,
  pageTitle,
  syncError,
  view,
}: AppShellProps) {
  const status = useStatus()
  const {
    data: pendingOperationCounts,
    error: pendingOperationCountError,
  } = useQuery<PendingOperationCountRow>(
    PENDING_OPERATION_COUNT_QUERY,
    [activeHouseholdId],
  )

  const [signOutError, setSignOutError] =
    useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousContentKey = useRef(contentKey)

  useEffect(() => {
    document.title = pageTitle

    if (previousContentKey.current === contentKey) {
      return
    }

    previousContentKey.current = contentKey

    const animationFrame = window.requestAnimationFrame(() => {
      window.scrollTo({ left: 0, top: 0 })
      contentRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [contentKey, pageTitle])

  const pendingOperationCount = Math.max(
    0,
    Number(pendingOperationCounts[0]?.pending_count ?? 0),
  )
  const effectiveSyncError =
    syncError ??
    errorMessage(status.uploadError) ??
    errorMessage(status.downloadError) ??
    errorMessage(pendingOperationCountError)
  const syncPresentation = getSyncStatusPresentation({
    connected: status.connected,
    connecting: status.connecting,
    downloading: status.downloading,
    error: effectiveSyncError,
    hasSynced: status.hasSynced === true,
    isOnline,
    pendingOperationCount,
    uploading: status.uploading,
  })
  const lastSyncLabel = status.lastSyncedAt
    ? `Last complete sync ${status.lastSyncedAt.toLocaleString()}`
    : null

  async function signOut() {
    setSignOutError(null)

    if (!isOnline) {
      setSignOutError(
        "Reconnect before signing out. Signing out offline would prevent access until the next online login.",
      )
      return
    }

    try {
      await onSignOut()
    } catch (caughtError: unknown) {
      setSignOutError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to sign out",
      )
    }
  }

  function navigate(
    event: ReactMouseEvent<HTMLAnchorElement>,
    nextView: AppView,
  ) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return
    }

    event.preventDefault()
    onViewChange(nextView)
  }

  const deviceStatus = deviceRegistration.isReady
    ? "Ready"
    : deviceRegistration.isRegistering
      ? "Registering…"
      : deviceRegistration.isLoading
        ? "Waiting for synchronized data…"
        : "Not ready"

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="app-shell__header">
        <div className="app-shell__identity">
          <div className="app-shell__brand">
            CellarManager
          </div>

          <div
            aria-live="polite"
            className={`app-shell__sync app-shell__sync--${syncPresentation.tone}`}
            role="status"
            title={lastSyncLabel ?? undefined}
          >
            <span aria-hidden="true" className="app-shell__sync-dot" />
            <span>
              <strong>{syncPresentation.label}</strong>
              <small>{syncPresentation.detail}</small>
            </span>
          </div>

          <div className="app-shell__device-status">
            Device: {deviceStatus}
            {lastSyncLabel ? (
              <>
                <span aria-hidden="true"> · </span>
                {lastSyncLabel}
              </>
            ) : null}
          </div>

          {isOfflineAccess ? (
            <p className="app-shell__offline-note">
              Local access only · authentication will refresh
              after reconnection
            </p>
          ) : null}
        </div>

        <div className="app-shell__account">
          <label className="app-shell__household">
            <span className="app-shell__household-label">
              Household
              <small>
                {getHouseholdRoleLabel(activeHouseholdRole)}
              </small>
            </span>
            <select
              onChange={(event) =>
                onSelectHousehold(event.target.value)
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

          <button
            onClick={() => void signOut()}
            title={
              isOnline
                ? undefined
                : "Reconnect before signing out"
            }
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <nav
        aria-label="Primary"
        className="app-shell__nav"
      >
        <a
          aria-current={view === "inventory" ? "page" : undefined}
          href={getAppViewPath("inventory")}
          onClick={(event) => navigate(event, "inventory")}
        >
          Inventory
        </a>

        <a
          aria-current={view === "pairing" ? "page" : undefined}
          href={getAppViewPath("pairing")}
          onClick={(event) => navigate(event, "pairing")}
        >
          Pairing
        </a>

        <a
          aria-current={view === "activity" ? "page" : undefined}
          href={getAppViewPath("activity")}
          onClick={(event) => navigate(event, "activity")}
        >
          Activity
        </a>

        <a
          aria-current={view === "catalog" ? "page" : undefined}
          href={getAppViewPath("catalog")}
          onClick={(event) => navigate(event, "catalog")}
        >
          Catalog
        </a>

        <a
          aria-current={view === "import" ? "page" : undefined}
          href={getAppViewPath("import")}
          onClick={(event) => navigate(event, "import")}
        >
          Data
        </a>

        <a
          aria-current={view === "setup" ? "page" : undefined}
          href={getAppViewPath("setup")}
          onClick={(event) => navigate(event, "setup")}
        >
          Cellar setup
        </a>
      </nav>

      {householdError ||
      effectiveSyncError ||
      signOutError ||
      deviceRegistration.error ? (
        <div className="app-shell__alerts">
          {householdError ? (
            <Notice role="alert" tone="error">
              {householdError}
            </Notice>
          ) : null}

          {effectiveSyncError ? (
            <Notice role="alert" tone="error">
              Synchronization paused: {effectiveSyncError}
            </Notice>
          ) : null}

          {signOutError ? (
            <Notice role="alert" tone="error">
              {signOutError}
            </Notice>
          ) : null}

          {deviceRegistration.error ? (
            <Notice role="alert" tone="error">
              <p>{deviceRegistration.error}</p>
              <button
                onClick={
                  deviceRegistration.retryRegistration
                }
                type="button"
              >
                Retry device registration
              </button>
            </Notice>
          ) : null}
        </div>
      ) : null}

      <div
        className="app-shell__content"
        id="main-content"
        ref={contentRef}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}
