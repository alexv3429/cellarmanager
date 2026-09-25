import type { MouseEvent } from "react"
import { useLanguage } from "../i18n/useLanguage"

function navigate(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  window.history.pushState(null, "", path)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

export function AccountLink() {
  const { t } = useLanguage()
  return <a className="app-shell__account-link" href="/account" onClick={(event) => navigate(event, "/account")}>{t("account.link")}</a>
}

export function AccountBackLink() {
  const { t } = useLanguage()
  return <a className="app-shell__account-link" href="/" onClick={(event) => navigate(event, "/")}>{t("account.back")}</a>
}
