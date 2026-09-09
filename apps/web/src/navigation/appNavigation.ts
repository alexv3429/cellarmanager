export type AppView =
  | "cellar"
  | "inventory"
  | "pairing"
  | "activity"
  | "catalog"
  | "import"
  | "invite"
  | "members"
  | "devices"
  | "setup"

export type AppRoute =
  | {
      view: AppView
      wineId: null
    }
  | {
      view: "wine"
      wineId: string
    }

export interface WineDetailHistoryState {
  wineDetailReturnView: AppView
}

const APP_VIEW_PATHS: Record<AppView, string> = {
  cellar: "/cellar",
  inventory: "/",
  pairing: "/pairing",
  activity: "/activity",
  catalog: "/catalog",
  import: "/data",
  invite: "/invite",
  members: "/members",
  devices: "/devices",
  setup: "/setup",
}

function normalizePathname(pathname: string): string {
  if (pathname === "/") {
    return pathname
  }

  return pathname.replace(/\/+$/, "")
}

export function getAppViewFromPathname(
  pathname: string,
): AppView {
  const route = getAppRouteFromPathname(pathname)

  return route.view === "wine"
    ? "catalog"
    : route.view
}

export function getAppRouteFromPathname(
  pathname: string,
): AppRoute {
  const normalizedPathname = normalizePathname(pathname)
  const winePathMatch = normalizedPathname.match(
    /^\/wines\/([^/]+)$/u,
  )

  if (winePathMatch) {
    try {
      const wineId = decodeURIComponent(winePathMatch[1])

      if (wineId.length > 0) {
        return { view: "wine", wineId }
      }
    } catch {
      return { view: "inventory", wineId: null }
    }
  }

  switch (normalizedPathname) {
    case "/cellar":
      return { view: "cellar", wineId: null }
    case "/pairing":
      return { view: "pairing", wineId: null }
    case "/activity":
      return { view: "activity", wineId: null }
    case "/catalog":
      return { view: "catalog", wineId: null }
    case "/data":
    case "/import":
      return { view: "import", wineId: null }
    case "/invite":
      return { view: "invite", wineId: null }
    case "/members":
      return { view: "members", wineId: null }
    case "/devices":
      return { view: "devices", wineId: null }
    case "/setup":
      return { view: "setup", wineId: null }
    default:
      return { view: "inventory", wineId: null }
  }
}

export function getAppViewPath(view: AppView): string {
  return APP_VIEW_PATHS[view]
}

export function getWineDetailPath(wineId: string): string {
  return `/wines/${encodeURIComponent(wineId)}`
}

export function getAppRouteTitle(route: AppRoute): string {
  const pageTitle =
    route.view === "wine"
      ? "Wine details"
      : {
          activity: "Activity",
          catalog: "Catalog",
          cellar: "Cellar",
          import: "Cellar data",
          invite: "Household invitations",
          members: "Household members",
          devices: "Devices",
          inventory: "Inventory",
          pairing: "Food pairing",
          setup: "Cellar setup",
        }[route.view]

  return `${pageTitle} · CellarManager`
}

export function getWineDetailReturnView(
  historyState: unknown,
): AppView | null {
  if (
    typeof historyState !== "object" ||
    historyState === null ||
    !("wineDetailReturnView" in historyState)
  ) {
    return null
  }

  const returnView = historyState.wineDetailReturnView

  return returnView === "inventory" ||
    returnView === "cellar" ||
    returnView === "pairing" ||
    returnView === "activity" ||
    returnView === "catalog" ||
    returnView === "import" ||
    returnView === "invite" ||
    returnView === "members" ||
    returnView === "devices" ||
    returnView === "setup"
    ? returnView
    : null
}

// Resolve on every render as well as navigation: a role change must never
// leave a previously mounted management screen accessible to a Member.
export function getAppRouteForRole(
  route: AppRoute,
  role: "owner" | "member",
): AppRoute {
  if (role === "member" && (route.view === "inventory" || route.view === "catalog")) {
    return { view: "cellar", wineId: null }
  }
  if (role === "owner" && route.view === "cellar") {
    return { view: "inventory", wineId: null }
  }
  return route
}
