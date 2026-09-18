import type { MouseEvent } from "react"

function navigate(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  window.history.pushState(null, "", path)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

export function AccountLink() {
  return <a className="app-shell__account-link" href="/account" onClick={(event) => navigate(event, "/account")}>Account</a>
}

export function AccountBackLink() {
  return <a className="app-shell__account-link" href="/" onClick={(event) => navigate(event, "/")}>Back to cellar</a>
}
