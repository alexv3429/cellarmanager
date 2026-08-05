import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/web"

import { environment } from "../env"
import { supabase } from "../supabase"

export class PowerSyncConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession()

    if (error) {
      throw new Error(
        `Unable to retrieve Supabase session: ${error.message}`,
      )
    }

    if (!session) {
      return null
    }

    return {
      endpoint: environment.powerSyncUrl,
      token: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    }
  }

  async uploadData(
    database: AbstractPowerSyncDatabase,
  ): Promise<void> {
    const transaction = await database.getNextCrudTransaction()

    if (transaction) {
      throw new Error(
        "Unexpected local write: uploads are not implemented yet",
      )
    }
  }
}