import { createClient } from "@supabase/supabase-js"

import {
  isPasswordRecoveryUrl,
  setPasswordRecoveryPending,
} from "../auth/authEmailFlow"
import { environment } from "./env"

export const startedFromPasswordRecoveryLink =
  typeof window !== "undefined" &&
  isPasswordRecoveryUrl(window.location.href)

if (startedFromPasswordRecoveryLink) {
  setPasswordRecoveryPending(window.sessionStorage, true)
}

export const supabase = createClient(
  environment.supabaseUrl,
  environment.supabasePublishableKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
)
