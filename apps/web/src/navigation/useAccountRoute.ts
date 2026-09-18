import { useEffect, useState } from "react"

function isAccountPath() {
  return /^\/account\/*$/u.test(window.location.pathname)
}

// Account settings are account-scoped, not a household workspace: they remain
// available before onboarding, after leaving, and while local data is unavailable.
export function useAccountRoute() {
  const [isAccount, setIsAccount] = useState(isAccountPath)
  useEffect(() => {
    const update = () => setIsAccount(isAccountPath())
    window.addEventListener("popstate", update)
    return () => window.removeEventListener("popstate", update)
  }, [])
  return isAccount
}
