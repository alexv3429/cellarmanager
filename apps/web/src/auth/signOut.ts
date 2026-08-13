import {
  clearPowerSyncForSignOut,
} from "../data/powersync/connection"
import { supabase } from "../data/supabase"
import { clearAllPendingCsvImportPlans } from "../data/csvImportCommit"
import { clearActiveHouseholds } from "../households/activeHousehold"
import { clearLocalAccess } from "./localAccess"

export async function signOutAndClearLocalData(): Promise<void> {
  const { error } = await supabase.auth.signOut({
    scope: "local",
  })

  if (error) {
    throw new Error(`Unable to sign out: ${error.message}`)
  }

  // Remove offline authorization immediately after the
  // authenticated sign-out succeeds. Even if clearing the local
  // database later fails, the previous account cannot be restored
  // through the offline-access path.
  clearLocalAccess(window.localStorage)
  clearActiveHouseholds(window.localStorage)
  clearAllPendingCsvImportPlans(window.localStorage)

  await clearPowerSyncForSignOut()
}
