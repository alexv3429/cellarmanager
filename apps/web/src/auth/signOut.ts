import {
  clearPowerSyncForSignOut,
} from "../data/powersync/connection"
import { supabase } from "../data/supabase"
import { clearLocalAccess } from "./localAccess"

export async function signOutAndClearLocalData(): Promise<void> {
  const { error } = await supabase.auth.signOut({
    scope: "local",
  })

  if (error) {
    throw new Error(`Unable to sign out: ${error.message}`)
  }

  clearLocalAccess(window.localStorage)
  await clearPowerSyncForSignOut()
}
