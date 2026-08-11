import { useStatus } from "@powersync/react"
import {
  type ReactNode,
  useState,
} from "react"

import type {
  RegisteredDevicesState,
} from "../devices/useRegisteredDevices"
import type { AppView } from "../navigation/appNavigation"
import { Notice } from "./Notice"

interface HouseholdOption {
  id: string
  name: string
}

interface AppShellProps {
  activeHouseholdId: string
  children: ReactNode
  deviceRegistration: RegisteredDevicesState
  householdError: string | null
  households: HouseholdOption[]
  isOfflineAccess: boolean
  isOnline: boolean
  onSelectHousehold: (householdId: string) => void
  onSignOut: () => Promise<void>
  onViewChange: (view: AppView) => void
  syncError: string | null
  view: AppView
}

export function AppShell({
  activeHouseholdId,
  children,
  deviceRegistration,
  householdError,
  households,
  isOfflineAccess,
  isOnline,
  onSelectHousehold,
  onSignOut,
  onViewChange,
  syncError,
  view,
}: AppShellProps) {
  const status = useStatus()

  const [signOutError, setSignOutError] =
    useState<string | null>(null)

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

  const deviceStatus = deviceRegistration.isReady
    ? "Ready"
    : deviceRegistration.isRegistering
      ? "Registering…"
      : deviceRegistration.isLoading
        ? "Waiting for synchronized data…"
        : "Not ready"

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__identity">
          <div className="app-shell__brand">
            CellarManager
          </div>

          <div className="app-shell__status">
            <span>
              {status.connected ? "Connected" : "Offline"}
            </span>
            <span aria-hidden="true"> · </span>
            <span>
              {status.hasSynced
                ? "Local data ready"
                : "Initial synchronization pending"}
            </span>
            <span aria-hidden="true"> · </span>
            <span>Device: {deviceStatus}</span>
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
            <span>Household</span>
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
        <button
          aria-pressed={view === "inventory"}
          onClick={() => onViewChange("inventory")}
          type="button"
        >
          Inventory
        </button>

        <button
          aria-pressed={view === "catalog"}
          onClick={() => onViewChange("catalog")}
          type="button"
        >
          Catalog
        </button>

        <button
          aria-pressed={view === "setup"}
          onClick={() => onViewChange("setup")}
          type="button"
        >
          Cellar setup
        </button>
      </nav>

      {householdError ||
      syncError ||
      signOutError ||
      deviceRegistration.error ? (
        <div className="app-shell__alerts">
          {householdError ? (
            <Notice role="alert" tone="error">
              {householdError}
            </Notice>
          ) : null}

          {syncError ? (
            <Notice role="alert" tone="error">
              Synchronization paused: {syncError}
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

      <div className="app-shell__content">
        {children}
      </div>
    </div>
  )
}
