export type AppView =
  | "inventory"
  | "catalog"
  | "setup"

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
  switch (normalizePathname(pathname)) {
    case "/catalog":
      return "catalog"
    case "/setup":
      return "setup"
    default:
      return "inventory"
  }
}

export function getAppViewPath(view: AppView): string {
  return APP_VIEW_PATHS[view]
}
