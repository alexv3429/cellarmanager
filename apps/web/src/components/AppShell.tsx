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
  getHouseholdPermissions,
  type HouseholdRole,
} from "../households/householdPermissions"
import type {
  HouseholdOption,
} from "../households/useActiveHousehold"
import { getSyncStatusPresentation } from "../data/syncStatusView"
import { Notice } from "./Notice"
import { HouseholdSwitcher } from "./HouseholdSwitcher"
import { AccountLink } from "./AccountNavigation"
import { ShellDisclosure } from "./ShellDisclosure"
import { useLanguage } from "../i18n/useLanguage"

interface AppShellProps {
  activeHouseholdId: string
  activeHouseholdRole: HouseholdRole
  children: ReactNode
  contentKey: string
  deviceRegistration: RegisteredDevicesState
  householdError: string | null
  selectionNotice?: string | null
  selectionWarning?: string | null
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
  selectionNotice,
  selectionWarning,
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
  const { t } = useLanguage()
  const permissions = getHouseholdPermissions(activeHouseholdRole)
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
  const [openPanel, setOpenPanel] = useState<"household" | "settings" | "sync" | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousContentKey = useRef<string | null>(null)

  useEffect(() => {
    document.title = pageTitle

    if (previousContentKey.current === contentKey) {
      return
    }

    previousContentKey.current = contentKey
    setOpenPanel(null)

    const focusedElement = document.activeElement
    const animationFrame = window.requestAnimationFrame(() => {
      // Do not steal focus if the user already opened or cancelled a switch
      // while the route's animation frame was waiting to run.
      if (document.activeElement !== focusedElement) return
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
    setOpenPanel(null)
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
    setOpenPanel(null)
    onViewChange(nextView)
  }

  const deviceRevoked = deviceRegistration.revokedHouseholdIds.includes(activeHouseholdId)
  const deviceStatus = deviceRevoked
    ? "Revoked for this household"
    : deviceRegistration.deviceIdByHousehold[activeHouseholdId]
    ? "Ready"
    : deviceRegistration.isRegistering
      ? "Registering…"
      : deviceRegistration.isLoading
        ? "Waiting for synchronized data…"
        : "Not ready"
  const activeHouseholdName = households.find((household) => household.id === activeHouseholdId)?.name ?? t("shell.yourHousehold")
  const activeRoleLabel = activeHouseholdRole === "owner" ? t("shell.owner") : t("shell.member")

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("common.skipMain")}
      </a>

      <header className="app-shell__header">
        <div className="app-shell__toolbar">
          <div className="app-shell__brand">CellarManager</div>
          <ShellDisclosure className={`app-shell__sync app-shell__sync--${syncPresentation.tone}`}
            accessibleLabel={`${t("shell.sync")}: ${syncPresentation.label}`} open={openPanel === "sync"}
            onToggle={() => setOpenPanel(openPanel === "sync" ? null : "sync")} onClose={() => setOpenPanel(null)}
            label={<><span aria-hidden="true" className="app-shell__sync-dot" /><span aria-live="polite">{syncPresentation.label}</span></>}>
            <strong>{t("shell.syncDevice")}</strong>
            <p>{syncPresentation.detail}</p>
            <p>Device: {deviceStatus}</p>
            {lastSyncLabel ? <small>{lastSyncLabel}</small> : null}
            {isOfflineAccess ? <p>Local access only · authentication will refresh after reconnection.</p> : null}
            <a className="app-shell__account-link" href={getAppViewPath("activity")} onClick={(event) => navigate(event, "activity")}>{t("shell.activityQueue")}</a>
          </ShellDisclosure>

          <ShellDisclosure className="app-shell__household" accessibleLabel={`${t("shell.household")}: ${activeHouseholdName} · ${activeRoleLabel}`}
            open={openPanel === "household"} onToggle={() => setOpenPanel(openPanel === "household" ? null : "household")} onClose={() => setOpenPanel(null)}
            label={<><span className="app-shell__household-name" title={activeHouseholdName}>{activeHouseholdName}</span><span className="app-shell__role">{activeRoleLabel}</span></>}>
            <HouseholdSwitcher activeHouseholdId={activeHouseholdId} households={households}
              isOnline={isOnline} pendingOperationCount={pendingOperationCount}
              onSelectHousehold={(id) => { setOpenPanel(null); onSelectHousehold(id) }} />
          </ShellDisclosure>

          <ShellDisclosure className="app-shell__settings" accessibleLabel={t("shell.settings")} label={t("shell.settings")} open={openPanel === "settings"}
            onToggle={() => setOpenPanel(openPanel === "settings" ? null : "settings")} onClose={() => setOpenPanel(null)}>
            <nav aria-label="Settings" className="app-shell__settings-links">
              <span className="app-shell__settings-label">{t("shell.personal")}</span>
              <AccountLink />
              <span className="app-shell__settings-label">{t("shell.household")}</span>
              <a aria-current={view === "members" ? "page" : undefined} className="app-shell__account-link"
                href={getAppViewPath("members")} onClick={(event) => navigate(event, "members")}>{t("shell.members")}</a>
              <a aria-current={view === "devices" ? "page" : undefined} className="app-shell__account-link"
                href={getAppViewPath("devices")} onClick={(event) => navigate(event, "devices")}>{t("shell.devices")}</a>
              <button className="app-shell__sign-out" onClick={() => void signOut()} title={isOnline ? undefined : "Reconnect before signing out"} type="button">{t("shell.signOut")}</button>
            </nav>
          </ShellDisclosure>
        </div>
      </header>

      <nav
        aria-label={t("nav.primary")}
        className="app-shell__nav"
      >
        <div className="app-shell__nav-items">
        <a
          aria-current={view === "inventory" || view === "cellar" ? "page" : undefined}
          href={getAppViewPath(permissions.canManageInventory ? "inventory" : "cellar")}
          onClick={(event) => navigate(event, permissions.canManageInventory ? "inventory" : "cellar")}
        >
          {permissions.canManageInventory ? t("nav.inventory") : t("nav.cellar")}
        </a>

        <a
          aria-current={view === "pairing" ? "page" : undefined}
          href={getAppViewPath("pairing")}
          onClick={(event) => navigate(event, "pairing")}
        >
          {t("nav.pairing")}
        </a>

        <a
          aria-current={view === "activity" ? "page" : undefined}
          href={getAppViewPath("activity")}
          onClick={(event) => navigate(event, "activity")}
        >
          {t("nav.activity")}
        </a>

        {permissions.canManageCatalog ? <a
          aria-current={view === "catalog" ? "page" : undefined}
          href={getAppViewPath("catalog")}
          onClick={(event) => navigate(event, "catalog")}
        >
          {t("nav.catalog")}
        </a> : null}

        <a
          aria-current={view === "import" ? "page" : undefined}
          href={getAppViewPath("import")}
          onClick={(event) => navigate(event, "import")}
        >
          {t("nav.data")}
        </a>

        {permissions.canManageCellarSetup ? (
          <a
            aria-current={view === "setup" ? "page" : undefined}
            href={getAppViewPath("setup")}
            onClick={(event) => navigate(event, "setup")}
          >
            {t("nav.setup")}
          </a>
        ) : null}
        </div>
      </nav>

      {householdError ||
      selectionNotice ||
      selectionWarning ||
      effectiveSyncError ||
      signOutError ||
      deviceRegistration.error || deviceRevoked ? (
        <div className="app-shell__alerts">
          {deviceRevoked ? <Notice role="status" tone="warning">This browser’s registration was revoked for this household. Bottle changes are unavailable here; reading is still allowed. Queued changes are kept locally and are not transferred to a new registration. Open Devices to review its status.</Notice> : null}
          {selectionNotice ? <Notice role="status" tone="warning">{selectionNotice}</Notice> : null}
          {selectionWarning ? <Notice role="status" tone="warning">{selectionWarning}</Notice> : null}
          {householdError ? (
            <Notice role="alert" tone="error">
              {householdError}
            </Notice>
          ) : null}

          {effectiveSyncError ? (
            <Notice role="alert" tone="error">
              Synchronization paused: {effectiveSyncError}
              <p><button type="button" onClick={() => onViewChange("activity")}>Review this browser’s queue</button></p>
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
