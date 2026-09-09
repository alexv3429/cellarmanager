import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getHouseholdPermissions, type HouseholdRole } from "../households/householdPermissions"
import { AppShell } from "./AppShell"
import { CellarSetupView } from "./CellarSetupView"
import { ImportView } from "./ImportView"

const { query, rpc, readStorage } = vi.hoisted(() => ({
  query: vi.fn(() => ({ data: [], error: null, isLoading: false })),
  rpc: vi.fn(),
  readStorage: vi.fn(() => null),
}))
vi.mock("@powersync/react", () => ({
  useQuery: query,
  useStatus: () => ({ connected: true, hasSynced: true }),
}))
vi.mock("../data/supabase", () => ({ supabase: { rpc } }))
vi.mock("./CsvExportPanel", () => ({
  CsvExportPanel: ({ householdId }: { householdId: string }) => (
    <button type="button">Export {householdId}</button>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("window", { localStorage: { getItem: readStorage } })
})
afterEach(() => vi.unstubAllGlobals())

describe("owner-only management views", () => {
  it.each([true, false])("members get export only (online: %s), without restoring an owner's import", (isOnline) => {
    const permissions = getHouseholdPermissions("member")
    const html = renderToStaticMarkup(
      <ImportView canImportInventory={permissions.canImportInventory}
        deviceId="member-device" householdId="shared-cellar" isOnline={isOnline} />,
    )
    expect(html).toContain("Export shared-cellar")
    expect(html).toContain("reserved for household Owners")
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain("Import file")
    expect(query).not.toHaveBeenCalled()
    expect(readStorage).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("members opening /setup directly never mount setup forms", () => {
    const html = renderToStaticMarkup(
      <CellarSetupView canManageCellarSetup={false} householdId="shared-cellar" isOnline />,
    )
    expect(html).toContain("Only a household Owner")
    expect(html).not.toContain("<form")
    expect(query).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("owners retain import and cellar-setup forms", () => {
    const permissions = getHouseholdPermissions("owner")
    const dataHtml = renderToStaticMarkup(
      <ImportView canImportInventory={permissions.canImportInventory}
        deviceId="owner-device" householdId="owned-cellar" isOnline />,
    )
    expect(dataHtml).toContain("Import file")
    expect(dataHtml).toContain('type="file"')
    const setupHtml = renderToStaticMarkup(
      <CellarSetupView canManageCellarSetup={permissions.canManageCellarSetup}
        householdId="owned-cellar" isOnline />,
    )
    expect(setupHtml).toContain("Create cellar")
    expect(setupHtml).toContain("<form")
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(["owner", "member"] as const)("navigation reflects the active %s role", (role: HouseholdRole) => {
    const html = renderToStaticMarkup(
      <AppShell activeHouseholdId="household" activeHouseholdRole={role}
        contentKey="inventory" householdError={null}
        households={[{ id: "household", name: "Shared cellar", role }]}
        isOfflineAccess={false} isOnline onSelectHousehold={vi.fn()}
        onSignOut={async () => {}} onViewChange={vi.fn()} pageTitle="Inventory"
        syncError={null} view="inventory"
        deviceRegistration={{ deviceIdByHousehold: {}, error: null, isLoading: false,
          isReady: true, isRegistering: false, retryRegistration: vi.fn() }}>
        <p>Shared inventory</p>
      </AppShell>,
    )
    expect(html).toContain('href="/data"')
    expect(html.includes('href="/catalog"')).toBe(role === "owner")
    expect(html.includes('href="/cellar"')).toBe(role === "member")
    expect(html.includes('href="/"')).toBe(role === "owner")
    expect(html).toContain("Shared inventory")
    expect(html.includes('href="/setup"')).toBe(role === "owner")
    expect(html.includes('href="/invite"')).toBe(role === "owner")
  })
})
