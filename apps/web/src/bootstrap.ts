import { getSecureApplicationUrl } from "./auth/secureApplicationUrl"

// Do not import App, Supabase, or PowerSync until the browser is on HTTPS.
// Keep the full URL: invitation and authentication secrets stay in its fragment.
const secureUrl = getSecureApplicationUrl(window.location.href)
if (secureUrl) {
  window.location.replace(secureUrl)
} else {
  void import("./main")
}
