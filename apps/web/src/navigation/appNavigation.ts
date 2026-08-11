export type AppView =
  | "inventory"
  | "catalog"
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
  inventory: "/",
  catalog: "/catalog",
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
    case "/catalog":
      return { view: "catalog", wineId: null }
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
    returnView === "catalog" ||
    returnView === "setup"
    ? returnView
    : null
}
